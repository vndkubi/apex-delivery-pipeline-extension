# APEX Delivery Pipeline for Copilot 0.5.5

## Summary

Version 0.5.5 is a workflow authoring and session orchestration release. It adds a dedicated workflow configuration UI, supports file-backed workflow text sources and custom template references, and makes Copilot handoff more explicit through persisted epic-scoped session state and scoped fallback prompts.

## Highlights

- Added **Configure Workflows**, a workspace editor for ordered workflow definitions, custom `templateRef` values, `outputRef` sources, and file-backed `starterPromptRef` content.
- Added workflow-scoped session defaults for `autoSubmit`, `agentTag`, `preferredChatAgent`, `modelFamily`, and `starterPrompt`, with precedence below explicit phase profiles and above role policies plus workspace defaults.
- Added validation and resolution for workspace template references and file-backed workflow text so phase outputs and starter prompts can live in normal markdown files.
- Added persistent epic-scoped session provider state, including session id, session key, transport id, and transport stability in the developer trace.
- Shifted Copilot Chat fallback toward scoped prompts with attached files and `APEX_SESSION` markers instead of depending on `@apex` as the primary handoff path.
- Restored command-palette discoverability for Guided Autopilot, fully automatic autopilot, and integrated flow entrypoints.
- Expanded smoke coverage for workflow configuration validation, template seeding, file-backed workflow refs, scoped session reuse, and fallback routing.

## User Impact

- Teams can now author workspace workflows in a UI instead of hand-editing large JSON blobs.
- Phase templates can come from bundled markdown files or workspace-relative template paths.
- Longer workflow prompt content can be stored in markdown files and resolved at runtime through `outputRef` and `starterPromptRef`.
- Copilot follow-up for the same epic now has explicit persisted session metadata and clearer trace output.
- The published command surface once again exposes integrated flow and guided autopilot entrypoints through the Command Palette.

## Breaking Changes

None intended.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.5.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Adds a workflow configuration UI, file-backed workflow prompt sources, and persisted epic-scoped Copilot session state, while restoring integrated flow and guided autopilot command discoverability.