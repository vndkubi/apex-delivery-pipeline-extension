# APEX Delivery Pipeline for Copilot 0.5.0

## Summary

Version 0.5.0 packages a usability-focused minor release for Guided Autopilot. The main goal is to make the autopilot controls easier to discover in the APEX Delivery UI without changing the underlying execution model.

## Highlights

- Added **Run Guided Autopilot** to the APEX Delivery view title so users can discover the flow without first drilling into a phase context menu.
- Added **Run**, **Pause**, and **Resume Guided Autopilot** to epic-node context menus because runtime already supports epic-scoped autopilot execution.
- Kept the existing phase-item autopilot controls unchanged, so current workflows still work.
- Preserved the current Guided Autopilot runtime and command registration behavior; this release is focused on UI discoverability rather than execution semantics.

## User Impact

- Users no longer need to guess that Guided Autopilot is hidden on a phase context menu.
- Epic-level autopilot flows are now easier to trigger from the tree because the UI reflects what runtime already supports.
- Support burden should drop for the “I can’t find Run Guided Autopilot” path.

## Breaking Changes

None intended.

## Validation

- `npm run compile`
- `npm run package`
- `npm run publish`

All three checks passed for this release slice.

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.0.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Improves Guided Autopilot discoverability in APEX Delivery Pipeline for Copilot by exposing autopilot actions in the APEX view title and epic context menus, while keeping the existing phase-level flow intact.