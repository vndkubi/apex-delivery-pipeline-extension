# SOP: APEX Delivery Pipeline VS Code Extension

Standard operating procedure for using a VS Code extension to manage AI-assisted delivery workflows with file-based epics, spec-kit feature workspaces, Copilot bootstrap operating assets, measurable quality gates, ROI tracking, and optional MCP context from Jira, Confluence, or custom workflow servers.

## 1. Purpose & Scope

### Business Problem Solved

AI-assisted delivery work is often scattered across prompts, chats, tickets, markdown files, and manual status updates. This SOP makes the workflow visible, repeatable, and measurable in VS Code, while allowing teams to attach external context through MCP when needed.

### In Scope

- File-based epic tracking under `docs/ai-delivery/epics/<KEY>/`.
- Spec-kit workspace generation under `specs/<feature>/`.
- Copilot bootstrap pack generation under `.github/` without overwriting existing assets.
- Phase artifacts for discovery, specification, design, implementation, review, test, release, and learning.
- Optional MCP setup through `.vscode/mcp.json` for Jira, Confluence, and custom workflow servers.
- Quality checks using APEX Gate 1, Gate 2, and Gate 3.
- ROI measurement for time saved, quality improvement, iteration count, and traceability.

### Out of Scope

- Marketplace publishing in this operational SOP; use [MARKETPLACE-PUBLISHING-SOP.md](MARKETPLACE-PUBLISHING-SOP.md) for the release workflow.
- Implementing or hosting MCP servers.
- Automatic Jira, Confluence, or Figma synchronization.
- Replacing human review for high-risk business, security, legal, or production decisions.
- Automatic code generation without a reviewed requirement and verification plan.

### Target Users & Roles

| Role | Responsibility |
|---|---|
| Product Owner | Owns discovery and specification quality |
| Tech Lead | Owns design, review, and technical feasibility |
| Developer | Owns implementation artifact and code execution |
| QA | Owns test plan and validation coverage |
| Release Manager | Owns release readiness |
| APEX Owner | Owns workflow metrics, SOP quality, and ROI review |

## 2. Prerequisites

### Tools, Licenses, Data Sources

- VS Code 1.85 or newer.
- Node.js and npm.
- TypeScript compiler through project dependencies.
- Repository workspace with markdown artifact storage.
- Optional Jira and Confluence access if using Atlassian MCP.
- Optional MCP server command, package, or remote URL for custom integrations.
- Optional: Copilot Chat or another AI assistant for drafting artifacts.
- Optional: existing `.github/` Copilot assets if the repository already has a team-specific operating model.

### Skills / Training Needed

- Basic VS Code extension workflow: install dependencies, compile, run Extension Development Host.
- Ability to write measurable acceptance criteria.
- Familiarity with APEX gates:
  - Gate 1: Input Quality
  - Gate 2: Output Validation
  - Gate 3: Business Alignment

## 3. Step-by-Step Procedure

### Step 1: Create or Select an Epic

Action: Use **Create Sample Epic** or create a folder under `docs/ai-delivery/epics/<KEY>/`.

Example prompt:

```text
Create an AI delivery epic for: [business problem].
Use this structure: problem, target users, desired outcome, constraints, success metrics, open questions.
Return markdown only.
```

Expected output sample:

```markdown
# Epic: APEX-1000 - Improve AI Delivery Traceability

## Problem
Delivery artifacts are scattered and hard to trace.

## Desired Outcome
Reduce context lookup time by 30% and improve artifact completeness to 8/10.
```

Quality Checkpoint: Gate 1. Confirm objective, context, constraints, and output format are defined.

### Step 2: Configure MCP Context

Action: If the workflow needs external context, run **Configure MCP Server** and choose Atlassian remote MCP or Custom stdio MCP.

Example prompt:

```text
Configure this workspace so the AI assistant can access Jira and Confluence through our approved MCP endpoint.
Use an append-only MCP configuration and do not overwrite existing servers.
```

Expected output sample:

```json
{
  "servers": {
    "atlassian": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-atlassian-mcp.example.com/mcp"]
    }
  }
}
```

Quality Checkpoint: Gate 3. Confirm the MCP source is approved for the project and does not expose unauthorized data.

### Step 3: Create a Spec Kit Workspace

Action: Run **Create Spec Kit Workspace** or **Start Integrated Delivery Flow** to generate a feature workspace under `specs/<feature>/`.

Example prompt:

```text
Create a spec-kit workspace for this feature.
Use source context from Jira, Confluence, or manual intake.
Generate spec.md, plan.md, tasks.md, research.md, data-model.md, contracts, and quickstart.md.
Mark unresolved business rules as [NEEDS CLARIFICATION].
```

Expected output sample:

