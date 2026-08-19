import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import OpenAI from 'openai';
import type { Usage } from '../types';
import { BROKEN_FILE, MOCK_FILES, MOCK_PLAN, MOCK_REPAIRS } from '../fixtures/index';

/**
 * A tool definition in the shape CLAUDE.md's prompt files declare it (Anthropic-style
 * `input_schema`). It is translated to the OpenAI function shape at call time, which is what
 * keeps the prompt files provider-agnostic.
 */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmOptions {
  dryRun: boolean;
  /** The pipeline's usage counters; both calls accumulate into this object in place. */
  usage: Usage;
}

export interface LlmClient {
  callText(system: string, user: string): Promise<string>;
  callTool(system: string, user: string, tool: ToolSchema): Promise<unknown>;
}

/** Repo root, three levels up from agent/src/tools/. dotenv reads .env from there. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Env {
  baseURL: string;
  apiKey: string;
  model: string;
}

function readEnv(): Env {
  loadDotenv({ path: resolve(REPO_ROOT, '.env') });
  const baseURL = process.env['LLM_BASE_URL'];
  const apiKey = process.env['LLM_API_KEY'];
  const model = process.env['LLM_MODEL'];

  const missing = [
    ['LLM_BASE_URL', baseURL],
    ['LLM_API_KEY', apiKey],
    ['LLM_MODEL', model],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0 || !baseURL || !apiKey || !model) {
    throw new Error(
      `Missing environment variable(s): ${missing.join(', ')}.\n` +
        `Copy .env.example to .env at the repository root and fill them in, ` +
        `or run with --dry-run to use fixtures instead of the API.`,
    );
  }

  return { baseURL, apiKey, model };
}

/** Strip a ```lang ... ``` wrapper the model may have added despite instructions. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\r?\n/, '');
  return withoutOpening.replace(/\r?\n?```$/, '').trim();
}

/**
 * Which fixture a dry-run call wants.
 *
 * The target file is read from the one place in each prompt that identifies it unambiguously:
 * the repair prompt's <file_path> tag, and the generator prompt's closing "Generate the complete
 * content of X." sentence. Scanning the whole prompt for any known fixture path does NOT work —
 * the generator prompt embeds the full plan, so every task's prompt mentions every file, and a
 * substring match silently returns the same fixture for every task.
 *
 * Resolution failure is always a hard stop — never a fallback fixture. Serving the wrong file
 * would corrupt a dry run silently, which is far worse than aborting with a readable message.
 * Known risk: this couples the fixture layer to the prompt text, so a prompt tweak must be
 * followed by a dry run to confirm fixtures still resolve.
 */
function targetFile(user: string, isRepair: boolean): string | undefined {
  const pattern = isRepair
    ? /<file_path>\s*(.+?)\s*<\/file_path>/
    : /Generate the complete content of\s+(.+?)\.\s*$/;
  return pattern.exec(user)?.[1];
}

function resolveFixture(user: string): { label: string; content: string } {
  const isRepair = user.includes('<validation_errors>');
  const table = isRepair ? MOCK_REPAIRS : MOCK_FILES;
  const label = isRepair ? 'repair' : 'generator';

  const target = targetFile(user, isRepair);
  if (target === undefined) {
    throw new Error(
      `[dry-run] ${label} fixture lookup failed: the prompt does not identify a target file. ` +
        `A ${label} prompt must ${isRepair ? 'carry a <file_path> tag' : 'end with "Generate the complete content of <path>."'}. ` +
        `No fallback is served — re-run the dry run after any prompt change.`,
    );
  }

  const match = Object.keys(table).find((path) => path === target);
  if (match !== undefined) {
    return { label, content: table[match] as string };
  }

  // A repair prompt for a file the fixture set does not break on purpose is a distinct
  // failure from a prompt naming no known file at all — say which one happened.
  if (isRepair && MOCK_FILES[target] !== undefined) {
    throw new Error(
      `[dry-run] ${label} fixture lookup failed: "${target}" has a generator fixture but ` +
        `no repair fixture. Only ${BROKEN_FILE} is broken on purpose. ` +
        `No fallback is served — fix the fixture set in agent/src/fixtures/.`,
    );
  }

  throw new Error(
    `[dry-run] ${label} fixture lookup failed: the prompt targets "${target}", which is not in ` +
      `the fixture set (${Object.keys(table).join(', ')}). ` +
      `No fallback is served — fix the fixture set in agent/src/fixtures/.`,
  );
}

export function createLlmClient({ dryRun, usage }: LlmOptions): LlmClient {
  const env = dryRun ? null : readEnv();
  const client = env ? new OpenAI({ baseURL: env.baseURL, apiKey: env.apiKey }) : null;

  function record(label: string, inputTokens: number, outputTokens: number): void {
    usage.calls += 1;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    console.log(
      `[llm:${label}] ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out tokens`,
    );
  }

  return {
    async callText(system, user) {
      if (dryRun) {
        const { label, content } = resolveFixture(user);
        usage.calls += 1;
        console.log(`[llm:${label}] dry-run fixture, 0 tokens`);
        return content;
      }

      const response = await client!.chat.completions.create({
        model: env!.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });

      const label = user.includes('<validation_errors>') ? 'repair' : 'generator';
      record(label, response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0);

      const content = stripFences(response.choices[0]?.message?.content ?? '');
      if (content.length === 0) {
        throw new Error(`[llm:${label}] the model returned empty content`);
      }
      return content;
    },

    async callTool(system, user, tool) {
      if (dryRun) {
        if (tool.name !== 'submit_plan') {
          throw new Error(
            `[dry-run] planner fixture lookup failed: no fixture exists for tool "${tool.name}". ` +
              `The fixture set only covers "submit_plan". No fallback is served.`,
          );
        }
        usage.calls += 1;
        console.log('[llm:planner] dry-run fixture, 0 tokens');
        return { tasks: MOCK_PLAN };
      }

      const response = await client!.chat.completions.create({
        model: env!.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.input_schema,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: tool.name } },
      });

      record('planner', response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0);

      const call = response.choices[0]?.message?.tool_calls?.[0];
      if (!call || call.type !== 'function') {
        throw new Error(`[llm:planner] the model did not call ${tool.name}`);
      }

      try {
        return JSON.parse(call.function.arguments);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `[llm:planner] ${tool.name} arguments were not valid JSON: ${reason}\n` +
            call.function.arguments,
        );
      }
    },
  };
}
