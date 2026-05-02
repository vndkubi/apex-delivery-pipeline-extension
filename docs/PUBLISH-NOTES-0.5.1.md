# Publish Notes 0.5.1

## Marketplace Short Summary

Guided Autopilot now supports two execution modes. This release adds `agent-pause` versus `fully-automatic` behavior, plus a dedicated **Run Fully Automatic Autopilot** command in the APEX view.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.1 turns Guided Autopilot into a clearer two-mode experience.

The extension can now run autopilot in **agent-pause** mode when you want Copilot agent mode to do the implementation work and then pause for a human resume, or in **fully-automatic** mode when you want the extension to continue only across paths where completion is directly observable. To make that second mode easier to use, the release also adds a dedicated **Run Fully Automatic Autopilot** command and exposes it directly in the APEX Delivery view title and tree context menus.

This keeps the original Guided Autopilot workflow available while making the execution semantics explicit and easier to control per run.

## GitHub Release Body

### Highlights

- Added `apexDelivery.autopilot.executionMode` with `agent-pause` and `fully-automatic` modes.
- Updated Guided Autopilot to pause after Copilot agent launches because the public chat API does not expose completion signals.
- Blocked fully automatic runs from silently falling back into chat-based paths when direct completion cannot be observed.
- Added **Run Fully Automatic Autopilot** as a dedicated command.
- Exposed the fully automatic command in the APEX Delivery view title and epic/phase context menus.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.1.vsix`