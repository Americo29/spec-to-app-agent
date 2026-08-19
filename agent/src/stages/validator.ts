import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPAIR_SYSTEM, repairUser } from '../prompts/repair';
import { abort } from '../tools/errors';
import { writeFile } from '../tools/fs';
import type { LlmClient } from '../tools/llm';
import { runCommand } from '../tools/shell';
import type { PipelineState, Task, ValidationError } from '../types';

const MAX_ATTEMPTS = 3;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_TIMEOUT_MS = 5 * 60 * 1000;

/** Errors with no file attribution land here. Reported, never silently dropped. */
export const UNATTRIBUTED = '';

/** Vitest colours its output; the ESC byte is written as an escape, never a literal. */
const ANSI = /\u001b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * tsc, non-pretty (it drops colour and framing when stdout is not a TTY, which is how
 * runCommand always invokes it):
 *   src/components/WidgetList.tsx(5,9): error TS2322: Type 'number' is not assignable ...
 * Errors with no file prefix — bad tsconfig, no inputs found — keep their text and go to the
 * catch-all rather than being dropped.
 */
export function parseTypecheck(output: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const line of stripAnsi(output).split('\n')) {
    if (!/error TS\d+:/.test(line)) continue;
    const match = /^(.*?)\((\d+),(\d+)\):\s+error TS\d+:/.exec(line.trim());
    errors.push({
      file: match?.[1] ?? UNATTRIBUTED,
      raw: line.trim(),
      source: 'typecheck',
    });
  }
  return errors;
}

/**
 * Vitest prints a "Failed Tests" section where each failure opens with:
 *   FAIL  src/__tests__/Failing.test.tsx > suite > case
 * followed by the assertion message and the rendered DOM. The whole block is kept as `raw` —
 * ValidationError.raw is fed to the repair prompt untouched, and for a test failure the DOM dump
 * is often the only thing that says what actually rendered.
 *
 * A failing run with no parsable FAIL header (a config error, a crash before collection) keeps
 * its entire output in the catch-all instead of being reported as "no errors".
 */
export function parseTests(output: string): ValidationError[] {
  const clean = stripAnsi(output);
  const lines = clean.split('\n');

  // Every FAIL header, in both forms Vitest emits:
  //   FAIL  src/x.test.tsx > suite > case      a failing assertion
  //   FAIL  src/x.test.tsx [ src/x.test.tsx ]  the suite could not be collected at all
  const headers = lines
    .map((line, index) => {
      const match = /^\s*FAIL\s+(\S+)/.exec(line);
      return match ? { index, file: match[1] as string, suiteLevel: /\[.*\]\s*$/.test(line) } : null;
    })
    .filter((header): header is { index: number; file: string; suiteLevel: boolean } => header !== null);

  if (headers.length > 0) {
    // A collection error prints its cause once, after the last header, and it applies to every
    // suite that failed to load — so it travels with each of them rather than only the last.
    const lastHeader = headers[headers.length - 1] as { index: number };
    const tail = lines
      .slice(lastHeader.index + 1)
      .filter((line) => /^\s*(Error|Caused by):/.test(line))
      .join('\n')
      .trim();

    return headers.map((header, position) => {
      const next = headers[position + 1];
      const own = lines.slice(header.index, next ? next.index : lines.length).join('\n').trim();
      const raw = header.suiteLevel && tail && !own.includes(tail) ? `${own}\n${tail}` : own;
      return { file: header.file, raw, source: 'test' as const };
    });
  }

  // No recognised marker. The run still failed — the caller only calls this on a non-zero exit —
  // so report it, but strip npm's script echo and Vitest's banner first. Reporting those as the
  // failure is what turned a real collection error into an unattributed phantom.
  const meaningful = lines.filter(
    (line) => line.trim() !== '' && !/^\s*>\s/.test(line) && !/^\s*RUN\s+v\d/.test(line),
  );
  return [
    {
      file: UNATTRIBUTED,
      raw:
        meaningful.length > 0
          ? meaningful.join('\n').trim()
          : 'The test command exited non-zero but produced no recognisable failure output.',
      source: 'test',
    },
  ];
}

/** file -> its errors. The catch-all key is always reported, never repaired. */
export function groupByFile(errors: ValidationError[]): Map<string, ValidationError[]> {
  const grouped = new Map<string, ValidationError[]>();
  for (const error of errors) {
    const bucket = grouped.get(error.file);
    if (bucket) bucket.push(error);
    else grouped.set(error.file, [error]);
  }
  return grouped;
}

