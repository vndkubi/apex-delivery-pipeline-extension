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
  writeIfMissing(path.join(rootPath, 'instructions', 'apex-delivery.instructions.md'), renderScopedInstructions(context), summary);
  writeIfMissing(path.join(rootPath, 'agents', 'apex-delivery-orchestrator.agent.md'), renderAgent(context), summary);
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