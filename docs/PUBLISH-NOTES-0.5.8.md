# Publish Notes 0.5.8

## Marketplace Short Summary

APEX Delivery Pipeline for Copilot 0.5.8 adds a built-in PBI Delivery workflow with dedicated commands, worktree-aware execution signals, and expanded smoke coverage for routing and worktree pooling.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.8 is a feature release focused on turning the extension into a more structured daily-delivery cockpit.

This release adds a built-in PBI Delivery workflow with dedicated templates and commands for intake, code-flow planning, test decisions, TDD slice execution, PBI-focused review, and evidence-pack generation. It also improves execution routing by factoring phase-run planning and linked-branch worktree resolution into the Copilot session flow, making it easier to keep phase work aligned with the right branch context.

Version 0.5.8 also expands the dashboard with owner and status filters, PBI review-readiness scoring, stale handoff detection, and local worktree/PR awareness. Regression coverage now includes workflow preset validation, session routing smoke checks, and worktree pool smoke tests to harden the new delivery flow before packaging and publishing.

## GitHub Release Body

### Highlights

- Added the built-in PBI Delivery workflow, templates, and command surface for intake, code flow, test decision, TDD slices, review, and evidence generation.
- Added linked-branch worktree handling and worktree-aware routing signals for phase execution and dashboard visibility.
- Expanded the dashboard with filter controls, review-readiness scoring, stale handoff detection, and PR/worktree status cues.
- Extended smoke coverage for session routing, workflow preset validation, and worktree pool behavior.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.8.vsix`