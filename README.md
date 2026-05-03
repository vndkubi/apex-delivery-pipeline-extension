# APEX Delivery Pipeline for Copilot

APEX Delivery Pipeline is a Copilot-first VS Code extension for teams that want AI-assisted delivery work to stay in the repository instead of being scattered across chat tabs, scratch files, and ad hoc checklists. It combines file-based epics, workflow-aware phase execution, direct model runs, scoped GitHub Copilot Chat handoff, branch-to-epic coordination, linked Git worktrees, PR review artifacts, MCP configuration, spec-kit workspaces, and Copilot bootstrap assets in one editor workflow.

This project is optimized for VS Code plus GitHub Copilot Chat. It keeps repo-native artifacts, `.github/` Copilot assets, and workspace-local `.vscode/mcp.json` in one Copilot-oriented workflow.

## Why This Project Exists

- Keep delivery state in the repo: epics, phase artifacts, status files, workflow snapshots, and developer traces live beside the code.
- Run the active phase with Copilot from the APEX tree instead of rebuilding prompt context by hand.
- Apply workflow defaults, phase overrides, and role policies without hand-editing large JSON payloads.
- Attach build, test, and lint evidence to the current artifact when verification commands are available.
- Keep branch coordination and PR review history tied to the same epic through explicit branch bindings, linked worktrees, and generated review artifacts.
- Bootstrap `specs/<feature>/`, `.github/` Copilot assets, and `.vscode/mcp.json` from the same extension.

## Core Capabilities

- Activity Bar delivery pipeline for repo-local epics.
- Sample epic creation under `docs/ai-delivery/epics/<KEY>/`.
- Workflow-scoped phase definitions with custom templates, file-backed prompt sources, and per-phase session defaults.
- Run Phase with Copilot through direct language model execution when available, with scoped chat fallback when it is not.
- Reopen the stored epic-scoped fallback chat session on rerun instead of creating a fresh ask-mode chat when the same epic already has prior fallback session state.
- Epic-scoped chat routing markers and trace records using `APEX_SESSION=...`.
- Guided Autopilot commands for phase execution, fully automatic mode, pause, and resume.
- Workspace workflow editor for `templateRef`, `outputRef`, `starterPromptRef`, and ordered phase definitions.
- Guided phase profile editor for `autoSubmit`, `agentTag`, `preferredChatAgent`, and `modelFamily`.
- Direct artifact rewrite proposal flow with diff preview and explicit apply or reject.
- Git branch-to-epic linking, linked branch worktree opening, and repo-local PR review artifact generation.
- Developer Trace Panel with prompts, context files, execution path, fallback reason, role notes, and transport metadata.
- Spec Kit workspace scaffolding and Copilot bootstrap pack generation.
- MCP server configuration for Atlassian remote MCP or custom stdio servers.

## Default Workflow

| Phase | Owner | Artifact | Gate | Output |
|---|---|---|---|---|
| Discover | Product / Business | `DISCOVERY.md` | Gate 1 | Problem baseline captured |
| Specify | Product Owner | `SPEC.md` | Gate 1 | Requirement captured |
| Design | Tech Lead | `DESIGN.md` | Gate 2 | Solution direction approved |
| Implement | Developer | `IMPLEMENTATION.md` | Gate 2 | Implementation evidence captured |
| Review | Reviewer | `REVIEW.md` | Gate 2 | Review findings captured |
| Test | QA | `TEST-PLAN.md` | Gate 2 | Verification plan captured |
| Release | Release Manager | `RELEASE.md` | Gate 3 | Release readiness captured |
| Learn | APEX Owner | `LEARNINGS.md` | Gate 3 | Learnings and follow-up captured |

## What The Extension Creates

