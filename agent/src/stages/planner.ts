import { isAbsolute, normalize } from 'node:path';
import { PLANNER_SYSTEM, plannerUser, submitPlanTool } from '../prompts/planner';
import { abort } from '../tools/errors';
import type { LlmClient, ToolSchema } from '../tools/llm';
import type { PipelineState, Task, TaskType } from '../types';

const TASK_TYPES: readonly TaskType[] = ['mock', 'hook', 'component', 'page', 'test'];

/**
 * Kahn's algorithm. Returns the tasks in dependency order, or the ids caught in a cycle.
 * Small enough that a library would cost more than it saves.
 */
export function topologicalSort(
  tasks: Task[],
): { ordered: Task[]; cycle: null } | { ordered: null; cycle: string[] } {
  const remaining = new Map(tasks.map((task) => [task.id, new Set(task.dependsOn)]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ordered: Task[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((dep) => !remaining.has(dep)))
      .map(([id]) => id);

    if (ready.length === 0) return { ordered: null, cycle: [...remaining.keys()].sort() };

    for (const id of ready) {
      const task = byId.get(id);
      if (task) ordered.push(task);
      remaining.delete(id);
    }
  }

  return { ordered, cycle: null };
}

/** True when `file` is a relative path that stays inside the app root. */
function isInsideAppRoot(file: string): boolean {
  if (file.length === 0 || isAbsolute(file) || /^[a-zA-Z]:/.test(file)) return false;
  const normalized = normalize(file);
  return !normalized.startsWith('..') && !normalized.split(/[\\/]/).includes('..');
}

/**
 * Everything the schema cannot express. Returns every problem found, not just the first:
 * the retry prompt is more useful when it lists all of them at once.
 */
export function validatePlan(value: unknown): { tasks: Task[]; errors: string[] } {
  const errors: string[] = [];
  const raw = (value as { tasks?: unknown })?.tasks;

  if (!Array.isArray(raw)) {
    return { tasks: [], errors: ['submit_plan did not return a "tasks" array.'] };
  }
  if (raw.length === 0) {
    return { tasks: [], errors: ['the plan is empty: it must contain at least one task.'] };
  }

  const tasks: Task[] = [];
  raw.forEach((entry, index) => {
    const task = entry as Partial<Task>;
    const label = typeof task.id === 'string' && task.id ? `"${task.id}"` : `at index ${index}`;

    if (typeof task.id !== 'string' || task.id.length === 0) {
      errors.push(`task at index ${index} has no id.`);
    }
    if (typeof task.file !== 'string' || task.file.length === 0) {
      errors.push(`task ${label} has no file path.`);
    }
    if (typeof task.description !== 'string' || task.description.length === 0) {
      errors.push(`task ${label} has no description.`);
    }
    if (!TASK_TYPES.includes(task.type as TaskType)) {
      errors.push(
        `task ${label} has type "${String(task.type)}"; allowed types are ${TASK_TYPES.join(', ')}.`,
      );
    }
    if (!Array.isArray(task.dependsOn)) {
      errors.push(`task ${label} has no dependsOn array (use [] when it has no dependencies).`);
    }

    tasks.push({
      id: String(task.id ?? ''),
      file: String(task.file ?? ''),
      description: String(task.description ?? ''),
      type: task.type as TaskType,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
    });
  });

  // Unique ids.
  const idErrorsBefore = errors.length;
  const firstIndexById = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (!task.id) return;
    const first = firstIndexById.get(task.id);
    if (first === undefined) {
      firstIndexById.set(task.id, index);
    } else {
      errors.push(`duplicate task id "${task.id}" at indexes ${first} and ${index}.`);
    }
  });

  // One task per output file. Two tasks on one path is a plan defect: the generator would run
  // both and the second would silently overwrite the first, leaving state.generated holding only
  // the last. Resolving that in the generator would hide a planning mistake instead of fixing it.
  const firstIndexByFile = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (!task.file) return;
    const first = firstIndexByFile.get(task.file);
    if (first === undefined) {
      firstIndexByFile.set(task.file, index);
    } else {
      errors.push(
        `duplicate task file "${task.file}": tasks "${tasks[first]?.id}" (index ${first}) and ` +
          `"${task.id}" (index ${index}) both target it; each file must have exactly one task.`,
      );
    }
  });

  // Dependencies must exist and must be declared earlier in the array.
  tasks.forEach((task, index) => {
    for (const dep of task.dependsOn) {
      const depIndex = firstIndexById.get(dep);
      if (depIndex === undefined) {
        errors.push(`task "${task.id}" dependsOn "${dep}", which is not a declared task id.`);
      } else if (depIndex >= index) {
        errors.push(
          `task "${task.id}" (index ${index}) dependsOn "${dep}" (index ${depIndex}), ` +
            `which is not declared earlier; a task may only depend on earlier tasks.`,
        );
      }
      if (dep === task.id) {
        errors.push(`task "${task.id}" dependsOn itself.`);
      }
    }
  });

  // File paths stay inside the app root.
  for (const task of tasks) {
    if (task.file && !isInsideAppRoot(task.file)) {
      errors.push(
        `task "${task.id}" has file "${task.file}": paths must be relative to the app root ` +
          `and must not escape it.`,
      );
    }
  }

  // Independent of the ordering rule above, so a malformed graph is still caught. Skipped when
  // ids are duplicated: the graph is keyed by id, so duplicates collapse into a false cycle and
  // the retry prompt would carry a misleading error. Fix the ids first, then any real cycle
  // surfaces on the next pass.
  const idsAreSound = errors.length === idErrorsBefore;
  const sorted = idsAreSound ? topologicalSort(tasks) : null;
  if (sorted?.cycle) {
    errors.push(`dependency cycle among tasks: ${sorted.cycle.join(', ')}.`);
  }

  return { tasks: sorted?.ordered ?? tasks, errors };
}

/**
 * Stage 2: one schema-enforced LLM call, validated in code, with exactly one retry that
 * shows the model what it got wrong. A second failure aborts — a designed outcome, not a crash.
 */
export async function planner(state: PipelineState, llm: LlmClient): Promise<PipelineState> {
  const basePrompt = plannerUser(state.spec, state.snapshot.tree, state.snapshot.files);
  let prompt = basePrompt;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await llm.callTool(
      PLANNER_SYSTEM,
      prompt,
      submitPlanTool as unknown as ToolSchema,
    );
    const { tasks, errors } = validatePlan(response);

    if (errors.length === 0) {
      console.log(`[stage:planner] ${tasks.length} tasks, validated on attempt ${attempt}`);
      return { ...state, plan: tasks };
    }

    lastErrors = errors;
    console.log(`[stage:planner] attempt ${attempt} rejected: ${errors.length} problem(s)`);
    prompt = `${basePrompt}

Your previous plan was rejected by the validator. Fix every problem below and call submit_plan again.

<validation_errors>
${errors.map((error) => `- ${error}`).join('\n')}
</validation_errors>`;
  }

  throw abort(
    `Planner failed validation twice. Remaining problems:\n` +
      lastErrors.map((error) => `  - ${error}`).join('\n'),
  );
}
