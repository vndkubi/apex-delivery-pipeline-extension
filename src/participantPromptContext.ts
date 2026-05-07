export type ParticipantPromptResolution<TSession, TTarget> =
  | {
    kind: 'session';
    session: TSession;
  }
  | {
    kind: 'target';
    target: TTarget;
  }
  | {
    kind: 'unresolved';
  };

export function resolveParticipantPromptContext<TSession, TTarget>(
  prompt: string,
  options: {
    extractSessionKey: (prompt: string) => string | undefined;
    getSessionByKey: (key: string) => TSession | undefined;
    lastSessionKey?: string;
    fallbackTarget?: TTarget;
  },
): ParticipantPromptResolution<TSession, TTarget> {
  const sessionKey = options.extractSessionKey(prompt);
  if (sessionKey) {
    const session = options.getSessionByKey(sessionKey);
    if (session) {
      return {
        kind: 'session',
        session,
      };
    }
  }

  if (options.lastSessionKey) {
    const session = options.getSessionByKey(options.lastSessionKey);
    if (session) {
      return {
        kind: 'session',
        session,
      };
    }
  }

  if (options.fallbackTarget) {
    return {
      kind: 'target',
      target: options.fallbackTarget,
    };
  }

  return {
    kind: 'unresolved',
  };
}