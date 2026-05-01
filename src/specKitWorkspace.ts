import * as fs from 'fs';
import * as path from 'path';

export interface SpecKitWorkspaceInput {
  workspaceRoot: string;
  specsRelativePath: string;
  title: string;
  source: string;
  owner: string;
}

export interface SpecKitWorkspaceResult {
  featureId: string;
  folderPath: string;
  createdFiles: string[];
  skippedFiles: string[];
}

interface WriteSummary {
  createdFiles: string[];
  skippedFiles: string[];
}

export function createSpecKitWorkspace(input: SpecKitWorkspaceInput): SpecKitWorkspaceResult {
  const specsDir = path.resolve(input.workspaceRoot, input.specsRelativePath || 'specs');
  fs.mkdirSync(specsDir, { recursive: true });

  const featureId = nextFeatureId(specsDir, input.title);
  const folderPath = path.join(specsDir, featureId);
  const date = new Date().toISOString().slice(0, 10);
  const context = {
    title: input.title.trim(),
    source: input.source.trim() || 'Manual APEX intake',
    owner: input.owner.trim() || 'APEX Owner',
    date,
    featureId,
  };
  const summary: WriteSummary = { createdFiles: [], skippedFiles: [] };

  writeIfMissing(path.join(folderPath, 'spec.md'), renderSpec(context), summary);
  writeIfMissing(path.join(folderPath, 'plan.md'), renderPlan(context), summary);
  writeIfMissing(path.join(folderPath, 'tasks.md'), renderTasks(context), summary);
  writeIfMissing(path.join(folderPath, 'research.md'), renderResearch(context), summary);
  writeIfMissing(path.join(folderPath, 'data-model.md'), renderDataModel(context), summary);
  writeIfMissing(path.join(folderPath, 'contracts', 'README.md'), renderContracts(context), summary);
  writeIfMissing(path.join(folderPath, 'quickstart.md'), renderQuickstart(context), summary);

  return { featureId, folderPath, ...summary };
}

function nextFeatureId(specsDir: string, title: string): string {
  const existingNumbers = fs.existsSync(specsDir)
    ? fs.readdirSync(specsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.match(/^(\d{3,})-/)?.[1])
      .filter((value): value is string => value !== undefined)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value))
    : [];
  const nextNumber = existingNumbers.length === 0 ? 1 : Math.max(...existingNumbers) + 1;
  return `${String(nextNumber).padStart(3, '0')}-${slugify(title)}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/g, '');
  return slug || 'apex-delivery-feature';
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

function renderSpec(context: SpecContext): string {
  return `# ${context.title} - Specification

> Workspace: ${context.featureId}
> Status: Draft
> Owner: ${context.owner}
> Created: ${context.date}
> Source: ${context.source}

## Purpose

Describe the business problem, target users, and measurable outcome.

## User Stories

- As a [role], I want [capability], so that [business outcome].

## Functional Requirements

- FR-001: The workflow must preserve traceability from source context to delivery tasks.
- FR-002: Open questions must be explicit instead of guessed.
- FR-003: External context from Jira, Confluence, or custom MCP must be identified when used.

## Acceptance Criteria

- AC1: GIVEN a source idea or ticket WHEN the spec is reviewed THEN the goal, constraints, and verification path are clear.
- AC2: GIVEN unresolved business rules WHEN the spec is drafted THEN they appear under Open Questions.
- AC3: GIVEN MCP context is used WHEN delivery artifacts are created THEN the source is recorded.

## Out of Scope

- Production deployment without human release approval.
- Automatic changes to Jira, Confluence, or repository governance files without review.

## Open Questions

- [NEEDS CLARIFICATION: Which business metric proves success?]
- [NEEDS CLARIFICATION: Which source is authoritative if Jira and Confluence disagree?]

## APEX Gate 1 - Input Quality

- Objective clearly defined: [Yes/No]
- Context sufficient: [Yes/No]
- Constraints specified: [Yes/No]
- Expected output format defined: [Yes/No]
`;
}

function renderPlan(context: SpecContext): string {
  return `# ${context.title} - Implementation Plan

> Spec: ./spec.md
> Owner: ${context.owner}
> Created: ${context.date}

## Architecture

This feature uses the APEX Delivery Pipeline flow:

1. Intake source context from free text, Jira, Confluence, or custom MCP.
2. Capture the requirement in spec-kit artifacts under this workspace.
3. Use Copilot bootstrap assets under .github/ to guide repeatable implementation and review.
4. Verify outputs against APEX Gate 1, Gate 2, and Gate 3.

## Requirement Traceability

| Requirement | Plan Element | Verification |
|---|---|---|
| FR-001 | spec.md -> tasks.md mapping | Review checklist |
| FR-002 | Open Questions section | Gate 1 review |
| FR-003 | Source notes in spec and research | Gate 3 review |

## Supporting Artifacts

- research.md captures context sources, assumptions, and ROI hypothesis.
- data-model.md defines delivery artifact relationships.
- contracts/ captures expected source-context and workflow-contract shapes.
- quickstart.md defines the minimum validation path.

## Verification Strategy

