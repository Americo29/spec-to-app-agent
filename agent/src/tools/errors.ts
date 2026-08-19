/**
 * A failure the CLI reports as a clean message before exiting with `exitCode`.
 *
 * Hard rule 7: a designed abort — an invalid plan after its retry, a validation loop still red
 * after three attempts — is an outcome, not a crash. It must never surface as a raw stack trace.
 * A tagged plain Error rather than a subclass, per the no-classes rule; the tag is what lets the
 * CLI tell a designed abort from an unexpected throw.
 */
export interface AbortError extends Error {
  exitCode: number;
}

export function abort(message: string, exitCode = 1): AbortError {
  const error = new Error(message) as AbortError;
  error.exitCode = exitCode;
  return error;
}

export function isAbortError(error: unknown): error is AbortError {
  return error instanceof Error && typeof (error as AbortError).exitCode === 'number';
}
