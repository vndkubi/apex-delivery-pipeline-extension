# APEX Delivery Pipeline for Copilot 0.5.3

## Summary

Version 0.5.3 fixes Guided Autopilot for existing epics whose `.apex-workflow.json` snapshots were created before a phase later gained `autopilot` metadata in workspace settings.

## Highlights

- Added Guided Autopilot fallback to the current `apexDelivery.workflowDefinitions` phase policy when an epic snapshot is missing `autopilot` metadata.
- Kept explicit snapshot policy precedence intact when a phase already defines `autopilot` in the epic snapshot.
- Removed the need for users to manually patch stale `.apex-workflow.json` files after enabling autopilot later.
- Added smoke-test coverage for the stale-snapshot regression path.

## User Impact

- Existing epics created before a workflow phase was marked autopilot-enabled can now use Guided Autopilot without hand-editing snapshot metadata.
- New epics continue to store a workflow snapshot at creation time.
- Runtime now distinguishes between explicit snapshot policy and missing snapshot metadata, using the live workflow definition only for the missing fields.

## Breaking Changes

None intended.

## Validation

- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.3.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Fixes Guided Autopilot for older epic workflow snapshots by falling back to the current workflow phase policy when `autopilot` metadata is missing, so users no longer need to patch stale `.apex-workflow.json` files by hand.