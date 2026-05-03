# Publish Notes 0.5.6

## Marketplace Short Summary

APEX Delivery Pipeline for Copilot 0.5.6 reopens the stored epic-scoped fallback chat session on rerun instead of creating a new ask-mode chat, and refreshes the README to match the current shipped feature set.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.6 is a focused chat-continuation and documentation accuracy release.

This version fixes the scoped fallback rerun path so an epic that already has prior fallback chat state now reopens that stored epic-scoped chat session after the user closes chat, instead of issuing a fresh ask-mode launch. Epic isolation remains intact, so reopening a stored session for one epic does not leak into another epic.

The release also refreshes the public project surface in documentation and Marketplace metadata. README coverage now includes the currently shipped branch-to-epic linking commands, linked worktree support, PR review artifact generation, and the current fallback chat continuation behavior.

## GitHub Release Body

### Highlights

- Fixed epic-scoped fallback chat continuation so reruns reopen the stored session instead of creating a new ask-mode chat.
- Preserved session isolation across epics during fallback chat reuse.
- Added smoke coverage for reused fallback sessions and deterministic new-epic selection in the test harness.
- Refreshed README and Marketplace metadata to reflect branch linking, linked worktrees, PR review artifacts, and current chat continuation behavior.

### Validation

- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.6.vsix`
