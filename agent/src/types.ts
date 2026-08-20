export type TaskType = 'mock' | 'hook' | 'component' | 'page' | 'test';

export interface Task {
  id: string;            // kebab-case, e.g. "use-cars-hook"
  file: string;          // path relative to generated app root
  description: string;   // includes the exported API (names + signatures)
  type: TaskType;
  dependsOn: string[];   // ids of earlier tasks
}

export interface ValidationError {
  file: string;          // best-effort file attribution
  raw: string;           // untouched error text (fed to repair as-is)
  source: 'typecheck' | 'test' | 'build';   // which check produced it
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface PipelineState {
  specPath: string;
  spec: string;
  outDir: string;                              // generated-app/
  dryRun: boolean;
  snapshot: { tree: string; files: Record<string, string> };
  plan: Task[];
  generated: Record<string, string>;           // file → content
  validation: { attempt: number; passed: boolean; errors: ValidationError[] };
  usage: Usage;
}
