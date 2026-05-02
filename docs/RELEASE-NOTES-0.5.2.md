# APEX Delivery Pipeline for Copilot 0.5.2

## Summary

Version 0.5.2 packages the fix for the fully automatic autopilot command path exposed in the APEX Delivery view title. The goal is to make the no-argument UI entrypoint work reliably without changing the fully automatic execution model itself.

## Highlights

- Fixed **Run Fully Automatic Autopilot** when launched from the view title without explicit phase or epic arguments.
- Added fallback target resolution using the latest tree selection.
- Added a single-epic fallback that uses the current phase when the tree has only one epic.
- Kept the `fully-automatic` execution semantics unchanged.
- Added smoke-test coverage for the title-command regression path.

## User Impact

- Users can trigger fully automatic autopilot from the title bar without first opening a phase context menu.
- The command no longer stops with **Select a delivery phase or epic first.** in the common single-epic workflow.
- The fix only affects target resolution; agent-pause and fully automatic behaviors remain unchanged.

## Breaking Changes

None intended.

## Validation

- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.2.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Fixes the fully automatic autopilot title-bar command in APEX Delivery Pipeline for Copilot by resolving the active epic or phase from tree context when explicit command arguments are not provided.