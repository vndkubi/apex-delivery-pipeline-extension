# APEX Delivery Pipeline for Copilot 0.5.4

## Summary

Version 0.5.4 improves Copilot Chat isolation per epic, adds session visibility to the developer trace, and streamlines the Guided Autopilot UI surface.

## Highlights

- Added deterministic epic-scoped native chat session routing for Copilot Chat handoff.
- Reused the same native chat session across phases in the same epic and separated different epics into different sessions.
- Displayed `APEX_SESSION` in the Developer Trace Panel for easier debugging.
- Removed the Pause/Resume Guided Autopilot tree buttons from the APEX view while preserving the backend commands.
- Added smoke-test coverage for native session reuse and canonical `vscode-chat-session` URI format.

## User Impact

- Follow-up chat for the same epic now stays in one dedicated native Copilot Chat session instead of bleeding across epics.
- Developer trace entries now expose the active `APEX_SESSION` marker directly.
- The APEX tree is less cluttered because pause/resume autopilot actions are no longer shown as item buttons.
- Teams can still pause or resume Guided Autopilot through commands and existing runtime prompts.

## Breaking Changes

None intended.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.4.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Adds epic-scoped native Copilot Chat sessions with visible `APEX_SESSION` trace markers, while cleaning up extra Guided Autopilot buttons from the APEX tree.