export interface RunPreferenceFields {
  autoSubmit?: boolean;
  agentTag?: string;
  modelFamily?: string;
  preferredChatAgent?: string;
  starterPrompt?: string;
}

export interface RolePolicyResolution {
  userRole?: string;
  preferredRole?: string;
  status: 'not-configured' | 'not-required' | 'matched' | 'mismatched';
  note?: string;
  preferences: RunPreferenceFields;
}

export function resolveRolePolicy(
  phaseOwner: string | undefined,
  userRole: string | undefined,
  rawRolePolicies: unknown,
): RolePolicyResolution {
  const normalizedUserRole = normalizeRoleName(userRole);
  const normalizedPreferredRole = normalizeRoleName(phaseOwner);
  const rolePolicies = isRecord(rawRolePolicies) ? rawRolePolicies : {};
  const matchedPolicyKey = normalizedUserRole
    ? Object.keys(rolePolicies).find((candidate) => normalizeRoleName(candidate) === normalizedUserRole)
    : undefined;
  const preferences = matchedPolicyKey ? parseRolePolicyOverride(rolePolicies[matchedPolicyKey]) : {};

  if (!normalizedUserRole) {
    return {
      preferredRole: phaseOwner?.trim() || undefined,
      status: 'not-configured',
      note: normalizedPreferredRole
        ? `This phase is aligned to the role "${phaseOwner}" but apexDelivery.userRole is not configured.`
        : undefined,
      preferences,
    };
  }

  if (!normalizedPreferredRole) {
    return {
      userRole,
      status: 'not-required',
      preferences,
    };
  }

  if (normalizedPreferredRole === normalizedUserRole) {
    return {
      userRole,
      preferredRole: phaseOwner,
      status: 'matched',
      preferences,
    };
  }

  return {
    userRole,
    preferredRole: phaseOwner,
    status: 'mismatched',
    note: `This phase prefers the role "${phaseOwner}" but the current configured role is "${userRole}".`,
    preferences,
  };
}

function parseRolePolicyOverride(rawOverride: unknown): RunPreferenceFields {
  if (!isRecord(rawOverride)) {
    return {};
  }

  const override: RunPreferenceFields = {};
  if (typeof rawOverride.autoSubmit === 'boolean') {
    override.autoSubmit = rawOverride.autoSubmit;
  }

  const agentTag = normalizeNonEmptyString(rawOverride.agentTag);
  if (agentTag) {
    override.agentTag = agentTag;
  }

  const modelFamily = normalizeNonEmptyString(rawOverride.modelFamily);
  if (modelFamily) {
    override.modelFamily = modelFamily;
  }

  const preferredChatAgent = normalizeNonEmptyString(rawOverride.preferredChatAgent);
  if (preferredChatAgent) {
    override.preferredChatAgent = preferredChatAgent;
  }

  const starterPrompt = normalizeNonEmptyString(rawOverride.starterPrompt);
  if (starterPrompt) {
    override.starterPrompt = starterPrompt;
  }

  return override;
}

function normalizeRoleName(value: string | undefined): string | undefined {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.replace(/\s+/g, ' ').toLowerCase();
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}