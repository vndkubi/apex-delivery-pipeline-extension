import * as fs from 'fs';
import * as path from 'path';

export interface CopilotPackResult {
  rootPath: string;
  createdFiles: string[];
  skippedFiles: string[];
}

interface WriteSummary {
  createdFiles: string[];
  skippedFiles: string[];
}

export function createCopilotBootstrapPack(workspaceRoot: string, owner: string): CopilotPackResult {
  const rootPath = path.join(workspaceRoot, '.github');
  const date = new Date().toISOString().slice(0, 10);
  const context = { owner: owner.trim() || 'APEX Owner', date };
  const summary: WriteSummary = { createdFiles: [], skippedFiles: [] };

  writeIfMissing(path.join(rootPath, 'copilot-instructions.md'), renderCopilotInstructions(context), summary);
  writeIfMissing(path.join(rootPath, 'prompts', 'apex-delivery.prompt.md'), renderPrompt(context), summary);
  writeIfMissing(path.join(rootPath, 'prompts', 'apex-tdd-epic.prompt.md'), renderTddPrompt(context), summary);
  writeIfMissing(path.join(rootPath, 'instructions', 'apex-delivery.instructions.md'), renderScopedInstructions(context), summary);
  writeIfMissing(path.join(rootPath, 'instructions', 'apex-pbi-role-presets.instructions.md'), renderPbiRoleInstructions(context), summary);
  writeIfMissing(path.join(rootPath, 'instructions', 'apex-tdd-micro-commit.instructions.md'), renderTddInstructions(context), summary);
  writeIfMissing(path.join(rootPath, 'agents', 'apex-delivery-orchestrator.agent.md'), renderAgent(context), summary);
  writeIfMissing(path.join(rootPath, 'agents', 'apex-tdd-epic-executor.agent.md'), renderTddAgent(context), summary);
  writeIfMissing(path.join(rootPath, 'skills', 'apex-delivery', 'SKILL.md'), renderSkill(context), summary);

  return { rootPath, ...summary };
}

