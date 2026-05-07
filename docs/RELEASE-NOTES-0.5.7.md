# APEX Delivery Pipeline for Copilot 0.5.7

## Summary

Version 0.5.7 is a workflow configuration hotfix release. It restores the Add Workflow action in the workflow editor by fixing a webview script generation bug that prevented the panel JavaScript from parsing at startup.

## Highlights

- Fixed the workflow configuration webview so clicking Add Workflow once again creates a new editable workflow card.
- Corrected the generated inline script escaping for workspace-relative path validation, preventing startup parse failures in the workflow editor.
- Added regression coverage that syntax-checks the emitted workflow configuration webview script before release.

## User Impact

- Teams using Configure Workflows can create new workspace workflows again without hand-editing `apexDelivery.workflowDefinitions` JSON.
- The workflow configuration panel now finishes initializing, so its buttons and client-side validation behave normally on first load.

## Breaking Changes

None intended.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.7.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Restores the Add Workflow action in the workflow configuration editor by fixing a webview script parse failure, and adds regression coverage for the generated workflow UI script.