```text
specs/001-improve-ai-delivery-traceability/
  spec.md
  plan.md
  tasks.md
  research.md
  data-model.md
  contracts/README.md
  quickstart.md
```

Quality Checkpoint: Gate 1. Confirm the workspace captures the goal, source context, constraints, acceptance criteria, and open questions before implementation starts.

### Step 4: Create the Copilot Bootstrap Pack

Action: Run **Create Copilot Bootstrap Pack** or **Start Integrated Delivery Flow** to generate a minimal `.github/` operating layer for APEX delivery.

Example prompt:

```text
Create Copilot operating assets for this repository.
Include instructions, a prompt, a scoped instruction file, an orchestrator agent, and a reusable skill.
Do not overwrite existing .github files.
```

Expected output sample:

```text
.github/
  copilot-instructions.md
  prompts/apex-delivery.prompt.md
  instructions/apex-delivery.instructions.md
  agents/apex-delivery-orchestrator.agent.md
  skills/apex-delivery/SKILL.md
```

Quality Checkpoint: Gate 2. Confirm generated Copilot assets are relevant, safe to keep, and aligned with the repository's existing operating model.

### Step 5: Complete Discovery

Action: Open or create `DISCOVERY.md`, then document the business problem and baseline.

Example prompt:

```text
Act as an APEX business analyst.
For this epic, define the baseline process, affected roles, current pain, measurable cost, and opportunity.
Use concise markdown tables.
```

Expected output sample:

```markdown
| Baseline | Pain | Metric |
|---|---|---|
| Manual status checks | Context is scattered | 45 minutes per epic |
```

Quality Checkpoint: Gate 3. The work must solve a real business problem with measurable ROI.

### Step 6: Write the Specification

Action: Open or create `SPEC.md` in the epic or `spec.md` in the spec-kit workspace, then convert the discovery into acceptance criteria.

Example prompt:

```text
Turn this discovery into a specification.
Use GIVEN/WHEN/THEN acceptance criteria.
Mark unknowns as Open Questions instead of guessing.
```

Expected output sample:

```markdown
## Acceptance Criteria
- AC1: GIVEN an epic folder exists WHEN the extension refreshes THEN the epic appears in the tree view.
- AC2: GIVEN a phase status file exists WHEN it is valid THEN the phase displays that status.
```

Quality Checkpoint: Gate 1 and Gate 2. Inputs must be clear; output must be complete and testable.

### Step 7: Create Technical Design

Action: Open or create `DESIGN.md`, then define modules, data model, commands, and verification.

Example prompt:

```text
Act as a senior VS Code extension architect.
Create a technical design for this spec.
Include modules, VS Code contributions, data model, command flow, risks, and verification commands.
```

Expected output sample:

```markdown
## Modules
- extension.ts: command registration and activation
- pipelineScanner.ts: file-system scan and status inference
- pipelineProvider.ts: tree view rendering
```

Quality Checkpoint: Gate 2. Validate completeness, relevance, and actionability.

### Step 8: Implement and Record Work

Action: Open or create `IMPLEMENTATION.md`, then track implementation notes, files changed, and verification status.

Example prompt:

```text
Using the approved spec and design, create an implementation checklist.
Map each task to an acceptance criterion and include verification evidence needed.
```

Expected output sample:

```markdown
| Task | AC | Verification |
|---|---|---|
| Add scanner | AC4, AC5 | Diagnostics clean, sample epic scanned |
```

Quality Checkpoint: Gate 2. Changed behavior must be traceable to acceptance criteria.

### Step 9: Review the Output

Action: Open or create `REVIEW.md`, then review artifacts and implementation against the spec.

Example prompt:

```text
Review this implementation against the acceptance criteria.
Return only findings with severity, evidence, and suggested fix.
If no findings, state residual risks and test gaps.
```

Expected output sample:

```markdown
## Findings
No blocking findings.

## Residual Risk
Compile was checked, but full extension-host UX still requires manual F5 validation.
```

Quality Checkpoint: Gate 2. Accuracy, completeness, relevance, and actionability must be checked.

### Step 10: Build the Test Plan

Action: Open or create `TEST-PLAN.md`, then define functional and manual validation scenarios.

Example prompt:

```text
Create a test plan for this VS Code extension.
Cover empty workspace, sample epic creation, artifact creation, phase advancement, dashboard rendering, and invalid status.json handling.
```

Expected output sample:

```markdown
| Scenario | Steps | Expected Result |
|---|---|---|
| Empty workspace | Open view | Welcome action appears |
| Sample epic | Run create command | APEX-1000 folder exists |
```

Quality Checkpoint: Gate 2. Test cases must cover happy path, edge cases, and recovery paths.

### Step 11: Release Readiness

Action: Open or create `RELEASE.md`, then verify packaging readiness and rollback plan.

Example prompt:

