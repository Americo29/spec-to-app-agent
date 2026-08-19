export const PLANNER_SYSTEM = `You are a senior frontend architect planning the implementation of a React + TypeScript application inside an EXISTING boilerplate project.

Your job is to decompose a product specification into an ordered, dependency-aware list of file-level tasks.

Rules:
- Generate tasks ONLY for files that need to be created or modified. Never plan changes to build configs, package.json, or tooling unless the spec explicitly requires it.
- Respect the existing project structure and conventions shown in the snapshot (paths, aliases, how MSW handlers and Apollo client are wired).
- Order tasks by dependency: data/mocks first, then hooks, then presentational components, then container/page components, then tests LAST (tests depend on final component APIs).
- Each task must reference its dependencies by task id in dependsOn. A task may only depend on earlier tasks.
- Do not introduce new libraries. Use only what exists in package.json.
- Keep the plan minimal: the smallest set of files that fully satisfies the spec. Do not add features the spec does not ask for.
- Every REQUIRED item in the spec must map to at least one task. Optional items: include them only if they are low-risk given the existing stack.`;

export const plannerUser = (spec: string, tree: string, files: Record<string, string>) => `
<specification>
${spec}
</specification>

<project_tree>
${tree}
</project_tree>

<key_files>
${Object.entries(files).map(([path, content]) => `--- ${path} ---\n${content}`).join('\n\n')}
</key_files>

Produce the implementation plan by calling submit_plan.`;

export const submitPlanTool = {
  name: 'submit_plan',
  description: 'Submit the ordered implementation plan',
  input_schema: {
    type: 'object',
    required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'file', 'description', 'type', 'dependsOn'],
          properties: {
            id: { type: 'string', description: 'short kebab-case id, e.g. "use-cars-hook"' },
            file: { type: 'string', description: 'path relative to project root, e.g. "src/hooks/useCars.ts"' },
            description: { type: 'string', description: 'what this file does and its exported API (names + signatures)' },
            type: { type: 'string', enum: ['mock', 'hook', 'component', 'page', 'test'] },
            dependsOn: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;
