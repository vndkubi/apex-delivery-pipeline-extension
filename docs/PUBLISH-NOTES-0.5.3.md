# Publish Notes 0.5.3

## Marketplace Short Summary

Guided Autopilot now falls back to the current workflow phase policy when older epic snapshots are missing `autopilot` metadata, so stale `.apex-workflow.json` files no longer need manual patching.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.3 is a focused bugfix release for Guided Autopilot on existing epics.

The previous behavior treated epic-local workflow snapshots as final even when a phase had been created before `autopilot` settings were added later in workspace configuration. That meant users could enable autopilot in `apexDelivery.workflowDefinitions` and still hit a runtime stop for older epics unless they edited each `.apex-workflow.json` by hand.

This release keeps explicit snapshot policy precedence intact, but now falls back to the current workflow definition for the same workflow id and phase id when the snapshot is missing `autopilot` metadata. New epics still snapshot workflow metadata at creation time, while older epics no longer require manual repair for this case.

## GitHub Release Body

### Highlights

- Fixed Guided Autopilot for older epic snapshots that lack `autopilot` metadata on a phase.
- Added runtime fallback to the current `apexDelivery.workflowDefinitions` phase policy for missing autopilot fields.
- Preserved snapshot precedence when the epic already contains explicit phase autopilot policy.
- Added a smoke-test regression for the stale-snapshot fallback path.

### Validation

- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.3.vsix`