```text
Prepare release readiness notes for this extension MVP.
Include version, known limitations, rollback plan, and user validation checklist.
```

Expected output sample:

```markdown
## Release Readiness
- Version: 0.1.0
- Known limitation: MCP configuration is supported, but external server hosting and authentication are managed outside the extension
- Rollback: disable extension or remove generated sample epic folder
```

Quality Checkpoint: Gate 3. Confirm business value is measurable and risk is acceptable.

### Step 12: Capture Learnings

Action: Open or create `LEARNINGS.md`, then record metrics and improvement decisions.

Example prompt:

```text
Summarize pilot results using hypothesis, test, result, and insight.
Include time saved, quality score, iteration count, and adoption friction.
```

Expected output sample:

```markdown
## Experiment Result
Hypothesis: File-based pipeline reduces status lookup time by 30%.
Result: Reduced from 45 minutes to 25 minutes per epic, a 44% improvement.
Recommendation: Adopt for next 10 epics.
```

Quality Checkpoint: Gate 3. Continue only if ROI is positive and repeatable.

## 4. Quality Assurance

### Gate 1: Input Quality Checklist

- Objective clearly defined.
- Context and affected users documented.
- Constraints stated.
- Expected output format specified.
- Open questions listed instead of guessed.

### Gate 2: Output Validation Checklist

- Output is factually aligned with source artifacts.
- Acceptance criteria are covered.
- Design decisions are actionable.
- Test plan covers core workflows and edge cases.
- Quality score is at least 8/10 before advancing.

### Gate 3: Business Alignment Checklist

- The workflow solves a real delivery or productivity problem.
- ROI can be measured through time, quality, iteration, or risk metrics.
- The process is repeatable across at least 10 real use cases.
- Compliance and governance risks are documented.

## 5. Success Metrics

### Leading Indicators Per Use

| Metric | Target | Source |
|---|---:|---|
| Artifact completeness score | >= 8/10 | Review artifact |
| Acceptance criteria coverage | >= 90% | SPEC.md and REVIEW.md |
| Time to find current status | <= 2 minutes | User timing |
| Iterations before approval | <= 2 | REVIEW.md |

### Lagging Indicators Monthly ROI

| Metric | Target | Source |
|---|---:|---|
| Coordination time saved | >= 20% | Before/after time logs |
| Rework reduction | >= 15% | Review and defect records |
| Workflow adoption | >= 70% of selected pilot epics | Epic folders scanned |
| Stakeholder satisfaction | >= 8/10 | Monthly survey |

### Escalation / Rollback Threshold

Escalate to human-only workflow if any condition is true:

- Artifact quality remains below 7/10 after two iterations.
- Acceptance criteria coverage is below 80%.
- Security, legal, customer-data, or production-risk decisions are unresolved.
- Users spend more time maintaining artifacts than the baseline workflow.

## 6. Troubleshooting

| Failure Mode | Likely Cause | Fix |
|---|---|---|
| No epics appear | Wrong `apexDelivery.epicsPath` | Update setting or run Create Sample Epic |
| Phase does not update | Invalid or missing `status.json` | Use Mark Phase Passed or fix JSON schema |
| Artifact opens blank | Template was not found | Recreate artifact using bundled templates |
| Dashboard looks stale | Tree was not refreshed | Run Refresh Pipeline Status |
| Spec workspace is not created | `apexDelivery.specsPath` points to an unexpected location | Update the setting or run Start Integrated Delivery Flow again |
| Copilot pack skipped files | Files already exist under `.github/` | Review existing assets and merge manually if needed |
| MCP config is missing | `.vscode/mcp.json` has not been created | Run Configure MCP Server and choose Open MCP config |
| Jira or Confluence context is unavailable | Remote MCP URL, auth, or provider access is not ready | Confirm the approved Atlassian MCP endpoint and authentication flow |
| Custom MCP does not start | Command or args are wrong | Open `.vscode/mcp.json`, verify the command manually, then retry |
| AI output is generic | Prompt lacks context or metrics | Re-run with Gate 1 checklist |
| Review cycles increase | Workflow is too heavy | Reduce required artifacts or narrow the phase gates |

Human-only escalation is required for high-risk production releases, regulated data, legal/compliance approvals, and unresolved architecture trade-offs.

## 7. Change Log

| Version | Date | Owner | Changes |
|---|---|---|---|
| 0.1.0 | 2026-05-01 | APEX Owner | Initial SOP for file-based APEX Delivery Pipeline MVP |
| 0.1.1 | 2026-05-01 | APEX Owner | Switched SOP to English-only and added MCP setup for Jira, Confluence, and custom servers |
| 0.2.0 | 2026-05-01 | APEX Owner | Added spec-kit workspace generation and no-overwrite Copilot bootstrap pack flow |
