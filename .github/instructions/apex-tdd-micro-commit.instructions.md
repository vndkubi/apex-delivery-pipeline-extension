---
applyTo: "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,kt,kts,cs,rs,rb,php,swift,c,cc,cpp,cxx,h,hpp}"
description: "Use strict TDD, focused validation, and phase-pure local micro-commits for implementation work across common programming languages."
---

# TDD Micro-Commit Rules

- Decompose the change into the smallest vertical slices before editing production code.
- For each slice, the first implementation action must be a failing targeted test in the nearest relevant test surface.
- Observe the failure before writing production code.
- Green means implement the minimum code needed to pass the targeted failure.
- Refactor means behavior-preserving cleanup only.
- After the first substantive edit in a phase, the very next step must be focused validation.
- Prefer this validation order: the narrowest targeted test for the slice, then the repo's focused smoke or integration check when relevant, then the repo's compile or type-check command when needed.
- Use local commit prefixes by phase: `test:` for Red, `feat:` or `fix:` for Green, `refactor:` for Refactor, and `chore:` only for prerequisite setup work that must happen before the first Red.
- Do not push, merge, or claim final completion from these instructions alone. Human review is required before push, merge, release, or any non-obvious architecture change.
- Stop and escalate instead of guessing when validation fails for unrelated reasons or the slice cannot be implemented without changing the approved architecture.