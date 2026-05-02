# APEX Delivery Pipeline

A file-based VS Code extension for tracking AI-assisted delivery workflows inside the editor. It is inspired by the `aidlc-extension` pattern and now combines three layers: local delivery epics, spec-kit feature workspaces, and Copilot bootstrap operating assets, with optional MCP setup for Jira, Confluence, or custom workflow servers.

If your team standard is **VS Code GitHub Copilot Chat** rather than Claude Code, this project is the better starting point. It uses workspace-native `.github/` Copilot assets and `.vscode/mcp.json`, and now includes a direct **Run Phase with Copilot** workflow from the tree view, with `@apex` follow-up inside Chat.

## What It Does

- Adds an **APEX Delivery** activity-bar view.
- Scans `docs/ai-delivery/epics/<KEY>/` for delivery artifacts.
- Tracks phases from `phases/<phase>/status.json` when present.
- Falls back to artifact completion when no status file exists.
- Creates a sample epic so teams can try the workflow quickly.
- Creates spec-kit workspaces under `specs/<feature>/`.
- Creates a no-overwrite Copilot bootstrap pack under `.github/`.
- Starts an integrated flow that creates the spec workspace and Copilot pack together.
- Opens or seeds phase artifacts from bundled templates.
- Configures per-phase Copilot run profiles from a guided UI instead of manual JSON edits.
- Proposes direct artifact updates with a diff preview and explicit apply or reject step.
- Runs the active phase directly against a Copilot language model from the tree view.
- Runs Guided Autopilot across autopilot-enabled phases by reusing the existing phase runner, verification checks, and status transitions in either `agent-pause` or `fully-automatic` mode.
- Pauses or resumes Guided Autopilot from the tree when manual intervention or verification review is needed.
- Falls back to GitHub Copilot Chat when direct model access is unavailable.
- Exposes an `@apex` chat participant for follow-up questions against the most recent phase context.
- Applies role-aware routing so a workspace `userRole` can shape preferred agent, model family, and auto-submit behavior before explicit phase overrides take precedence.
- Attaches build, test, and lint evidence to phase artifacts automatically when commands are configured or auto-detected.
- Persists a developer trace history with prompts, context files, path selection, fallback reasons, and verification results.
- Records preferred phase role, current user role, and routing mismatch notes inside the developer trace.
- Marks phases as passed and moves the next phase to in progress.
- Shows a dashboard with progress and blocked/review states.
- Auto-refreshes the tree when epic markdown files or phase `status.json` files change.
- Shows an activity-bar status summary that links back to the dashboard.
- Configures workspace MCP servers through `.vscode/mcp.json`.
- Supports Atlassian remote MCP for Jira/Confluence and custom stdio MCP servers.

## Default Phases

| Phase | Owner | Artifact |
|---|---|---|
| Discover | Product / Business | `DISCOVERY.md` |
| Specify | Product Owner | `SPEC.md` |
| Design | Tech Lead | `DESIGN.md` |
| Implement | Developer | `IMPLEMENTATION.md` |
| Review | Reviewer | `REVIEW.md` |
| Test | QA | `TEST-PLAN.md` |
| Release | Release Manager | `RELEASE.md` |
| Learn | APEX Owner | `LEARNINGS.md` |

