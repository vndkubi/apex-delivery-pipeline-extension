# Managed Worktree Pool v1

EN: This document defines a workflow-scoped managed-worktree-pool design for APEX, with a Phase 1 delivery that removes misleading chat model hints and reframes linked branch worktrees as pinned/manual workspaces.  
VI: Tài liệu này đặc tả thiết kế managed-worktree-pool theo workflow cho APEX, với Phase 1 tập trung bỏ model hint gây nhiễu khỏi chat prompt và đổi linked branch worktree thành pinned/manual workspace.

## Executive Summary

The current linked-branch worktree flow is workable for a small number of active epics, but it does not scale well when each active branch becomes a visible sibling folder and a separate working context. `Managed Worktree Pool v1` keeps one control workspace for all epics and treats branch-specific worktrees as managed execution capacity rather than the primary user-facing workspace model.

The design is constrained by three rules:

1. Pool behavior must depend on the workflow snapshot already stored on each epic, not on a global default that affects unrelated epics.
2. Pool behavior must not assume a phase named `implement` or any other hard-coded phase id.
3. Ask-mode and agent-mode prompts must not inject model-family hints by default because the host GitHub Copilot Chat UI model picker is the actual source of truth for those chat surfaces.

Phase 1 does not ship the pool itself. It removes default chat model hints and reframes `Open Linked Branch Worktree` as a pinned/manual workspace action while preserving the current manual create-or-reuse behavior under the hood.

## Problem Statement

Today the extension treats a linked-branch worktree as the primary recovery path whenever branch-local execution or review is required. This creates two scaling problems:

1. If teams run many active epic branches in parallel, visible sibling worktree folders can grow toward one folder per active linked branch.
2. The user experience suggests that users must manually open a second workspace before branch-local work can continue.

At the same time, current prompt text can inject `Preferred model family hint: ...` into ask-mode and agent-mode chat prompts even though the actual model used by GitHub Copilot Chat follows the host UI picker rather than the text hint in the prompt.

## Goals

- Keep one control workspace as the canonical APEX portfolio view for all epics.
- Make branch-local execution capacity workflow-scoped and epic-scoped through snapshotted workflow settings.
- Keep built-in default workflows and non-pooled workflows on the current control-workspace path.
- Remove misleading model-family text from ask-mode and agent-mode prompts.
- Reframe manual linked-branch workspace opening as an advanced pinned/manual action instead of the default next step for all branch-local operations.

## Non-goals

- Shipping the full pool allocator in Phase 1.
- Auto-enabling pool behavior for every epic.
- Requiring the built-in default workflow to include any specific phase name.
- Locking the GitHub Copilot Chat model picker programmatically.

## Constraints

### Constraint 1: Workflow-Scoped Pool Policy

Managed worktree behavior must be decided from the workflow snapshot already stored on the epic. The future pool cannot read only the current workspace workflow definitions because those can drift after the epic is created.

### Constraint 2: Phase-Agnostic Execution

Pool routing must not depend on a hard-coded phase name such as `implement`. Different workflows may omit implementation entirely or use a different sequence for code-heavy work.

### Constraint 3: Prompt Truthfulness

Ask-mode and agent-mode prompts should not claim a preferred model family by default because the user-visible model actually comes from the chat UI picker. Direct model execution owned by the extension may still use a preferred model family internally.

## Proposed Architecture

### Control Workspace

The control workspace remains the canonical home for epic scanning, workflow selection and snapshotting, dashboard and trace views, and most manual artifact editing flows.

### Managed Execution Pool

Future pooled worktrees should be hidden and capacity-bound rather than one visible sibling folder per active linked branch.

Suggested shape:

- pool root: configurable hidden directory such as `.apex-worktrees/<repo>/`
- warm slots: fixed upper bound, for example `slot-01` through `slot-08`
- lease model: branch-local commands acquire a slot, execute, then release or keep warm according to a TTL

### Optional Pinned Workspace

Some users still need a visible branch-isolated workspace for manual deep work. That becomes an explicit pinned/manual action:

