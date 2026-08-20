import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { abort } from '../tools/errors';
import { copyDir, readFiles, readTree } from '../tools/fs';
import type { LlmClient } from '../tools/llm';
import type { PipelineState } from '../types';

/** Repo root, three levels up from agent/src/stages/ — the boilerplate the agent copies. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Files the planner sees in full. Deliberately a fixed list rather than a heuristic: the
 * planner must reason about the same context on every run, and the snapshot contract names
 * exactly these — package.json, tsconfig, vite/vitest configs, MSW handlers and mock data,
 * Apollo client setup, App/entry files. Anything absent or over 20KB is skipped by readFiles.
 */
const KEY_FILES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'src/mocks/handlers.ts',
  'src/mocks/data.ts',
  'src/mocks/browser.ts',
  'src/mocks/server.ts',
  'src/graphql/client.ts',
  'src/graphql/queries.ts',
  'src/types.ts',
  'src/App.tsx',
  'src/main.tsx',
  'src/test-setup.ts',
];

/**
 * Refuse an output directory that cannot be written to safely.
 *
 * A nested `--out` is fine and stays supported — copyDir excludes the resolved destination from
 * the copy, so `--out anywhere/inside/the/repo` works. Two shapes are not merely nested but
 * pathological, and no exclusion can rescue them: the repo root itself, where the copy would
 * write the boilerplate over its own source, and an ancestor of it, where the copy's destination
 * contains the source it is reading. Both are refused up front with a message rather than
 * discovered halfway through a partially overwritten tree (hard rule 7).
 */
export function assertSafeOutDir(outDir: string): void {
  const target = resolve(outDir);

  if (target === REPO_ROOT) {
    throw abort(
      `--out resolves to the repository root (${target}).\n` +
        `The agent would copy the boilerplate over its own source. Pick a directory inside the ` +
        `repository, such as the default generated-app, or a path outside it.`,
    );
  }

  const fromOut = relative(target, REPO_ROOT);
  if (fromOut !== '' && !fromOut.startsWith('..') && !isAbsolute(fromOut)) {
    throw abort(
      `--out resolves to ${target}, which contains the repository at ${REPO_ROOT}.\n` +
        `Writing the generated app there would copy the repository into one of its own ` +
        `ancestors. Pick a directory inside the repository or a sibling of it.`,
    );
  }
}

/**
 * Stage 1: copy the boilerplate into the output directory and read the context the planner
 * needs. Deterministic — no LLM call. `llm` is accepted so every stage shares one signature
 * and pipeline.ts can call them uniformly; this stage ignores it.
 */
export async function snapshot(
  state: PipelineState,
  _llm: LlmClient,
): Promise<PipelineState> {
  assertSafeOutDir(state.outDir);

  // Exclusions live in tools/fs.ts (SNAPSHOT_EXCLUDES) and are applied by copyDir and
  // readTree alike, so the copy and the tree can never disagree about what exists.
  await copyDir(REPO_ROOT, state.outDir);

  const tree = await readTree(state.outDir);
  const files = await readFiles(state.outDir, KEY_FILES);

  return { ...state, snapshot: { tree, files } };
}
