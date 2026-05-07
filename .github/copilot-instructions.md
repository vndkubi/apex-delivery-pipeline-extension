# Copilot Instructions - APEX Delivery Pipeline

Repository-wide operating rules for strict TDD epic execution with local micro-commits.

## Core Rules

1. Start from the smallest vertical slice that maps to an acceptance criterion.
2. Use Red -> Green -> Refactor for each slice. Do not write production code before a failing targeted test exists.
3. After the first substantive edit in any phase, run the narrowest validation that can falsify that phase.
4. Local git commits on the working branch are allowed for `test:`, `feat:`, `fix:`, `refactor:`, and prerequisite-only `chore:` commits.
5. Do not push, merge, rewrite shared history, or create release artifacts without human review.
6. Stop and escalate when acceptance criteria are ambiguous, validation fails for unrelated reasons, or the next step requires a non-obvious architecture decision.
7. Keep commit intent phase-pure: one slice, one phase, one commit whenever practical.
8. Report evidence honestly: failure observed, pass observed, files changed, commands run, commits created, and residual risks.

## Repo Anchors

- Extension source lives under `src/`.
- Smoke coverage lives under `src/test/suite/index.ts`.
- Type and build baseline: `npm run compile`.
- Smoke baseline when relevant: `npm run test:smoke`.

## Preferred Epic Entry Point

Use `.github/prompts/apex-tdd-epic.prompt.md` when starting a new implementation epic in this repository.
Use `.github/agents/apex-tdd-epic-executor.agent.md` when you want a dedicated TDD executor agent instead of a reusable prompt.