- open an existing pinned workspace for the linked branch
- or pin one managed slot as a visible manual workspace

This should be rare and user-driven, not the default path for every linked epic.

## Workflow Snapshot Policy

Future workflow definitions should gain an execution policy that is snapshotted into each epic along with the phase sequence.

Illustrative shape:

```json
{
  "execution": {
    "mode": "control",
    "commands": {
      "runPhase": "control",
      "reviewPullRequest": "pooled",
      "openWorkspace": "pinned"
    }
  },
  "chat": {
    "modelHintMode": "never"
  }
}
```

Interpretation:

- `control`: stay in the main workspace
- `pooled`: acquire a managed branch-local slot only for execution
- `pinned`: allow a visible manual workspace for long-lived branch work

## Command Semantics

### Current Command To Reframe

Command id stays the same for compatibility:

- `apexDelivery.openLinkedBranchWorktree`

User-facing semantics should change from “open the linked worktree” to “open the pinned branch workspace”.

### Future Command Semantics

1. `Link Branch To Epic`
   Keeps the branch-to-epic binding behavior.
2. `Review Pull Request`
   Should eventually acquire a pooled execution slot automatically when the linked workflow snapshot requires pooled execution.
3. `Generate PR Review Artifact`
   Should follow the same pooled execution rule as linked PR review.
4. `Open Pinned Branch Workspace`
   Advanced/manual action only. Opens or creates a visible pinned workspace.
5. `Release Pinned Branch Workspace`
   Future cleanup command for pinned branch workspaces.
6. `Prune Idle Execution Workspaces`
   Future maintenance command for the pool.

## Phase 1 Scope

Phase 1 intentionally ships only the smallest safe cleanup:

1. Remove default model-family hint text from ask-mode and agent-mode prompts.
2. Keep direct model-family preference behavior for the extension-owned direct LM path.
3. Rename and reframe visible linked-worktree UX to pinned/manual wording.
4. Leave the underlying manual create-or-reuse worktree behavior unchanged.

## Exact Code Surfaces For Phase 1

### Prompt Builders

- `src/extension.ts` ask-mode starter builder
- `src/extension.ts` agent-mode starter builder

Phase 1 removes the `Preferred model family hint: ...` line from both starter builders.

### Direct Model Preference Preservation

- `src/extension.ts` direct model run path
- `src/extension.ts` artifact proposal direct model path

These direct paths may continue to use `preferredModelFamily` internally.

### Manual Worktree UX Reframing

- `package.json` command title for `apexDelivery.openLinkedBranchWorktree`
- `src/extension.ts` manual worktree-open command strings
- `src/extension.ts` blocked guidance for linked branch mismatch and linked PR review

Phase 1 changes visible text from linked-worktree language to pinned/manual branch-workspace language.

### Tests To Update

- smoke assertions for ask-mode fallback prompt text
- smoke assertions for agent-mode prompt text
- smoke assertions for blocked linked-review guidance text

## Future Implementation Order

1. Add workflow execution policy parsing, validation, snapshotting, and UI editing.
2. Add a worktree-pool manager module with slot acquisition, release, and pruning.
3. Convert linked PR review and PR artifact generation to pooled execution based on workflow snapshot policy.
4. Update dashboard and portfolio model from raw worktree signals to pooled execution signals.
5. Add pinned-workspace lifecycle commands.

## Risks

- Mixed terminology will remain if only some surfaces are renamed away from linked-worktree wording.
- If future workflow execution policy is not snapshotted into the epic, pool behavior could drift as workspace settings change.
- Users may still expect model-family text in prompts if direct execution logs continue to mention preferred model selection; this is acceptable as long as chat prompts stay truthful.

## Verification

- `npm run compile`
- `npm run test:smoke`

Phase 1 verification focus:

1. Ask-mode and agent-mode prompts no longer contain model hint text.
2. Direct execution still retains preferred direct model behavior internally.
3. Visible worktree UX uses pinned/manual wording without changing the current manual open-or-reuse implementation.