# APEX Delivery Pipeline for Copilot 0.3.0

## Summary

Version 0.3.0 packages the custom workflow milestone for the Copilot-first APEX delivery extension. The main release theme is that teams can now define multiple workflow shapes, choose one when creating an epic, and keep that workflow stable through the life of the epic.

## Highlights

- Added workspace-configurable `apexDelivery.workflowDefinitions` so teams can define custom workflow ids, names, and phase sequences.
- Snapshotted workflow selection into epic-local `.apex-workflow.json` metadata at epic creation time, so later settings changes do not rewrite old epics.
- Extended the scanner and tree view to surface workflow identity on each epic.
- Scoped Run Phase preferences by `workflowId + phaseId`, with legacy flat phase overrides still supported as fallback.
- Exposed workflow identity in developer trace entries.
- Added smoke-test coverage for a real custom workflow path.

## User Impact

- Teams can support different delivery modes such as investigate-only, discovery-to-implementation, or review-centric workflows without changing code.
- Existing epics remain stable because workflow definitions are frozen at creation time.
- Per-phase Copilot behavior can now vary across workflows instead of being globally tied to one phase id.

## Breaking Changes

None intended.

Backward compatibility note:

- Existing epics without workflow metadata continue to resolve to the built-in default workflow.
- Existing flat `apexDelivery.runPhase.phaseProfiles.<phaseId>` entries are still read as fallback.

## Validation

- `npm run compile`
- `npm run test:smoke`

Both checks passed before packaging this release.

## Packaging Artifact

Expected VSIX output after packaging:

`apex-delivery-pipeline-v1-0.3.0.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Adds custom workflow definitions to APEX Delivery Pipeline for Copilot. Teams can now define multiple workflow shapes in settings, select a workflow when creating an epic, and keep that workflow snapshotted for the epic lifetime. This release also adds workflow-aware phase profiles, workflow labels in the tree and trace views, and smoke-test coverage for the new path.

## Recommended Post-Publish Checks

- Install the generated VSIX in a clean VS Code window.
- Create one sample epic with the default workflow and one with a custom workflow.
- Confirm workflow labels appear in the tree and dashboard.
- Run a phase with workflow-scoped profile overrides.