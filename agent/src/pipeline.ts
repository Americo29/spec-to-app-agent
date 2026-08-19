import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generator } from './stages/generator';
import { planner } from './stages/planner';
import { snapshot } from './stages/snapshot';
import { validator } from './stages/validator';
import { abort } from './tools/errors';
import { createLlmClient } from './tools/llm';
import type { PipelineState } from './types';

export interface PipelineOptions {
  specPath: string;
  outDir: string;
  dryRun: boolean;
}

/**
 * The whole workflow, as a list. The control flow is here, in code — the model never decides
 * what happens next, only what goes inside a single bounded step.
 */
const STAGES = [
  { name: 'snapshot', run: snapshot },
  { name: 'planner', run: planner },
  { name: 'generator', run: generator },
  { name: 'validator', run: validator },
] as const;

export const STAGE_NAMES = STAGES.map((stage) => stage.name);

export async function runPipeline(options: PipelineOptions): Promise<PipelineState> {
  const specPath = resolve(options.specPath);
  let spec: string;
  try {
    spec = await readFile(specPath, 'utf8');
  } catch {
    throw abort(`Cannot read spec file: ${specPath}`);
  }
  if (spec.trim().length === 0) {
    throw abort(`Spec file is empty: ${specPath}`);
  }

  // One Usage object, shared: state carries it and the client accumulates into it in place,
  // so the summary is accurate no matter which stage made the call.
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  let state: PipelineState = {
    specPath,
    spec,
    outDir: resolve(options.outDir),
    dryRun: options.dryRun,
    snapshot: { tree: '', files: {} },
    plan: [],
    generated: {},
    validation: { attempt: 0, passed: false, errors: [] },
    usage,
  };

  const llm = createLlmClient({ dryRun: options.dryRun, usage });

  for (const stage of STAGES) {
    console.log(`\n=== ${stage.name} ===`);
    state = await stage.run(state, llm);
  }

  return state;
}