| Location | Created By | What You Get |
|---|---|---|
| `docs/ai-delivery/epics/<KEY>/` | Sample epic, integrated flow, or your own repo content | `EPIC.md`, phase artifacts, `phases/<phase>/status.json`, and workflow snapshot metadata |
| `docs/ai-delivery/epics/<KEY>/.apex-coordination.json` | Link Branch To Epic, Review Pull Request, or Generate PR Review Artifact | Repo-owned coordination metadata that keeps branch bindings and PR review context attached to the epic |
| `specs/<feature>/` | Create Spec Kit Workspace or Start Integrated Delivery Flow | `spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/README.md`, and `quickstart.md` |
| `.github/` | Create Copilot Bootstrap Pack or Start Integrated Delivery Flow | `copilot-instructions.md`, reusable prompt, instruction, agent, and skill files |
| `.vscode/mcp.json` | Configure MCP Server | Atlassian remote MCP or custom stdio MCP server entries |

Generated spec-kit workspace:

```text
specs/<feature>/
  spec.md
  plan.md
  tasks.md
  research.md
  data-model.md
  contracts/README.md
  quickstart.md
```

Generated Copilot bootstrap pack:

```text
.github/
  copilot-instructions.md
  prompts/apex-delivery.prompt.md
  instructions/apex-delivery.instructions.md
  agents/apex-delivery-orchestrator.agent.md
  skills/apex-delivery/SKILL.md
```

The bootstrap pack is no-overwrite by default. Existing `.github/` files are skipped so teams can merge generated assets deliberately.

