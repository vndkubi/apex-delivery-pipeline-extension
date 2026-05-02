# APEX Delivery Pipeline for Copilot 0.4.0

## Summary

Version 0.4.0 packages the Guided Autopilot and Role-Aware Routing slice for the Copilot-first APEX delivery extension. The release theme is that teams can now let the extension continue autopilot-enabled phases with verification-aware advancement while still shaping routing defaults by team role.

## Highlights

- Added phase-level workflow autopilot policy so workflow snapshots can mark individual phases as autopilot-enabled with retry and manual-intervention pause behavior.
- Added **Run Guided Autopilot**, **Pause Guided Autopilot**, and **Resume Guided Autopilot** commands in the tree and command palette.
- Implemented Guided Autopilot as a thin coordinator around the existing phase runner, verification pipeline, and phase status transition logic.
- Added `apexDelivery.userRole` plus `apexDelivery.runPhase.rolePolicies` so role-aware defaults can shape preferred agent, model family, and auto-submit behavior before explicit phase profile overrides.
- Extended the developer trace to capture user role, preferred role, routing mismatch notes, and autopilot-related pause reasons.
- Expanded smoke-test coverage to validate role-aware precedence, manual-intervention pause, and Guided Autopilot resume/advance behavior.

## User Impact

- Teams can model semi-automatic delivery paths where low-risk phases continue automatically until a manual checkpoint is reached.
- Developers can keep different Copilot routing defaults for roles such as Developer, Business Analyst, or Reviewer without cloning whole workflow profiles.
- Autopilot pause reasons are now visible and resumable instead of requiring the user to infer why a phase stopped.

## Breaking Changes

None intended.

Backward compatibility note:

- Existing epics without workflow autopilot metadata continue to behave as manual phases.
- Explicit workflow-scoped `runPhase.phaseProfiles` overrides still win over role-aware defaults.
- Existing flat `apexDelivery.runPhase.phaseProfiles.<phaseId>` entries are still read as fallback.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`

All three checks passed for this release slice.

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.4.0.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Adds Guided Autopilot and Role-Aware Routing to APEX Delivery Pipeline for Copilot. Workflow snapshots can now mark phases as autopilot-enabled, the extension can pause and resume verification-aware autopilot runs, and teams can apply role-based Copilot routing defaults while keeping explicit phase overrides in control.

## Recommended Post-Publish Checks

- Install the generated VSIX in a clean VS Code window.
- Create a workflow with one autopilot-enabled phase and confirm Guided Autopilot advances it to the next manual phase.
- Configure `apexDelivery.userRole` and `apexDelivery.runPhase.rolePolicies`, then confirm the trace panel shows the expected role match or mismatch details.
- Verify that explicit workflow phase profiles still override role defaults.