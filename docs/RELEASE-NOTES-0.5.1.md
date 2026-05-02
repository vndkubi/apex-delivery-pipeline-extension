# APEX Delivery Pipeline for Copilot 0.5.1

## Summary

Version 0.5.1 packages the Guided Autopilot execution-mode split and the dedicated fully automatic entrypoint. The goal is to make the extension explicit about when autopilot is pausing for an agent handoff versus when it can continue only across directly observable completions.

## Highlights

- Added **`agent-pause`** and **`fully-automatic`** Guided Autopilot execution modes through `apexDelivery.autopilot.executionMode`.
- Preserved the Copilot-agent-first experience for Guided Autopilot, but now pause and record a clear reason after a successful agent launch because the public chat API does not expose completion events.
- Prevented fully automatic mode from silently falling back to chat when direct model completion cannot be observed.
- Added **Run Fully Automatic Autopilot** as a dedicated command-level override so users can force `fully-automatic` for one run without changing workspace settings.
- Exposed the dedicated fully automatic command in the APEX Delivery view title and epic/phase context menus.

## User Impact

- Users can choose between an agent-driven pause/resume workflow and a stricter fully automatic workflow.
- Fully automatic runs now fail closed into a paused state instead of unexpectedly opening chat.
- The fully automatic entrypoint is easier to discover from the APEX Delivery UI.

## Breaking Changes

None intended.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.1.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Adds explicit Guided Autopilot execution modes to APEX Delivery Pipeline for Copilot, including a dedicated fully automatic run command and clearer pause semantics for Copilot agent handoffs.