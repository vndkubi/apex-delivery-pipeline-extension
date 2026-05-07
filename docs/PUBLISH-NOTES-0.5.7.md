# Publish Notes 0.5.7

## Marketplace Short Summary

APEX Delivery Pipeline for Copilot 0.5.7 restores the Add Workflow action in the workflow configuration UI by fixing a webview script parse failure during panel startup.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.7 is a focused workflow-configuration hotfix.

This release fixes the workflow editor webview so the panel script initializes cleanly again. In 0.5.6, an escaping issue in the generated inline validation script could break JavaScript parsing during startup, which left the workflow editor unresponsive and prevented Add Workflow from creating a new draft.

Version 0.5.7 corrects that script generation path and adds regression coverage that syntax-checks the emitted workflow configuration webview script before packaging and publishing.

## GitHub Release Body

### Highlights

- Restored Add Workflow in the workflow configuration editor.
- Fixed webview script generation so the workflow panel no longer fails to parse during startup.
- Added regression coverage for the emitted workflow UI script.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.7.vsix`