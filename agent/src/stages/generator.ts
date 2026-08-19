import { join } from 'node:path';
import { GENERATOR_SYSTEM, generatorUser } from '../prompts/generator';
import { abort } from '../tools/errors';
import { readFiles, writeFile } from '../tools/fs';
import type { LlmClient } from '../tools/llm';
import type { PipelineState, Task, TaskType } from '../types';

/**
 * Boilerplate files each task type receives, beyond its own dependencies.
 *
 * This mapping is deterministic code on purpose. Letting the model choose its own context
 * would make every run's input — and therefore every failure — irreproducible, and it would
 * spend a call deciding what to read instead of writing the file.
 */
const BOILERPLATE_CONTEXT: Record<TaskType, string[]> = {
  // Existing MSW handlers + the schema the mock data must satisfy.
  mock: ['src/mocks/handlers.ts', 'src/mocks/data.ts', 'src/types.ts'],
  // Apollo client setup, the existing query documents, and the MSW handlers. queries.ts is here
  // because the hook's document must match what the handlers actually answer: if the model
  // invents its own document instead, the mismatch surfaces as a runtime test failure while
  // typecheck stays green — the one failure shape the repair loop is worst at fixing.
  hook: ['src/graphql/client.ts', 'src/graphql/queries.ts', 'src/mocks/handlers.ts'],
  // Nothing beyond deps: MUI is known, and the dependency files carry the local conventions.
  component: [],
  page: [],
  // The file under test arrives through dependsOn; this adds the harness and the mock data.
  // queries.ts for the same reason as hook, and one specific to tests: the convention example
  // src/__tests__/Example.test.tsx builds MockedProvider mocks around GET_CARS, so a test that
  // follows it needs the real document. A test depends only on the component, never on the hook,
  // so dependency context alone never carries it.
  test: ['vitest.config.ts', 'src/test-setup.ts', 'src/mocks/handlers.ts', 'src/graphql/queries.ts'],
};

/**
 * The boilerplate's own example component and test, given to every task as few-shot style
 * references. The planner only ever sees these two by name, so matching the project's
 * conventions — import style, component shape, how a test is written — rests entirely here.
 *
 * Read directly from the copy rather than from state.snapshot.files: the planner's KEY_FILES
 * is a deliberately fixed context set and is not expanded to serve the generator.
 */
const CONVENTION_EXAMPLES = ['src/components/Example.tsx', 'src/__tests__/Example.test.tsx'];

/** Strip a ```lang ... ``` wrapper the model may have added despite the prompt forbidding it. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\r?\n/, '').replace(/\r?\n?```$/, '').trim();
}

/**
 * Everything one task sees, assembled deterministically: direct dependencies first, then the
 * type's boilerplate files, then the convention examples.
 *
 * Direct dependencies only — never the transitive closure. A task's contract with its
 * grand-dependencies is whatever its direct dependency exports, and pulling in the whole
 * closure would grow the prompt with files the task cannot legitimately import.
 */
export function assembleContext(
  task: Task,
  state: PipelineState,
  boilerplate: Record<string, string>,
  conventions: Record<string, string>,
): Record<string, string> {
  const context: Record<string, string> = {};

  const byId = new Map(state.plan.map((t) => [t.id, t]));
  for (const depId of task.dependsOn) {
    const dep = byId.get(depId);
    if (!dep) {
      throw abort(`Task "${task.id}" depends on "${depId}", which is not in the plan.`);
    }
    const content = state.generated[dep.file];
    if (content === undefined) {
      throw abort(
        `Task "${task.id}" depends on "${depId}" (${dep.file}), which has not been generated ` +
          `yet. The plan is not in dependency order.`,
      );
    }
    context[dep.file] = content;
  }

  for (const path of BOILERPLATE_CONTEXT[task.type]) {
    const content = boilerplate[path];
    if (content !== undefined) context[path] = content;
  }

  for (const [path, content] of Object.entries(conventions)) {
    if (context[path] === undefined) context[path] = content;
  }

  return context;
}

/**
 * Stage 3: one LLM call per task, walking the plan in the topological order the planner
 * already produced. No retries — a file that fails to compile is the validator's problem,
 * and retrying blindly here would burn calls without the error text that makes a fix possible.
 */
export async function generator(state: PipelineState, llm: LlmClient): Promise<PipelineState> {
  const needed = [...new Set(Object.values(BOILERPLATE_CONTEXT).flat())];
  const boilerplate = await readFiles(state.outDir, needed);
  const conventions = await readFiles(state.outDir, CONVENTION_EXAMPLES);

  let current = state;

  for (const task of current.plan) {
    const context = assembleContext(task, current, boilerplate, conventions);
    const user = generatorUser(task, current.spec, current.plan, context);

    const raw = await llm.callText(GENERATOR_SYSTEM, user);
    const content = stripFences(raw);
    if (content.length === 0) {
      throw abort(`Task "${task.id}" (${task.file}) produced empty content.`);
    }

    await writeFile(join(current.outDir, task.file), content);
    current = { ...current, generated: { ...current.generated, [task.file]: content } };
    console.log(`[stage:generator] ${task.id} → ${task.file} (${content.length} chars)`);
  }

  return current;
}
