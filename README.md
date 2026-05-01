# APEX Delivery Pipeline

A file-based VS Code extension for tracking AI-assisted delivery workflows inside the editor. It is inspired by the `aidlc-extension` pattern and now combines three layers: local delivery epics, spec-kit feature workspaces, and Copilot bootstrap operating assets, with optional MCP setup for Jira, Confluence, or custom workflow servers.

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
- Marks phases as passed and moves the next phase to in progress.
- Shows a dashboard with progress and blocked/review states.
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
7. Click **Configure MCP Server** if the workflow needs Jira, Confluence, or a custom MCP server.

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `apexDelivery.epicsPath` | `docs/ai-delivery/epics` | Folder scanned for workflow epics |
| `apexDelivery.specsPath` | `specs` | Folder used for spec-kit feature workspaces |
| `apexDelivery.ownerName` | `APEX Owner` | Owner written into sample metadata |
| `apexDelivery.mcpConfigPath` | `.vscode/mcp.json` | Workspace MCP config file updated by the extension |

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
| Configure MCP Server | Adds Atlassian or custom MCP server entries to `.vscode/mcp.json` |

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

This project includes VS Code Marketplace packaging scripts, but it still needs a real Marketplace publisher id before public publishing.

Before publishing:

1. Replace `publisher: "local-apex"` in `package.json` with your Visual Studio Marketplace publisher id.
2. Confirm the license. The current package is marked `UNLICENSED`, which is fine for local/private experiments but should be reviewed before public distribution.
3. Run `npm install`.
4. Run `npm run compile`.
5. Run `npm run package` to create a `.vsix`.
6. Install the `.vsix` locally and smoke-test the extension.
7. Run `npx vsce login <publisher-id>` or pass a Marketplace PAT when publishing.
8. Run `npm run publish`.

Full SOP: [docs/MARKETPLACE-PUBLISHING-SOP.md](docs/MARKETPLACE-PUBLISHING-SOP.md).

## Copilot Bootstrap And Spec Kit Relationship

`copilot-bootstrap` already carries the spec-driven workflow shape: `specify-feature`, `plan-implementation`, `generate-tasks`, `implement-feature`, and prompts that expect `specs/<feature>/` artifacts. That means the bootstrap layer can teach Copilot how to work with spec-kit-style artifacts.

This extension adds the missing VS Code product surface: commands that create the local `specs/<feature>/` workspace, generate a minimal no-overwrite Copilot pack, and connect optional MCP context. If a repository already ran a full `copilot-bootstrap`, use this extension's Copilot pack command carefully; it skips existing files by default so it will not replace the richer bootstrapped assets.

## Positioning Versus `aidlc-extension`

`aidlc-extension` is a fuller SDLC tracker with a stronger Claude/MCP-oriented workflow. This project is an APEX delivery cockpit: it keeps the file-based workflow visible in VS Code, uses spec-kit artifacts for implementation traceability, and uses Copilot bootstrap assets to make AI-assisted delivery repeatable across implementation, review, verification, and learning.