## Quick Start

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` and select **Run APEX Delivery Extension**.
5. In the Extension Development Host, open the **APEX Delivery** activity-bar view.
6. Click **Create Sample Epic**.
7. Set `apexDelivery.userRole` if you want role-aware routing defaults for phases owned by Business Analyst, Developer, Reviewer, or other team roles.
8. On any phase, click **Run Phase with Copilot** to open GitHub Copilot Chat in agent mode with the current phase artifact already open and attached.
9. Use **Run Guided Autopilot** when the workflow snapshot marks the current phase as autopilot-enabled and you want the extension to execute phases automatically until verification, manual edits, or an agent handoff requires a resume step.
10. Use **Pause Guided Autopilot** or **Resume Guided Autopilot** when a human review step or unsaved artifact change interrupts the flow.
11. Use **Configure Phase Profile** on a phase when you want per-phase control over auto-submit, agent tag, or preferred direct-execution model family.
12. Use **Propose Artifact Update** when you want a direct Copilot rewrite of the current artifact with a diff preview and an explicit apply or reject step.
13. Open **Developer Trace Panel** to inspect run history, prompts, context files, path decisions, role-routing notes, and verification evidence.
14. If you want follow-up discussion scoped to the same phase context, continue in GitHub Copilot Chat with `@apex`.
15. Click **Configure MCP Server** if the workflow needs Jira, Confluence, or a custom MCP server.

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `apexDelivery.epicsPath` | `docs/ai-delivery/epics` | Folder scanned for workflow epics |
| `apexDelivery.specsPath` | `specs` | Folder used for spec-kit feature workspaces |
| `apexDelivery.ownerName` | `APEX Owner` | Owner written into sample metadata |
| `apexDelivery.userRole` | `` | Optional current user role used for role-aware routing and trace mismatch warnings |
| `apexDelivery.workflowDefinitions` | `{}` | Optional custom workflow definitions snapshotted into new epics at creation time |
| `apexDelivery.mcpConfigPath` | `.vscode/mcp.json` | Workspace MCP config file updated by the extension |
| `apexDelivery.runPhase.autoSubmit` | `true` | Submits the Copilot Chat prompt immediately instead of opening it as a draft |
| `apexDelivery.runPhase.agentTag` | `` | Optional best-effort routing tag added to Run Phase prompts, for example `#dev-orchestrator` |
| `apexDelivery.runPhase.preferredChatAgent` | `` | Optional human-readable preferred GitHub Copilot Chat agent name, for example `Business Analyst` or `Code Reviewer` |
| `apexDelivery.runPhase.modelFamily` | `gpt-4.1` | Preferred model family for extension-driven direct execution or direct fallback |
| `apexDelivery.runPhase.phaseProfiles` | `{}` | Optional workflow-scoped phase overrides for `autoSubmit`, `agentTag`, `preferredChatAgent`, and `modelFamily` |
| `apexDelivery.runPhase.rolePolicies` | `{}` | Optional role-aware defaults keyed by `apexDelivery.userRole`; explicit phase profiles still win |
| `apexDelivery.autopilot.defaultRetryLimit` | `1` | Default retry limit for autopilot-enabled phases that do not define a workflow retry limit |
| `apexDelivery.autopilot.executionMode` | `agent-pause` | Chooses how Guided Autopilot runs non-interactive phases: `agent-pause` launches Copilot agent mode and pauses for resume; `fully-automatic` skips chat-based paths and only continues when direct model execution completes observably |
| `apexDelivery.autopilot.pauseOnManualIntervention` | `true` | Pauses Guided Autopilot when unsaved manual edits are detected in the active artifact |
| `apexDelivery.verification.autoAttach` | `true` | Automatically attach build, test, and lint evidence to the current phase artifact |
| `apexDelivery.verification.buildCommand` | `` | Optional explicit build command; otherwise the extension tries `compile` or `build` from `package.json` |
| `apexDelivery.verification.testCommand` | `` | Optional explicit test command; otherwise the extension tries `test:smoke` or `test` from `package.json` |
| `apexDelivery.verification.lintCommand` | `` | Optional explicit lint command; otherwise the extension tries `lint` from `package.json` |
| `apexDelivery.verification.maxOutputChars` | `4000` | Maximum verification output length stored in the artifact and trace history |

Custom workflow example:

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
					"gate": "Gate 1",
					"output": "Problem baseline captured",
					"autopilot": {
						"enabled": true,
						"retryLimit": 1,
						"pauseOnManualIntervention": true
					}
				},
				{
					"id": "triage",
					"name": "Triage",
					"owner": "Code Reviewer",
					"artifact": "REVIEW.md",
					"gate": "Gate 2",
					"output": "Risk summary captured"
				},
				{
					"id": "handoff",
					"name": "Handoff",
					"owner": "APEX Owner",
					"artifact": "LEARN.md",
					"gate": "Gate 3",
					"output": "Next action recorded"
				}
			]
		}
	}
}
```

Workflow-scoped phase profile example:

```json
{
	"apexDelivery.runPhase.phaseProfiles": {
		"default": {
			"design": {
				"preferredChatAgent": "Dev Orchestrator",
				"agentTag": "#dev-orchestrator",
				"autoSubmit": true,
				"modelFamily": "gpt-4.1"
			}
		},
		"investigate-workflow": {
			"triage": {
				"preferredChatAgent": "Code Reviewer",
				"autoSubmit": false,
				"modelFamily": "gpt-4o"
			}
		}
	}
}
```

Role-aware routing example:

```json
{
	"apexDelivery.userRole": "Developer",
	"apexDelivery.runPhase.rolePolicies": {
		"Developer": {
			"preferredChatAgent": "Dev Orchestrator",
			"agentTag": "#dev-orchestrator",
			"autoSubmit": false,
			"modelFamily": "gpt-4o"
		},
		"Business Analyst": {
			"preferredChatAgent": "Business Analyst",
			"autoSubmit": true,
			"modelFamily": "gpt-4.1"
		}
	}
}
```

You can set these values either in settings JSON or through **APEX Delivery: Configure Phase Profile** from the command palette or phase context menu.

When you create a new epic, the extension resolves the selected workflow and stores a snapshot in epic metadata. Later edits to workspace workflow definitions do not silently rewrite existing epics.

Guided Autopilot is phase-scoped. It only continues automatically when the snapshotted workflow marks the current phase with `autopilot.enabled: true`.

`apexDelivery.autopilot.executionMode` controls how non-interactive phases run:

- `agent-pause` preserves the current Copilot-agent-first behavior. The extension launches agent mode when available and pauses because the public chat API does not expose agent completion.
- `fully-automatic` skips agent-mode and ask-mode chat handoffs. It continues only when the extension can observe a direct model completion itself; if direct execution is unavailable, Guided Autopilot pauses with a reason instead of opening chat automatically.

In both modes, verification failure beyond the configured retry limit or unsaved manual edits still pause the flow and record the reason in workspace state plus the developer trace.

Role-aware routing is advisory. The extension can merge role defaults into the run preference resolution and show mismatches between `apexDelivery.userRole` and the phase owner, but explicit workflow phase profiles still win and GitHub Copilot Chat agent enforcement remains limited by the public chat API surface.

`preferredChatAgent` is a developer-facing preference and trace hint. The extension can show which agent a phase wants and carry that into the trace panel and prompt, but the public GitHub Copilot Chat API still does not expose the currently selected custom agent reliably enough for hard enforcement or automatic switching.

`modelFamily` is applied when the extension drives a direct model request itself. GitHub Copilot Chat still uses the model currently selected in the Chat UI because the public `workbench.action.chat.open` command does not expose model locking.

## Integrated Spec Kit + Copilot Bootstrap Flow

Run **APEX Delivery: Start Integrated Delivery Flow** when you want the extension to create the practical bridge between `aidlc-extension`, `spec-kit`, and `copilot-bootstrap`.

It creates:

```text
specs/<feature>/
	spec.md
	plan.md
	tasks.md
	research.md
	data-model.md
	contracts/README.md
	quickstart.md

