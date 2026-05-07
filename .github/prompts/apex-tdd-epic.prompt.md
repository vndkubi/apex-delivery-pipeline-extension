---
description: "Implement one epic using strict TDD, local micro-commits, and human review gates at push, merge, and ambiguous architecture decisions."
---

# APEX TDD Epic

Use this prompt to execute one epic in this repository with strict TDD and low prompt count.

## Input

Epic summary: ${input:epic:Paste the epic summary or ticket}
Acceptance criteria: ${input:acceptanceCriteria:Paste the acceptance criteria list}
Validation strategy: ${input:validation:Name the narrowest test, smoke command, or compile path to use}

## Operating Contract

1. First, decompose the epic into the smallest vertical slices.
2. For each slice, execute Red -> Green -> Refactor in order.
3. Red means write or update the smallest targeted failing test first, run focused validation, and create exactly one local `test:` commit after the failure is observed.
4. Green means implement the minimum code to pass that targeted failure, rerun the same focused validation, and create exactly one local `feat:` or `fix:` commit after the pass is observed.
5. Refactor means improve structure without changing behavior, rerun the same focused validation, and create exactly one local `refactor:` commit.
6. Do not mix multiple TDD phases in one commit.
7. Do not batch multiple slices into one commit sequence.
8. Continue automatically from slice to slice without asking for confirmation unless blocked.
9. A blocker is only one of these: ambiguous acceptance criteria, missing dependency or environment capability, unrelated failing validation, or a non-obvious architecture decision not implied by the epic.
10. Do not push or merge. Stop for human review before any push, merge, release step, or architectural fork.

## Output After Each Slice

- Slice name
- Acceptance criterion covered
- Red evidence
- Green evidence
- Refactor summary
- Files changed
- Validation run
- Local commits created
- Next slice

## Final Output

- Map each acceptance criterion to slices, tests, and commits.
- List residual risks, open questions, and any human review needed before push or merge.