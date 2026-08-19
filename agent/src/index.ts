import { relative } from 'node:path';
import { runPipeline, STAGE_NAMES } from './pipeline';
import { isAbortError } from './tools/errors';
import { readEnv } from './tools/llm';
import type { PipelineState } from './types';

const USAGE = `spec-to-app agent

  npm run agent -- --spec <path> [--out <dir>] [--dry-run]

  --spec <path>   natural-language specification to build from (required)
  --out <dir>     output directory (default: generated-app)
  --dry-run       use bundled fixtures instead of the API: no key, no network, no cost
  --help          show this message

Environment (see .env.example at the repository root):
  LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
`;

interface Args {
  spec: string | null;
  out: string;
  dryRun: boolean;
  help: boolean;
}

/**
 * Plain argv parsing. A flag library would be a third dependency for four flags, and the
 * failure modes here — a missing value, an unknown flag — are worth spelling out anyway.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = { spec: null, out: 'generated-app', dryRun: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--spec':
      case '--out': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new Error(`${arg} needs a value.`);
        }
        if (arg === '--spec') args.spec = value;
        else args.out = value;
        i += 1;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

/** Relative when that is shorter and readable, absolute when the target sits outside cwd. */
function displayPath(target: string): string {
  const rel = relative(process.cwd(), target);
  return rel === '' || rel.startsWith('..') ? target : rel;
}

function printSummary(state: PipelineState, stagesRun: string[], status: string): void {
  const { usage, validation } = state;
  const rows: Array<[string, string]> = [
    ['Stages executed', stagesRun.join(' → ')],
    ['LLM calls', String(usage.calls)],
    ['Tokens in / out', `${usage.inputTokens.toLocaleString()} / ${usage.outputTokens.toLocaleString()}`],
    ['Validation attempts', `${validation.attempt} of 3`],
    ['Final status', status],
    ['Output path', displayPath(state.outDir)],
  ];

  const width = Math.max(...rows.map(([label]) => label.length));
  console.log('\n' + '─'.repeat(width + 34));
  for (const [label, value] of rows) console.log(`  ${pad(label, width)}   ${value}`);
  if (state.dryRun) {
    console.log(`  ${pad('', width)}   (dry run: fixtures, no API calls, tokens not counted)`);
  }
  console.log('─'.repeat(width + 34));
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 1;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.spec) {
    console.error(`--spec is required.\n\n${USAGE}`);
    return 1;
  }

  // Validate the environment before any work starts: discovering a missing key after the
  // snapshot has already copied a tree wastes the user's time for no reason.
  if (!args.dryRun) {
    try {
      readEnv();
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }

  try {
    const state = await runPipeline({ specPath: args.spec, outDir: args.out, dryRun: args.dryRun });
    printSummary(state, [...STAGE_NAMES], 'passed');
    console.log(`\nRun it:  cd ${displayPath(state.outDir)} && npm install && npm run dev\n`);
    return 0;
  } catch (error) {
    if (isAbortError(error)) {
      // A designed outcome — an unrepairable plan, a validation loop that stayed red. Report it
      // as a result, not as a crash (hard rule 7).
      console.error(`\n${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('\nThe agent hit an unexpected error. This is a bug, not a designed outcome:\n');
    console.error(error);
    process.exitCode = 1;
  });
