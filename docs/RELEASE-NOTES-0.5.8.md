# APEX Delivery Pipeline for Copilot 0.5.8

## Summary

Version 0.5.8 is a feature release that introduces a built-in PBI Delivery workflow, adds worktree-aware execution and dashboard signals, and broadens smoke coverage around session routing and local worktree orchestration.

## Highlights

- Added the built-in PBI Delivery workflow with new templates for intake, investigation, design decisions, code flow, test decisions, PBI review, and evidence capture.
- Added commands for creating and importing PBI deliveries, running code-flow and TDD-oriented slices, generating PBI reviews and evidence packs, and opening linked branch worktrees.
- Improved Copilot session execution planning so phase runs can use linked-branch worktree context and route through the appropriate handoff path when needed.
- Expanded the dashboard with owner and phase-status filters, review-readiness scoring, stale handoff detection, and richer PR/worktree visibility.
- Added smoke coverage for session routing, workflow preset validation, and worktree pool behavior.

## User Impact

- Teams can manage day-to-day PBIs as a first-class workflow inside the extension instead of adapting the broader epic flow by hand.
- Linked branches and local worktrees are surfaced more clearly, which reduces ambiguity when running a phase against the wrong workspace context.
- Review and evidence generation are easier to standardize because the extension can scaffold artifacts directly from the PBI workflow.

## Breaking Changes

None intended.

## Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.8.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Adds a built-in PBI Delivery workflow with dedicated commands and templates, introduces worktree-aware execution and dashboard signals, and broadens smoke coverage for session routing and worktree pooling.