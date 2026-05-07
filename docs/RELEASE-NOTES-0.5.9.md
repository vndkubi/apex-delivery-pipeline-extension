# APEX Delivery Pipeline for Copilot 0.5.9

## Summary

Version 0.5.9 is a usability and workflow-authoring refinement release. It improves epic creation, reshapes the workflow configuration editor into a phase workbench, and tightens routing controls to the supported workspace modes.

## Highlights

- Renamed the Create Sample Epic command to Create Epic and added support for passing or prompting for a real epic title during creation.
- Updated bootstrap wiring so newly created epics can use the provided title instead of the fixed pilot placeholder.
- Reworked the workflow configuration panel into a three-pane workbench with a phase outline, focused phase detail editor, and dedicated runtime preview dock.
- Persisted selected-phase state in the workflow editor and refreshed helper copy across the dashboard and status bar to match the new Create Epic terminology.
- Normalized workflow routing values to supported `control` and `pinned` modes, removed deprecated Managed Pool controls from the editor, and aligned smoke coverage with the new routing model.

## User Impact

- Teams can create new epics with meaningful titles immediately instead of renaming a default pilot artifact after scaffolding.
- Workflow authors can move through complex phase definitions faster because navigation, editing, and runtime inspection are separated into clearer panels.
- Editors no longer expose deprecated routing choices, which reduces ambiguity between what the UI allows and what the extension actually supports.

## Breaking Changes

None intended. Existing workflow execution settings that still contain deprecated values are normalized to supported editor modes when loaded through the workflow editor.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.9.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Streamlines epic creation with explicit titles, reshapes the workflow editor into a phase workbench with a docked runtime preview, and tightens workspace routing to the supported control and pinned modes.