function writeIfMissing(targetPath: string, content: string, summary: WriteSummary): void {
  if (fs.existsSync(targetPath)) {
    summary.skippedFiles.push(targetPath);
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  summary.createdFiles.push(targetPath);
}

function renderCopilotInstructions(context: CopilotContext): string {
  return `# Copilot Instructions - APEX Delivery Pipeline

Owner: ${context.owner}
Created: ${context.date}

## Operating Core

1. State assumptions explicitly or ask when business rules are unclear.
2. Prefer the smallest change that satisfies the approved spec.
3. Keep delivery artifacts traceable from source context to spec, plan, tasks, review, and verification.
4. Verify honestly before claiming completion.

## Delivery Flow

- Intake starts from a business idea, Jira ticket, Confluence page, or custom MCP source.
- Requirements live in specs/<feature>/spec.md.
- Implementation planning lives in specs/<feature>/plan.md and tasks.md.
- AI delivery status lives in docs/ai-delivery/epics/<KEY>/.
- External context is configured in .vscode/mcp.json.

## APEX Quality Gates

- Gate 1: Input Quality before implementation.
- Gate 2: Output Validation before review acceptance.
- Gate 3: Business Alignment before release or adoption.

## TDD Delivery Rules

- For implementation epics, prefer strict TDD with the smallest vertical slices.
- Allow local git commits on the working branch for phase-pure test:, feat: or fix:, refactor:, and prerequisite-only chore: commits.
- Do not push, merge, or publish without human review.
- Stop and escalate when acceptance criteria are ambiguous, validation fails for unrelated reasons, or the next step requires a non-obvious architecture decision.

## Recommended Entry Points

- Use .github/prompts/apex-delivery.prompt.md for delivery intake and artifact planning.
- Use .github/prompts/apex-tdd-epic.prompt.md for implementation epics that should run slice-by-slice with TDD.
- Use .github/agents/apex-tdd-epic-executor.agent.md when you want a dedicated TDD execution agent instead of a reusable prompt.

## Guardrails

- Do not overwrite existing MCP servers or .github assets without explicit approval.
- Do not treat AI output as accepted business truth without source evidence.
- Record verification gaps instead of implying a build or test passed.
`;
}

function renderPrompt(context: CopilotContext): string {
  return `---
description: "Run the APEX Delivery Pipeline from intake through spec-kit artifacts and review."
---

# APEX Delivery Pipeline

Use this prompt for APEX delivery work.

## Input

Feature or ticket: \${input:feature:Describe the feature, ticket, or business problem}
Source context: \${input:source:Jira, Confluence, custom MCP, or manual note}
Verification target: \${input:verify:How should completion be validated?}

## Instructions

1. Normalize the request into Goal, Anchor, Constraints, and Verify.
2. Create or update a spec-kit workspace under specs/.
3. Use APEX Gate 1 before implementation, Gate 2 before review acceptance, and Gate 3 before release or adoption.
4. If MCP context is needed, name the Jira, Confluence, or custom MCP source to use.
5. Report assumptions, verification evidence, and residual risks.

Owner: ${context.owner}
`;
}

function renderTddPrompt(context: CopilotContext): string {
  return `---
description: "Implement one epic using strict TDD, local micro-commits, and human review gates at push, merge, and ambiguous architecture decisions."
---

# APEX TDD Epic

Use this prompt to execute one implementation epic with strict TDD and low prompt count.

## Input

Epic summary: \${input:epic:Paste the epic summary or ticket}
Acceptance criteria: \${input:acceptanceCriteria:Paste the acceptance criteria list}
Validation strategy: \${input:validation:Name the narrowest test, smoke command, compile command, or equivalent check to use}

## Operating Contract

1. First, decompose the epic into the smallest vertical slices.
2. For each slice, execute Red -> Green -> Refactor in order.
3. Red means write or update the smallest targeted failing test first, run focused validation, and create exactly one local test: commit after the failure is observed.
4. Green means implement the minimum code to pass that targeted failure, rerun the same focused validation, and create exactly one local feat: or fix: commit after the pass is observed.
5. Refactor means improve structure without changing behavior, rerun the same focused validation, and create exactly one local refactor: commit.
6. Do not mix multiple TDD phases in one commit.
7. Do not batch multiple slices into one commit sequence.
8. Continue automatically from slice to slice without asking for confirmation unless blocked.
9. A blocker is only one of these: ambiguous acceptance criteria, missing dependency or environment capability, unrelated failing validation, or a non-obvious architecture decision not implied by the epic.
10. Do not push or merge. Stop for human review before any push, merge, release step, or architectural fork.

## Output After Each Slice

- Slice name
- Acceptance criterion covered
- Red evidence
- Green evidence
- Refactor summary
- Files changed
- Validation run
- Local commits created
- Next slice

## Final Output

- Map each acceptance criterion to slices, tests, and commits.
- List residual risks, open questions, and any human review needed before push or merge.

Owner: ${context.owner}
`;
}

function renderScopedInstructions(context: CopilotContext): string {
  return `---
applyTo: "specs/**/*.md,docs/ai-delivery/**/*.md,.vscode/mcp.json"
description: "APEX delivery artifact rules for spec-kit workspaces, epic artifacts, and MCP context."
---

# APEX Delivery Artifact Rules

- Keep source context traceable to Jira, Confluence, custom MCP, or manual input.
- Mark unknowns as Open Questions or [NEEDS CLARIFICATION].
- Do not overwrite existing MCP servers or repository Copilot assets without approval.
- Every implementation task must map to a spec requirement or acceptance criterion.
- Record verification gaps honestly.

Owner: ${context.owner}
`;
}

function renderTddInstructions(context: CopilotContext): string {
  return `---
applyTo: "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,kt,kts,cs,rs,rb,php,swift,c,cc,cpp,cxx,h,hpp}"
description: "Use strict TDD, focused validation, and phase-pure local micro-commits for implementation work across common programming languages."
---

# TDD Micro-Commit Rules

- Decompose the change into the smallest vertical slices before editing production code.
- For each slice, the first implementation action must be a failing targeted test in the nearest relevant test surface.
- Observe the failure before writing production code.
- Green means implement the minimum code needed to pass the targeted failure.
- Refactor means behavior-preserving cleanup only.
- After the first substantive edit in a phase, the very next step must be focused validation.
- Prefer this validation order: the narrowest targeted test for the slice, then the repo's focused smoke or integration check when relevant, then the repo's compile or type-check command when needed.
- Use local commit prefixes by phase: test: for Red, feat: or fix: for Green, refactor: for Refactor, and chore: only for prerequisite setup work that must happen before the first Red.
- Do not push, merge, or claim final completion from these instructions alone. Human review is required before push, merge, release, or any non-obvious architecture change.
- Stop and escalate instead of guessing when validation fails for unrelated reasons or the slice cannot be implemented without changing the approved architecture.

Owner: ${context.owner}
`;
}

function renderAgent(context: CopilotContext): string {
  return `---
name: "APEX Delivery Orchestrator"
description: "Guides APEX delivery work across intake, spec-kit artifacts, MCP context, Copilot bootstrap assets, review, verification, and ROI learning."
---

You are the APEX Delivery Orchestrator.

## Workflow

1. Confirm the business goal and source context.
2. Ensure specs/<feature>/spec.md exists before implementation planning.
3. Use plan.md and tasks.md for execution order.
4. Use .vscode/mcp.json only for approved Jira, Confluence, or custom MCP context.
5. Apply Gate 1, Gate 2, and Gate 3 before advancing phases.
6. Produce a concise completion report with verification evidence and ROI impact.

## Stop Conditions

- Critical business rules are unresolved.
- Verification cannot run and the user has not accepted the risk.
- External MCP context is required but not approved.

Owner: ${context.owner}
`;
}

function renderTddAgent(context: CopilotContext): string {
  return `---
name: "APEX TDD Epic Executor"
description: "Executes one implementation epic slice-by-slice with strict TDD, local micro-commits, focused validation, and human review gates for push, merge, and ambiguous architecture decisions."
---

You are the APEX TDD Epic Executor.

## Workflow

1. Convert the epic into the smallest vertical slices that map to acceptance criteria.
2. For each slice, execute Red -> Green -> Refactor in order.
3. Red: create or update the smallest targeted failing test, run focused validation, and create exactly one local test: commit after the failure is observed.
4. Green: implement the minimum code needed, rerun the same focused validation, and create exactly one local feat: or fix: commit.
5. Refactor: improve structure without changing behavior, rerun the same focused validation, and create exactly one local refactor: commit.
6. Continue automatically to the next slice unless blocked.

## Stop Conditions

- Acceptance criteria are ambiguous.
- Validation fails for reasons unrelated to the current slice.
- The environment is missing a required dependency or capability.
- The next step requires a non-obvious architecture decision.
- The next action would push, merge, release, or otherwise cross a human review boundary.

## Reporting Contract

After each slice, report the slice name, acceptance criterion covered, Red evidence, Green evidence, Refactor summary, files changed, validation run, local commits created, and next slice.

Owner: ${context.owner}
`;
}

function renderSkill(context: CopilotContext): string {
  return `---
name: apex-delivery
description: "Execute the APEX Delivery Pipeline using spec-kit workspaces, MCP source context, and Copilot bootstrap operating assets. Use for AI delivery intake, planning, review, verification, and ROI learning."
---

# APEX Delivery Skill

## When To Use

- Turning a business idea, Jira ticket, or Confluence page into a delivery-ready spec.
- Creating or reviewing specs/<feature>/ artifacts.
- Connecting MCP context to implementation and review work.
- Capturing delivery learnings and ROI metrics.

## Steps

1. Intake: normalize Goal, Anchor, Constraints, Verify.
2. Specify: create or update spec.md.
3. Plan: update plan.md, research.md, data-model.md, contracts/, and quickstart.md as needed.
4. Tasks: keep tasks.md executable and traceable.
5. Implement and review: map code changes to acceptance criteria.
6. Verify: record commands, manual checks, or verification gaps.
7. Learn: capture time saved, quality score, iteration count, and adoption decision.

## Quality Gates

- Gate 1: input quality.
- Gate 2: output validation.
- Gate 3: business alignment.

Owner: ${context.owner}
`;
}

interface CopilotContext {
  owner: string;
  date: string;
}

function renderPbiRoleInstructions(context: CopilotContext): string {
  return `---
applyTo: "docs/ai-delivery/epics/**/*.md"
description: "Role presets for PBI delivery artifacts across intake, investigation, design, TDD, review, QA, and release evidence."
---

# PBI Delivery Role Presets

- BA: normalize the incoming PBI, clarify unknowns, and keep acceptance criteria concrete.
- Tech Lead: explain code flow, evaluate tradeoffs, and record design decisions with rollback impact.
- Developer: implement in TDD slices and keep changed files traceable to acceptance criteria.
- Reviewer: review against PBI intent, design, tests, and residual risk instead of diff-only commentary.
- QA: decide the narrowest proving tests, edge cases, and exception-path coverage.
- Release Manager: package evidence, commands, rollout notes, and unresolved gaps before merge or release.

Owner: ${context.owner}
`;
}
