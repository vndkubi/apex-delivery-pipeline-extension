# Publish Notes 0.5.4

## Marketplace Short Summary

APEX Delivery Pipeline for Copilot 0.5.4 adds epic-scoped Copilot Chat session routing, surfaces the session marker in the developer trace, and removes extra Guided Autopilot tree actions to keep the pipeline UI tighter.

## Marketplace Long Summary

APEX Delivery Pipeline for Copilot 0.5.4 is a usability and chat-routing release.

This version keeps phase handoff conversations isolated per epic by routing Copilot Chat through deterministic native `vscode-chat-session` resources and embedding `APEX_SESSION` markers in the prepared prompts. The same epic now reuses the same native chat session across phases, while a different epic opens a separate session.

The developer trace panel now shows the `APEX_SESSION` marker directly so cross-epic routing is easier to inspect. The tree surface is also cleaner: the extra Guided Autopilot pause and resume buttons were removed from the APEX view, while the underlying commands remain available through commands and existing runtime flows.

## GitHub Release Body

### Highlights

- Added epic-scoped native Copilot Chat session routing using canonical `vscode-chat-session://local/<base64url(sessionId)>` resources.
- Reused the same native chat session for later phases in the same epic and separated sessions across different epics.
- Added `APEX_SESSION` visibility in the Developer Trace Panel.
- Removed Pause/Resume Guided Autopilot buttons from the APEX tree surface while keeping the commands intact.
- Added smoke coverage for scoped chat session reuse and session URI shape.

### Validation

- `npm run compile`
- `npm run test:smoke`
- `npm run package`
- `npm run publish`

### Artifact

- `apex-delivery-pipeline-v1-0.5.4.vsix`