.github/
	copilot-instructions.md
	prompts/apex-delivery.prompt.md
	instructions/apex-delivery.instructions.md
	agents/apex-delivery-orchestrator.agent.md
	skills/apex-delivery/SKILL.md
```

The Copilot pack is no-overwrite by default. Existing `.github` files are skipped rather than replaced, so a team can review and merge generated assets deliberately.

Use the individual commands when you want only one layer:

| Command | Output |
|---|---|
| Create Spec Kit Workspace | Creates `spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md` |
| Create Copilot Bootstrap Pack | Creates minimal `.github` prompt, instruction, agent, and skill assets without overwriting existing files |
| Configure Phase Profile | Opens a guided phase-profile editor for `autoSubmit`, `agentTag`, `preferredChatAgent`, and `modelFamily` without hand-editing JSON |
| Propose Artifact Update | Uses a direct Copilot model call to draft a full artifact rewrite, opens a diff preview, and lets you apply or reject it |
| Run Phase with Copilot | Opens GitHub Copilot Chat in agent mode with the phase artifact attached and submits the prompt automatically by default; falls back to the `@apex` chat handoff when direct agent launch is unavailable |
| Run Guided Autopilot | Reuses the phase runner across autopilot-enabled phases. In `agent-pause` mode it pauses after agent launches; in `fully-automatic` mode it skips chat paths and pauses only when no observable direct completion is available, verification fails, or manual edits intervene |
| Run Fully Automatic Autopilot | Runs Guided Autopilot with a command-level override to `fully-automatic`, skipping chat-based paths without requiring you to change the workspace setting |
| Pause Guided Autopilot | Stores a paused autopilot state for the current epic so the flow can be resumed later |
| Resume Guided Autopilot | Restarts Guided Autopilot from the saved phase and attempt state in workspace storage |
| Open Developer Trace Panel | Shows prompt history, context files, execution path, fallback reasons, and verification outcomes for recent phase runs |
| Configure MCP Server | Adds Atlassian or custom MCP server entries to `.vscode/mcp.json` |

## Use With GitHub Copilot Chat

Yes. This extension is designed to work well with GitHub Copilot Chat.

Recommended flow:

1. Create or open an epic under `docs/ai-delivery/epics/<KEY>/`.
2. Generate a spec workspace or Copilot pack when needed.
3. In the tree view, choose **Run Phase with Copilot** on the active phase.
4. The extension opens GitHub Copilot Chat in agent mode, attaches the phase files, and submits a prompt that tells Copilot to update the existing artifact.
5. Set `apexDelivery.userRole` and optional `apexDelivery.runPhase.rolePolicies` if you want role-aware defaults before explicit phase profiles take over.
6. Use **Configure Phase Profile** if you want different auto-submit, agent-tag, or preferred direct-model behavior per phase without editing settings JSON manually.
7. Use **Run Guided Autopilot** for workflow phases that are marked as autopilot-enabled when you want the extension to run and advance without manually triggering each phase. Keep `agent-pause` if you want Copilot agent edits plus manual resume.
8. Use **Run Fully Automatic Autopilot** when you want the same flow to force `fully-automatic` mode for that run without changing `apexDelivery.autopilot.executionMode` in workspace settings.
9. Each phase run updates the artifact with the latest verification evidence when the extension can detect or is given build, test, and lint commands.
10. Use **Propose Artifact Update** if you want a developer-controlled diff-and-apply flow instead of going straight to Chat.
11. Inspect **Open Developer Trace Panel** when you need to understand what prompt was used, which files were in context, which path was chosen, why a fallback happened, and whether the current user role matched the phase role.
12. If you want a scoped follow-up inside the APEX participant, continue with `@apex`.
13. Mark the phase passed when the artifact satisfies the gate, or let Guided Autopilot advance it automatically when policy and verification allow; resume it manually after agent-mode runs complete.

This is the main difference from `aidlc-extension`: `aidlc` is optimized around Claude Code slash-command orchestration and `.claude/settings.json`, while this project is optimized around VS Code-native Copilot assets and workspace MCP configuration.

## MCP Setup

Run **APEX Delivery: Configure MCP Server** from the command palette or the view title.

Available options:

| Option | Use When | What It Writes |
|---|---|---|
| Atlassian remote MCP | You want Jira and Confluence context through an Atlassian-provided or company-hosted remote MCP URL | A stdio wrapper using `npx -y mcp-remote <url>` |
| Custom stdio MCP | You have an internal MCP package, local script, or third-party MCP command | A custom command and args entry |
| Open MCP config | You want to inspect or manually edit the workspace MCP file | Creates or opens `.vscode/mcp.json` |

The extension is append-only for MCP servers: it does not overwrite an existing server with the same name. This keeps local or team-specific MCP configuration safe.

Example generated config:

```json
{
	"servers": {
		"atlassian": {
			"type": "stdio",
			"command": "npx",
			"args": ["-y", "mcp-remote", "https://your-atlassian-mcp.example.com/mcp"]
		},
		"custom-workflow": {
			"type": "stdio",
			"command": "npx",
			"args": ["-y", "your-mcp-package"]
		}
	}
}
```

## Marketplace Publishing

This project includes VS Code Marketplace packaging scripts and is configured for the `vndkubi` Marketplace publisher id.

Before publishing:

1. Confirm that `publisher: "vndkubi"` in `package.json` matches the Visual Studio Marketplace publisher account you will use.
2. Confirm that the `vndkubi` publisher id exists in the Visual Studio Marketplace publisher portal.
3. Run `npm install`.
4. Run `npm run compile`.
5. Run `npm run package` to create a `.vsix`.
6. Install the `.vsix` locally and smoke-test the extension.
7. Run `npx vsce login vndkubi` or pass a Marketplace PAT when publishing.
8. Run `npm run publish`.

Full SOP: [docs/MARKETPLACE-PUBLISHING-SOP.md](docs/MARKETPLACE-PUBLISHING-SOP.md).

## Copilot Bootstrap And Spec Kit Relationship

`copilot-bootstrap` already carries the spec-driven workflow shape: `specify-feature`, `plan-implementation`, `generate-tasks`, `implement-feature`, and prompts that expect `specs/<feature>/` artifacts. That means the bootstrap layer can teach Copilot how to work with spec-kit-style artifacts.

This extension adds the missing VS Code product surface: commands that create the local `specs/<feature>/` workspace, generate a minimal no-overwrite Copilot pack, and connect optional MCP context. If a repository already ran a full `copilot-bootstrap`, use this extension's Copilot pack command carefully; it skips existing files by default so it will not replace the richer bootstrapped assets.

## Positioning Versus `aidlc-extension`

`aidlc-extension` is still the stronger choice when you specifically want Claude Code slash commands, `.claude/settings.json` management, and a heavier MCP-driven SDLC orchestration model.

This project fits better when you want:

- GitHub Copilot Chat as the primary AI surface inside VS Code.
- `.github/` Copilot operating assets instead of Claude-specific runtime assets.
- Workspace-native `.vscode/mcp.json` for MCP configuration.
- A lighter cockpit that connects epics, spec-kit workspaces, review flow, and ROI-oriented delivery notes.

Compared with the earlier version of this extension, it is now closer to the `aidlc-extension` quality bar in the places that matter most for Copilot users: a tree action that opens full Copilot Chat agent mode against the current artifact, `@apex` follow-up inside Chat, auto-refreshing pipeline state, a clearer dashboard, and a less provisional product surface.

## License

MIT
