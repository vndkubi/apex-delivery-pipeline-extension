import * as assert from 'assert';
import { resolveParticipantPromptContext } from '../../participantPromptContext';

export function runSessionRoutingSmokeSuite(): void {
  const promptMatchedResolution = resolveParticipantPromptContext('Investigate APEX_SESSION=session-a', {
    extractSessionKey: (prompt) => prompt.match(/APEX_SESSION=([A-Za-z0-9-]+)/)?.[1],
    getSessionByKey: (key) => key === 'session-a' ? { sessionId: 'session-a' } : undefined,
    lastSessionKey: 'session-b',
    fallbackTarget: { epicKey: 'APEX-1', phaseId: 'discover' },
  });
  assert.deepStrictEqual(promptMatchedResolution, {
    kind: 'session',
    session: { sessionId: 'session-a' },
  }, 'AC1: Expected @apex prompt session markers to win when the referenced session is known.');

  const lastSessionResolution = resolveParticipantPromptContext('Investigate with recent chat context', {
    extractSessionKey: () => undefined,
    getSessionByKey: (key) => key === 'session-b' ? { sessionId: 'session-b' } : undefined,
    lastSessionKey: 'session-b',
    fallbackTarget: { epicKey: 'APEX-1', phaseId: 'discover' },
  });
  assert.deepStrictEqual(lastSessionResolution, {
    kind: 'session',
    session: { sessionId: 'session-b' },
  }, 'AC1: Expected @apex to reuse the most recent phase session when the prompt does not pin a specific session.');

  const fallbackTargetResolution = resolveParticipantPromptContext('Investigate without prior run', {
    extractSessionKey: () => undefined,
    getSessionByKey: () => undefined,
    fallbackTarget: { epicKey: 'APEX-2', phaseId: 'review' },
  });
  assert.deepStrictEqual(fallbackTargetResolution, {
    kind: 'target',
    target: { epicKey: 'APEX-2', phaseId: 'review' },
  }, 'AC1: Expected @apex to fall back to the current phase target when no prior phase session exists.');

  const unresolvedParticipantResolution = resolveParticipantPromptContext('Investigate without context', {
    extractSessionKey: () => undefined,
    getSessionByKey: () => undefined,
  });
  assert.deepStrictEqual(unresolvedParticipantResolution, {
    kind: 'unresolved',
  }, 'AC1: Expected @apex prompt resolution to stay unresolved when neither a prior session nor a current phase target exists.');
}
