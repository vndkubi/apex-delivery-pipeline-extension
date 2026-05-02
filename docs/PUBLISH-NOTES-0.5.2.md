# Publish Notes 0.5.2

## Marketplace Short Summary

Fully automatic Guided Autopilot now resolves the selected epic or phase correctly from the APEX view title, so the command no longer fails in the common no-argument UI path.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.2 is a focused bugfix release for the dedicated **Run Fully Automatic Autopilot** command.

The previous UI flow could invoke the command from the APEX Delivery view title without explicit phase or epic arguments. Runtime expected a target, so the command could stop early with **Select a delivery phase or epic first.** even when the tree already had a clear active context. This release adds a fallback resolution path that uses the latest tree selection and, when only one epic exists, that epic's current phase.

This keeps fully automatic execution semantics unchanged while making the command usable from the title-bar entrypoint it already exposes.

## GitHub Release Body

### Highlights

- Fixed `Run Fully Automatic Autopilot` when invoked from the APEX view title without explicit command arguments.
- Added fallback target resolution from the latest tree selection.
- Added a second fallback for the common single-epic case by using that epic's current phase.
- Added a smoke-test regression for the no-argument fully automatic command path.

### Validation

- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.2.vsix`