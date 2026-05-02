# Publish Notes 0.4.0

## Marketplace Short Summary

Guided Autopilot and Role-Aware Routing for Copilot-first APEX delivery workflows. Autopilot-enabled phases can now run, verify, pause, resume, and advance through the pipeline while role-based defaults shape Copilot routing without overriding explicit phase profiles.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.4.0 adds two major workflow upgrades.

First, Guided Autopilot lets a workflow snapshot opt individual phases into automatic continuation. The extension reuses the existing phase runner, verification evidence flow, and status transition logic to run autopilot-enabled phases, pause on unsaved manual artifact edits, retry failed verification up to the configured limit, and resume later from workspace state.

Second, Role-Aware Routing introduces `apexDelivery.userRole` and role-based routing defaults. Teams can define different preferred agent, model family, and auto-submit behavior for roles such as Developer, Business Analyst, or Reviewer while still allowing explicit workflow phase profiles to take precedence.

The developer trace panel now records role mismatch notes and autopilot pause reasons, and smoke coverage now validates the new pause/resume and precedence behavior.

## GitHub Release Body

### Highlights

- Guided Autopilot commands: run, pause, and resume.
- Workflow phase autopilot policy with retry and pause-on-manual-intervention support.
- Role-aware routing defaults keyed by the configured workspace user role.
- Trace visibility for user role, preferred role, and autopilot pause reasons.
- Smoke coverage for role-aware precedence and autopilot resume.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`

### Artifact

- `apex-delivery-pipeline-v1-0.4.0.vsix`

## Social / Release Post Draft

APEX Delivery Pipeline for Copilot 0.4.0 is out. This slice adds Guided Autopilot for workflow phases that can safely continue with verification-aware advancement, plus Role-Aware Routing so teams can tune Copilot defaults by role without losing explicit per-phase control.