- Run extension diagnostics after code changes.
- Review generated artifacts for completeness and traceability.
- Validate MCP configuration manually when external context is required.

## APEX Gate 2 - Output Validation

- Accuracy: [Yes/No]
- Completeness: [Yes/No]
- Relevance: [Yes/No]
- Actionability: [Yes/No]
`;
}

function renderTasks(context: SpecContext): string {
  return `# ${context.title} - Tasks

> Generated for: ${context.featureId}
> Owner: ${context.owner}
> Created: ${context.date}

## Phase 1 - Intake

- [ ] T-001 Capture source context and business goal.
- [ ] T-002 Identify Jira, Confluence, or custom MCP context sources.
- [ ] T-003 Resolve blocking open questions or mark them for review.

## Phase 2 - Spec Kit

- [ ] T-004 Review spec.md for Gate 1 readiness.
- [ ] T-005 Update plan.md with implementation decisions.
- [ ] T-006 Add contracts or data-model details when behavior crosses systems.

## Phase 3 - Copilot Bootstrap

- [ ] T-007 Confirm .github instructions, prompt, agent, and skill assets exist or are intentionally skipped.
- [ ] T-008 Use the generated prompt to run implementation or review through Copilot.

## Phase 4 - Verification

- [ ] T-009 Run TypeScript diagnostics or compile when dependencies are installed.
- [ ] T-010 Record residual risks and ROI metrics.

## Checkpoint

- Do not move to implementation until Gate 1 passes.
- Do not move to release until Gate 2 and Gate 3 evidence is recorded.
`;
}

function renderResearch(context: SpecContext): string {
  return `# ${context.title} - Research

## Hypothesis

If we combine aidlc-style VS Code workflow, spec-kit artifacts, and copilot-bootstrap operating assets, then delivery traceability and review readiness will improve because context, plans, tasks, and AI instructions share one workflow surface.

## Source Context

- Primary source: ${context.source}
- MCP sources considered: Jira, Confluence, custom MCP
- Repo workflow sources considered: specs/, .github/, docs/ai-delivery/epics/

## Decisions To Validate

| Decision | Baseline | Variable | Risk |
|---|---|---|---|
| Use spec-kit workspace | Markdown-only epic artifacts | specs/<feature>/ package | Duplicate artifacts if ownership is unclear |
| Generate Copilot pack | Manual prompts | .github prompt/agent/skill assets | Overwriting existing team config |
| Use MCP for source context | Manual copy/paste | Jira/Confluence/custom MCP | Unauthorized or stale context |

## APEX Gate 3 - Business Alignment

- Solves a real delivery problem: [Yes/No]
- ROI measurable: [Yes/No]
- Repeatable across teams: [Yes/No]
- Governance acceptable: [Yes/No]
`;
}

function renderDataModel(context: SpecContext): string {
  return `# ${context.title} - Data Model

## Entities

| Entity | Purpose | Storage |
|---|---|---|
| Delivery Epic | Tracks phase status and artifact completion | docs/ai-delivery/epics/<KEY>/ |
| Feature Workspace | Holds spec-kit artifacts for implementation | specs/${context.featureId}/ |
| Copilot Operating Pack | Guides AI execution and review | .github/ |
| MCP Server Entry | Connects external context sources | .vscode/mcp.json |

## Relationships

- A Delivery Epic may link to one Feature Workspace.
- A Feature Workspace may cite Jira, Confluence, or custom MCP sources.
- A Copilot Operating Pack should reference the feature workspace and APEX gates.

## Invariants

- Existing MCP servers and .github assets are not overwritten by default.
- Open questions remain visible until resolved by a human owner.
`;
}

function renderContracts(context: SpecContext): string {
  return `# ${context.title} - Contracts

## Source Context Contract

| Field | Required | Notes |
|---|---|---|
| sourceType | Yes | free-text, jira, confluence, custom-mcp |
| sourceReference | Yes | URL, ticket key, page title, or local note |
| businessGoal | Yes | Outcome to verify |
| constraints | Recommended | Non-goals, compliance, dependency limits |
| acceptanceCriteria | Recommended | Given/When/Then preferred |

## Workflow Contract

- spec.md is the first durable requirement artifact.
- plan.md records implementation decisions.
- tasks.md records execution order and verification checkpoints.
- quickstart.md records the repeatable validation path.
`;
}

function renderQuickstart(context: SpecContext): string {
  return `# ${context.title} - Quickstart

## Minimum Flow

1. Review spec.md and resolve blocking Open Questions.
2. Configure MCP if Jira, Confluence, or custom context is needed.
3. Review plan.md and tasks.md.
4. Use the APEX Delivery prompt or agent from .github/ to implement or review.
5. Record verification results and ROI notes.

## Validation

- Gate 1 passes before implementation starts.
- Gate 2 passes before review is accepted.
- Gate 3 passes before release or adoption decision.

## Expected Output

- A reviewed spec-kit workspace under specs/${context.featureId}/.
- Optional Copilot operating assets under .github/.
- Optional MCP context under .vscode/mcp.json.
`;
}

interface SpecContext {
  title: string;
  source: string;
  owner: string;
  date: string;
  featureId: string;
}