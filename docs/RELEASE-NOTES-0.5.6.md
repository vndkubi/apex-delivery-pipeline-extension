# APEX Delivery Pipeline for Copilot 0.5.6

## Summary

Version 0.5.6 is a chat-continuation and documentation accuracy release. It fixes the scoped fallback chat rerun path so an epic with prior fallback session state reopens that existing chat session instead of spawning a fresh ask-mode chat, and it refreshes the README to reflect the currently shipped command surface.

## Highlights

- Fixed rerun behavior for epic-scoped fallback chat sessions so the extension reopens the stored chat session after closure instead of launching a new ask-mode conversation.
- Preserved epic isolation so reopening a stored session for one epic does not bleed into another epic.
- Added smoke coverage for reused fallback chat sessions and hardened the test setup to target the newly created epic instead of whichever epic happened to scan first.
- Refreshed the README to document the current feature surface, including branch-to-epic linking, linked worktrees, PR review artifact generation, and the current fallback chat continuation behavior.
- Updated Marketplace metadata for the 0.5.6 release.

## User Impact

- Users rerunning a phase after closing a previously used fallback chat now return to the same epic-scoped chat session rather than being sent to a fresh ask-mode chat.
- The README now reflects the commands that are actually available today, including Git branch coordination and PR review artifact workflows.
- The extension description in Marketplace metadata now mentions branch-linked worktrees and PR review artifacts.

## Breaking Changes

None intended.

## Validation

- `npm run test:smoke`
- `npm run package`
- `npm run publish`

## Packaging Artifact

Generated VSIX:

`apex-delivery-pipeline-v1-0.5.6.vsix`

## Publish Notes

Suggested Marketplace/GitHub release summary:

> Fixes epic-scoped fallback chat continuation so reruns reopen the stored chat session after closure, and refreshes the README plus Marketplace metadata to match the current feature surface, including branch-linked worktrees and PR review artifacts.