async function ensureInstalled(outDir: string): Promise<void> {
  if (existsSync(join(outDir, 'node_modules'))) {
    console.log('[stage:validator] node_modules present, skipping install');
    return;
  }
  const result = await runCommand('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: outDir,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw abort(
      `npm install failed in ${outDir} (exit ${result.code}).\n` +
        `${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

/**
 * One validation pass: typecheck, then tests. Both always run, even when typecheck fails —
 * Vite transpiles without type-checking, so tests surface a different class of defect, and with
 * only three attempts available every pass should return as much signal as it can.
 */
async function validateOnce(outDir: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  const typecheck = await runCommand('npm', ['run', 'typecheck'], {
    cwd: outDir,
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  if (typecheck.code !== 0) {
    errors.push(...parseTypecheck(`${typecheck.stdout}\n${typecheck.stderr}`));
  }

  const tests = await runCommand('npm', ['run', 'test', '--', '--run'], {
    cwd: outDir,
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  if (tests.code !== 0) {
    errors.push(...parseTests(`${tests.stdout}\n${tests.stderr}`));
  }

  return errors;
}

/**
 * What a test task exercises, resolved from the plan: a `test` task's dependsOn names it.
 * Returns null when the plan cannot answer — the caller then repairs the test itself and says so.
 */
function fileUnderTest(testFile: string, state: PipelineState): string | null {
  const task = state.plan.find((candidate) => candidate.file === testFile);
  if (!task) return null;
  const byId = new Map<string, Task>(state.plan.map((candidate) => [candidate.id, candidate]));
  const deps = task.dependsOn
    .map((id) => byId.get(id))
    .filter((dep): dep is Task => dep !== undefined);
  // Prefer a non-test dependency: a test that depends on another test is exercising neither.
  const subject = deps.find((dep) => dep.type !== 'test') ?? deps[0];
  return subject?.file ?? null;
}

export interface RepairTarget {
  /** The file to rewrite. */
  file: string;
  errors: ValidationError[];
  /** Extra context — for a retargeted test failure, the failing test itself. */
  context: Record<string, string>;
}

/**
 * Decide what to rewrite for each error.
 *
 * Typecheck errors name their own file. Test failures do NOT: a failing assertion almost always
 * means the implementation is wrong, not the test. Repairing the test to match broken code is how
 * an agent produces a green run whose tests assert nothing — the exact outcome this validation
 * design exists to prevent, and one that no amount of green output would reveal.
 */
export function planRepairs(
  errors: ValidationError[],
  state: PipelineState,
  contentOf: (file: string) => string | undefined,
): RepairTarget[] {
  const targets = new Map<string, RepairTarget>();

  const add = (file: string, error: ValidationError, context: Record<string, string>): void => {
    const existing = targets.get(file);
    if (existing) {
      existing.errors.push(error);
      Object.assign(existing.context, context);
    } else {
      targets.set(file, { file, errors: [error], context });
    }
  };

  for (const error of errors) {
    if (error.file === UNATTRIBUTED) continue;

    if (error.source !== 'test') {
      add(error.file, error, {});
      continue;
    }

    const subject = fileUnderTest(error.file, state);
    if (subject === null || subject === error.file) {
      console.log(
        `[stage:validator] cannot resolve the file under test for ${error.file}; ` +
          `repairing the test itself`,
      );
      add(error.file, error, {});
      continue;
    }

    console.log(`[stage:validator] test failure in ${error.file} → repairing ${subject}`);
    const testContent = contentOf(error.file);
    add(subject, error, testContent === undefined ? {} : { [error.file]: testContent });
  }

  return [...targets.values()];
}

/** Direct dependencies of the task that owns `file`, as the repair prompt expects them. */
function dependencyFiles(file: string, state: PipelineState): Record<string, string> {
  const owner = state.plan.find((task) => task.file === file);
  if (!owner) return {};
  const byId = new Map<string, Task>(state.plan.map((task) => [task.id, task]));
  const deps: Record<string, string> = {};
  for (const id of owner.dependsOn) {
    const dep = byId.get(id);
    const content = dep ? state.generated[dep.file] : undefined;
    if (dep && content !== undefined) deps[dep.file] = content;
  }
  return deps;
}

/** state.generated first, then disk: outDir may hold files this run did not write. */
async function currentContent(file: string, state: PipelineState): Promise<string | null> {
  const remembered = state.generated[file];
  if (remembered !== undefined) return remembered;
  try {
    return await readFile(join(state.outDir, file), 'utf8');
  } catch {
    return null;
  }
}

function summarise(errors: ValidationError[]): string {
  const lines: string[] = [];
  for (const [file, fileErrors] of groupByFile(errors)) {
    const label = file === UNATTRIBUTED ? '(unattributed)' : file;
    lines.push(`  ${label} — ${fileErrors.length} error(s)`);
    for (const error of fileErrors.slice(0, 3)) {
      lines.push(`      [${error.source}] ${error.raw.split('\n')[0]}`);
    }
    if (fileErrors.length > 3) lines.push(`      … ${fileErrors.length - 3} more`);
  }
  return lines.join('\n');
}

/**
 * Stage 4: validate, repair, re-validate — bounded at three validation passes, so at most two
 * repair rounds. Still red after the third is a designed outcome, not a crash: it aborts with a
 * summary the human can act on.
 */
export async function validator(state: PipelineState, llm: LlmClient): Promise<PipelineState> {
  await ensureInstalled(state.outDir);

  let current = state;
  let errors: ValidationError[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    errors = await validateOnce(current.outDir);
    current = { ...current, validation: { attempt, passed: errors.length === 0, errors } };

    if (errors.length === 0) {
      console.log(`[stage:validator] attempt ${attempt}: green`);
      return current;
    }

    const grouped = groupByFile(errors);
    const unattributed = grouped.get(UNATTRIBUTED) ?? [];
    const repairable = [...grouped.entries()].filter(([file]) => file !== UNATTRIBUTED);
    console.log(
      `[stage:validator] attempt ${attempt}: ${errors.length} error(s) across ` +
        `${repairable.length} file(s)` +
        (unattributed.length > 0 ? `, ${unattributed.length} unattributed` : ''),
    );
    for (const error of unattributed) {
      console.log(`[stage:validator] unattributed [${error.source}] ${error.raw.split('\n')[0]}`);
    }

    // Nothing to repair is a distinct outcome, not a spent attempt. Burning the remaining passes
    // re-running an identical check with no repair call in between wastes time and, worse, reports
    // "3 attempts" as if the loop had tried something three times.
    if (repairable.length === 0) {
      throw abort(
        `Validation failed on attempt ${attempt} with no repairable file.\n` +
          `${summarise(errors)}\n\n` +
          `Every failure is unattributed, so there is nothing to send to the repair prompt. ` +
          `This usually means the failure is in configuration or collection rather than in a ` +
          `generated file. The app is in ${current.outDir}.`,
      );
    }

    if (attempt === MAX_ATTEMPTS) break;

    // Reading every candidate up front keeps planRepairs synchronous and testable.
    const known: Record<string, string> = { ...current.generated };
    for (const [file] of repairable) {
      if (known[file] === undefined) {
        const onDisk = await currentContent(file, current);
        if (onDisk !== null) known[file] = onDisk;
      }
    }

    for (const target of planRepairs(errors, current, (file) => known[file])) {
      const { file, errors: fileErrors } = target;
      const content = known[file] ?? (await currentContent(file, current));
      if (content === null || content === undefined) {
        console.log(`[stage:validator] cannot repair ${file}: not on disk and not generated`);
        continue;
      }
      const raw = fileErrors.map((error) => error.raw).join('\n\n');
      const repaired = await llm.callText(
        REPAIR_SYSTEM,
        repairUser(file, content, raw, {
          ...dependencyFiles(file, current),
          ...target.context,
        }),
      );
      const trimmed = repaired.trim();
      if (trimmed.length === 0) {
        console.log(`[stage:validator] repair of ${file} returned empty, keeping original`);
        continue;
      }
      await writeFile(join(current.outDir, file), trimmed);
      current = { ...current, generated: { ...current.generated, [file]: trimmed } };
    }
  }

  throw abort(
    `Validation still failing after ${MAX_ATTEMPTS} attempts.\n` +
      `${summarise(errors)}\n\n` +
      `The generated app is in ${current.outDir}; the errors above are what remains.`,
  );
}
