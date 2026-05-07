# Publish Notes 0.5.9

## Marketplace Short Summary

APEX Delivery Pipeline for Copilot 0.5.9 streamlines epic creation and upgrades the workflow configuration editor with a phase workbench, workspace-routing guardrails, and a clearer runtime preview.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.9 is a workflow authoring and usability refinement release.

This release renames the Create Sample Epic entry point to Create Epic, allows the command surface to pass a custom epic title, and prompts for that title directly when creating a new workflow-based epic. That makes the initial epic creation path feel less like a demo scaffold and more like a real delivery entry point.

Version 0.5.9 also redesigns the workflow configuration webview around a dedicated workbench layout: a phase outline, a focused detail editor, and a runtime preview dock. The editor now persists the selected phase, exposes workspace routing terminology instead of the older execution-policy wording, and removes deprecated Managed Pool options by normalizing workflow routing to supported `control` and `pinned` modes. Smoke coverage was updated to validate the new routing normalization and editor wording.

## GitHub Release Body

### Highlights

- Renamed Create Sample Epic to Create Epic and added explicit title entry for newly created epics.
- Added a workflow workbench UI with phase outline selection, focused phase detail editing, and a docked runtime preview.
- Reframed workflow execution policy as workspace routing and removed deprecated Managed Pool options from the editor.
- Updated smoke coverage to validate routing normalization and the refreshed workflow editor surface.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.9.vsix`