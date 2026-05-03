# Publish Notes 0.5.5

## Marketplace Short Summary

APEX Delivery Pipeline for Copilot 0.5.5 adds a workflow configuration UI, file-backed workflow prompt sources, and persisted epic-scoped Copilot session state, while restoring integrated flow and guided autopilot command discoverability.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.5 is a workflow authoring and session orchestration release.

This version adds **Configure Workflows**, a dedicated UI for editing workspace workflow definitions without hand-editing large JSON objects. Teams can now author custom `templateRef` values, store phase output or starter prompt text in workspace markdown files through `outputRef` and `starterPromptRef`, and apply workflow-scoped run defaults such as `autoSubmit`, `agentTag`, `preferredChatAgent`, `modelFamily`, and `starterPrompt`.

The release also introduces persisted epic-scoped session state for Copilot handoff. Each epic can now carry a stable APEX session identity, and the developer trace records the session id, session key, and transport details used for the run. Scoped fallback prompts now attach files directly and carry an explicit `APEX_SESSION` marker, so the main handoff flow no longer depends on `@apex` as the only way to preserve context.

To keep the published UX aligned with the actual runtime surface, integrated flow plus guided autopilot entrypoints are once again discoverable through the Command Palette.

## GitHub Release Body

### Highlights

- Added a **Configure Workflows** UI for workspace workflow authoring.
- Added `templateRef`, `outputRef`, and `starterPromptRef` support for workspace-backed markdown sources.
- Added workflow-scoped session defaults and updated run-preference precedence.
- Added persisted epic-scoped session provider state and richer transport/session trace metadata.
- Switched the main fallback handoff toward scoped prompts with `APEX_SESSION` markers and attached files.
- Restored integrated flow and guided autopilot command discoverability.
- Expanded smoke coverage for workflow config, template seeding, fallback routing, and session reuse.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.5.vsix`