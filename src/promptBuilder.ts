// src/promptBuilder.ts
import type { DelegationSpec } from './config/types.js';

export function buildPrompt(spec: DelegationSpec): string {
  const whitelist = spec.whitelist.map((p) => `  - ${p}`).join('\n');
  const verbatim = spec.verbatimFiles
    ? '\n## Files to write VERBATIM (exactly as given, no additions):\n' +
      Object.entries(spec.verbatimFiles)
        .map(([path, body]) => `### ${path}\n\`\`\`\n${body}\n\`\`\``)
        .join('\n')
    : '';

  return `# Delegated task ${spec.taskId}

## What to do
${spec.instructions}

## Files you MAY create or modify (whitelist — nothing else is allowed)
${whitelist}
You may touch ONLY the files above. Do not create, move, or delete anything else.

## Hard constraints
- Never run git push or any destructive/irreversible command.
- Do not create unrequested files: no extra .md, no README, no handoff notes.
- Write any provided content verbatim; do not embellish or reformat it.
- Stay inside the target repo; do not touch other repos or data dumps.
${verbatim}

## Completion criterion (must be verifiably true when you finish)
${spec.completionCriterion}

## Required report format
Report as a list of "command run -> result", then a diff-stat, then any
anomalies. No prose narrative.`;
}
