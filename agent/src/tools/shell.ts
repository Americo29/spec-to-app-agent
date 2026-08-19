import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;      // 124 when the command was killed on timeout
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  /** Kill the process after this many milliseconds. Default 10 minutes. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Run a command with an explicit argument array — never a shell string, so nothing in a
 * file path or error message can be interpreted as shell syntax.
 *
 * Never throws on a non-zero exit: a failing typecheck is data for the repair loop, not an
 * exception. Only a spawn failure (binary missing) rejects.
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: CommandOptions = {},
): Promise<CommandResult> {
  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  console.log(`[tool:runCommand] ${cmd} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          code: TIMEOUT_EXIT_CODE,
          stdout,
          stderr: `${stderr}\n[runCommand] killed after ${timeoutMs}ms`,
        });
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
