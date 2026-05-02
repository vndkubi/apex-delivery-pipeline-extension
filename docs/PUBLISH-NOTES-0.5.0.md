# Publish Notes 0.5.0

## Marketplace Short Summary

Guided Autopilot is easier to find. This release adds autopilot actions to the APEX view title and epic context menus so users can discover and run the flow more easily.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.0 is a usability release focused on Guided Autopilot discoverability.

The runtime already supported Guided Autopilot commands from epic-scoped targets, but the UI mainly exposed them through phase-item menus. This release surfaces **Run Guided Autopilot** in the APEX Delivery view title and adds **Run**, **Pause**, and **Resume Guided Autopilot** to epic context menus, making the feature easier to find and use without changing the underlying execution model.

This keeps current phase-level workflows intact while reducing confusion for users who could not locate the autopilot entrypoint.

## GitHub Release Body

### Highlights

- Added Guided Autopilot to the APEX view title.
- Added Run, Pause, and Resume Guided Autopilot to epic context menus.
- Kept the existing phase-level autopilot surface unchanged.
- No runtime behavior change; this is a discoverability improvement release.

### Validation

- `npm run compile`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.0.vsix`