## Quick Start

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` and select **Run APEX Delivery Extension**.
5. In the Extension Development Host, open the **APEX Delivery** view from the Activity Bar.
6. Run **Create Sample Epic** if you want a ready-made repo-local workflow to explore.
7. Run **Start Integrated Delivery Flow** if you want both a spec-kit workspace and a Copilot bootstrap pack.
8. Use **Configure Workflows** if you want custom phase order, custom templates, or file-backed prompt sources.
9. Use **Configure MCP Server** if the workflow needs Jira, Confluence, or a custom MCP endpoint.
10. On an active phase, run **Run Phase with Copilot**.
11. Review the artifact, trace, and verification evidence, then run **Mark Phase Passed** or continue with guided execution.

## Recommended Daily Flow

1. Create or open an epic under `docs/ai-delivery/epics/<KEY>/`.
2. Use **Link Current Branch To Epic** or **Link Branch To Epic** when implementation or review work should stay explicitly bound to that epic.
3. Use **Open Linked Branch Worktree** when you want the linked branch in a separate worktree or window.
4. Open the active artifact with **Open or Create Artifact**.
5. Run **Run Phase with Copilot** to use direct model execution or the scoped Copilot Chat handoff.
6. Use **Propose Artifact Update** when you want a reviewable diff instead of an immediate chat-driven rewrite.
7. Inspect **Open Developer Trace Panel** when you need the exact prompt, context set, execution path, or fallback reason.
8. Run **Configure Phase Profile** when a single phase needs different auto-submit, agent tag, or model-family defaults.
9. Use **Review Pull Request** or **Generate PR Review Artifact** when review output should land back into the epic's repo-local artifacts.
10. Run **Run Guided Autopilot** or **Run Fully Automatic Autopilot** from the Command Palette when the current phase policy allows it.
11. Use **Pause Guided Autopilot** or **Resume Guided Autopilot** when the flow requires human review or a later continuation.
12. Run **Mark Phase Passed** when the current artifact satisfies the gate and should advance the workflow.

## Command Surface

| Command | Purpose |
|---|---|
| **Refresh Pipeline Status** | Rescan epics and refresh the tree view |
| **Open Pipeline Dashboard** | Open a dashboard view over epic and phase status |
| **Open Developer Trace Panel** | Inspect recent prompts, context files, and execution decisions |
| **Create Sample Epic** | Seed a repo-local epic with the active workflow definition |
| **Link Current Branch To Epic** | Bind the current Git branch to the selected epic and persist that mapping in repo-owned coordination metadata |
| **Link Branch To Epic** | Bind a selected local branch to the selected epic |
| **Open Linked Branch Worktree** | Create or reuse a dedicated Git worktree for the linked branch and open it in VS Code |
| **Review Pull Request** | Review a pull request in the context of the linked epic workflow |
| **Generate PR Review Artifact** | Materialize repo-local review artifacts for a pull request against the linked epic |
| **Open or Create Artifact** | Open the current artifact or seed it from the configured template |
| **Configure Phase Profile** | Set per-phase `autoSubmit`, `agentTag`, `preferredChatAgent`, and `modelFamily` overrides |
| **Configure Workflows** | Edit workspace workflow definitions, templates, and file-backed prompt sources |
| **Run Phase with Copilot** | Execute the active phase with direct model access or scoped chat fallback |
| **Run Guided Autopilot** | Continue through autopilot-enabled phases using the configured execution mode |
| **Run Fully Automatic Autopilot** | Force fully automatic mode for the current run without changing workspace settings |
| **Pause Guided Autopilot** | Persist the current autopilot state so it can be resumed later |
| **Resume Guided Autopilot** | Resume the last paused autopilot state for the epic |
| **Propose Artifact Update** | Draft a full artifact rewrite and review it through a diff before applying |
| **Mark Phase Passed** | Mark the current phase as passed and advance the next phase |
| **Configure MCP Server** | Add or inspect workspace MCP server entries |
| **Create Spec Kit Workspace** | Create `specs/<feature>/` scaffolding only |
| **Create Copilot Bootstrap Pack** | Create `.github/` Copilot assets only |
| **Start Integrated Delivery Flow** | Create both spec-kit and Copilot bootstrap layers in one flow |

## Configuration Model

The extension resolves run preferences in this order:

`phaseProfiles` -> workflow snapshot `sessionDefaults` -> `rolePolicies` -> workspace defaults

Key settings:

| Setting | Purpose |
|---|---|
| `apexDelivery.epicsPath` | Repo-relative folder scanned for epics |
| `apexDelivery.specsPath` | Repo-relative folder used for spec-kit workspaces |
| `apexDelivery.ownerName` | Default owner used in generated sample artifacts |
| `apexDelivery.userRole` | Current user role used for role-aware routing and trace notes |
| `apexDelivery.workflowDefinitions` | Workspace workflow catalog with ordered phases, templates, and session defaults |
| `apexDelivery.mcpConfigPath` | Workspace MCP config path, usually `.vscode/mcp.json` |
| `apexDelivery.runPhase.autoSubmit` | Default chat auto-submit behavior |
| `apexDelivery.runPhase.phaseProfiles` | Explicit per-workflow and per-phase run overrides |
| `apexDelivery.runPhase.rolePolicies` | Role-aware defaults keyed by `apexDelivery.userRole` |
| `apexDelivery.autopilot.executionMode` | `agent-pause` or `fully-automatic` guided execution |
| `apexDelivery.verification.*` | Build, test, lint attachment behavior for phase evidence |

Representative workflow definition:

```json
{
  "apexDelivery.workflowDefinitions": {
    "investigate-workflow": {
      "name": "Investigate Only",
      "phases": [
        {
          "id": "investigate",
          "name": "Investigate",
          "owner": "Business Analyst",
          "artifact": "DISCOVER.md",
          "templateRef": "docs/ai-delivery/templates/investigate-template.md",
          "gate": "Gate 1",
          "outputRef": "docs/ai-delivery/prompts/investigate-output.md",
          "sessionDefaults": {
            "autoSubmit": false,
            "agentTag": "#workflow-investigate",
            "preferredChatAgent": "Workflow Analyst",
            "modelFamily": "gpt-4.1",
            "starterPromptRef": "docs/ai-delivery/prompts/investigate-starter.md"
          },
          "autopilot": {
            "enabled": true,
            "retryLimit": 1,
            "pauseOnManualIntervention": true
          }
        }
      ]
    }
  }
}
```

## Copilot Execution Model

**Run Phase with Copilot** can take multiple paths depending on what the environment exposes:

- **Direct model path**: the extension uses `vscode.lm.selectChatModels()` and sends a scoped request itself.
- **Agent chat path**: the extension opens GitHub Copilot Chat in agent mode with the relevant files attached.
- **Scoped chat fallback**: when direct execution is unavailable, the extension prepares a dedicated prompt for the current epic and opens GitHub Copilot Chat in ask mode.

Important behavior:

- The prepared prompt includes an `APEX_SESSION=...` marker so the same epic can keep a consistent conversation identity in trace and fallback flows.
- If a fallback chat session already exists for the same epic, rerunning the phase reopens that stored epic-scoped session instead of issuing a fresh ask-mode chat launch. When the public chat surface cannot prefill the reopened session deterministically, the scoped prompt is copied for manual continuation.
- `preferredChatAgent` and `modelFamily` are best-effort hints in public GitHub Copilot Chat launches. The public chat-open commands do not guarantee hard agent or model locking.
- The optional `@apex` participant is still available for follow-up, but the primary handoff flow does not depend on it.

## Guided Autopilot

Guided Autopilot is phase-scoped and only continues automatically when the workflow policy for the current phase enables it.

- `agent-pause` keeps the Copilot-agent-first behavior and pauses when the public chat surface no longer exposes enough completion state.
- `fully-automatic` skips chat paths and only continues when the extension can observe a direct model completion itself.
- Verification failure, retry-limit exhaustion, or unsaved manual edits still pause the flow.
- Pause and resume state is stored in workspace state so the epic can be continued later.

## MCP Setup

Run **Configure MCP Server** from the Command Palette or the APEX view title.

Available modes:

| Mode | Use When | Output |
|---|---|---|
| Atlassian remote MCP | You want Jira or Confluence context through an Atlassian-provided or company-hosted MCP URL | `npx -y mcp-remote <url>` entry in `.vscode/mcp.json` |
| Custom stdio MCP | You have an internal package, local script, or third-party MCP command | Custom `command` plus `args` entry |
| Open MCP config | You want to inspect the file directly | Creates or opens `.vscode/mcp.json` |

The MCP updater is append-only for server names. It avoids overwriting an existing server entry with the same name.

## Repository Layout

| Path | Role |
|---|---|
| `src/` | Extension implementation, workflow model, trace panel, MCP configurator, session provider, and smoke tests |
| `templates/generic/` | Bundled phase templates used for generated artifacts |
| `docs/` | Release notes, publish notes, SOPs, and design documentation |
| `media/` | Activity Bar and UI assets |
| `scripts/` | Helper scripts for repository or publishing workflows |
| `src/test/` | Extension host smoke test entrypoint and suite |

## Development, Packaging, and Publishing

Available scripts:

| Script | Purpose |
|---|---|
| `npm run compile` | Compile the TypeScript extension |
| `npm run watch` | Recompile during local extension development |
| `npm run test:smoke` | Run the extension host smoke suite |
| `npm run package` | Build a `.vsix` with `vsce package` |
| `npm run publish` | Publish through `vsce publish` |

Marketplace notes:

- Publisher id is currently `vndkubi`.
- Validate README, manifest metadata, and packaged contents before publish.
- Packaging and publishing SOP lives in `docs/MARKETPLACE-PUBLISHING-SOP.md`.

## Relationship To Other Projects

This extension connects three adjacent layers:

- **Repo-local delivery epics** under `docs/ai-delivery/epics/`
- **spec-kit workspaces** under `specs/<feature>/`
- **Copilot bootstrap assets** under `.github/`

This project stays focused on GitHub Copilot Chat, workspace MCP configuration, and repository-visible delivery artifacts inside VS Code.

## License

MIT