import type { PhaseSessionDefaults, StarterPromptPlacement } from './pipelineModel';
import { PBI_DELIVERY_WORKFLOW_ID } from './workflowModel';
import { resolveRolePolicy, type RolePolicyResolution } from './rolePolicy';

export interface PhaseRunPreferences {
  autoSubmit: boolean;
  agentTag?: string;
  preferredChatAgent?: string;
  starterPrompt?: string;
  starterPromptPlacement: StarterPromptPlacement;
}

export type PhaseRunProfileOverride = Partial<PhaseRunPreferences>;

export interface PhaseRunPreferenceSources {
  autoSubmit: string;
  agentTag: string;
  preferredChatAgent: string;
  starterPrompt: string;
  starterPromptPlacement: string;
}

export interface ResolvedPhaseRunPlan {
  rolePolicyResolution: RolePolicyResolution;
  runPreferences: PhaseRunPreferences;
  sources: PhaseRunPreferenceSources;
}

export interface ResolvePhaseRunPlanOptions {
  userRole?: string;
  workflowId: string;
  phaseId: string;
  phaseOwner?: string;
  workflowDefaults?: PhaseSessionDefaults;
  workspaceDefaults: PhaseRunPreferences;
  rawRolePolicies?: unknown;
  rawPhaseProfiles?: unknown;
}

export interface PhasePromptRenderContext {
  sessionMarker: string;
  workspaceRootDisplayPath?: string;
  epicDisplayPath?: string;
  artifactDisplayPath: string;
  artifactBasename: string;
  statusDisplayPath?: string;
  epicKey: string;
  epicTitle: string;
  workflowId: string;
  phaseId: string;
  phaseName: string;
  phaseStatus: string;
  phaseOutput: string;
  referenceText?: string;
  branchNames?: readonly string[];
  pullRequestCount?: number;
}

export interface PhasePromptSurfaces {
  scopedChat: string;
  agent: string;
  cli: string;
  directModel: string;
}

export function normalizeStarterPromptPlacement(value: unknown): StarterPromptPlacement | undefined {
  return value === 'prepend' || value === 'append' || value === 'replace'
    ? value
    : undefined;
}

export function resolvePhaseRunPlan(options: ResolvePhaseRunPlanOptions): ResolvedPhaseRunPlan {
  const rolePolicyResolution = resolveRolePolicy(
    options.phaseOwner,
    options.userRole,
    options.rawRolePolicies,
  );
  const roleDefaults = rolePolicyResolution.preferences ?? {};
  const override = resolvePhaseRunProfileOverride(options.rawPhaseProfiles, options.workflowId, options.phaseId);

  const autoSubmitResolution = resolveBooleanPreference([
    { value: override?.autoSubmit, source: 'phase profile override' },
    { value: options.workflowDefaults?.autoSubmit, source: 'workflow phase default' },
    { value: roleDefaults.autoSubmit, source: 'role policy' },
    { value: options.workspaceDefaults.autoSubmit, source: 'workspace default' },
  ], false);
  const agentTagResolution = resolveStringPreference([
    { value: override?.agentTag, source: 'phase profile override' },
    { value: options.workflowDefaults?.agentTag, source: 'workflow phase default' },
    { value: roleDefaults.agentTag, source: 'role policy' },
    { value: options.workspaceDefaults.agentTag, source: 'workspace default' },
  ]);
  const preferredChatAgentResolution = resolveStringPreference([
    { value: override?.preferredChatAgent, source: 'phase profile override' },
    { value: options.workflowDefaults?.preferredChatAgent, source: 'workflow phase default' },
    { value: roleDefaults.preferredChatAgent, source: 'role policy' },
    { value: options.workspaceDefaults.preferredChatAgent, source: 'workspace default' },
  ]);
  const starterPromptResolution = resolveStringPreference([
    { value: override?.starterPrompt, source: 'phase profile override' },
    { value: options.workflowDefaults?.starterPrompt, source: 'workflow phase default' },
    { value: roleDefaults.starterPrompt, source: 'role policy' },
    { value: options.workspaceDefaults.starterPrompt, source: 'workspace default' },
  ]);
  const starterPromptPlacementResolution = resolvePlacementPreference([
    { value: override?.starterPromptPlacement, source: 'phase profile override' },
    { value: options.workflowDefaults?.starterPromptPlacement, source: 'workflow phase default' },
    { value: roleDefaults.starterPromptPlacement, source: 'role policy' },
    { value: options.workspaceDefaults.starterPromptPlacement, source: 'workspace default' },
  ], 'prepend');

  return {
    rolePolicyResolution,
    runPreferences: {
      autoSubmit: autoSubmitResolution.value,
      agentTag: agentTagResolution.value,
      preferredChatAgent: preferredChatAgentResolution.value,
      starterPrompt: starterPromptResolution.value,
      starterPromptPlacement: starterPromptPlacementResolution.value,
    },
    sources: {
      autoSubmit: autoSubmitResolution.source,
      agentTag: agentTagResolution.source,
      preferredChatAgent: preferredChatAgentResolution.source,
      starterPrompt: starterPromptResolution.source,
      starterPromptPlacement: starterPromptPlacementResolution.source,
    },
  };
}

export function resolvePhaseRunProfileOverride(
  rawProfiles: unknown,
  workflowId: string,
  phaseId: string,
): PhaseRunProfileOverride | undefined {
  if (!isRecord(rawProfiles)) {
    return undefined;
  }

  const workflowScopedOverride = readPhaseRunProfileOverrideFromScope(rawProfiles[workflowId], phaseId);
  if (workflowScopedOverride) {
    return workflowScopedOverride;
  }

  return parsePhaseRunProfileOverride(rawProfiles[phaseId]);
}

export function parsePhaseRunProfileOverride(rawOverride: unknown): PhaseRunProfileOverride | undefined {
  if (!isRecord(rawOverride)) {
    return undefined;
  }

  const override: PhaseRunProfileOverride = {};
  if (typeof rawOverride.autoSubmit === 'boolean') {
    override.autoSubmit = rawOverride.autoSubmit;
  }

  const agentTag = normalizeNonEmptyString(rawOverride.agentTag);
  if (agentTag) {
    override.agentTag = agentTag;
  }

  const preferredChatAgent = normalizeNonEmptyString(rawOverride.preferredChatAgent);
  if (preferredChatAgent) {
    override.preferredChatAgent = preferredChatAgent;
  }

  const starterPrompt = normalizeNonEmptyString(rawOverride.starterPrompt);
  if (starterPrompt) {
    override.starterPrompt = starterPrompt;
  }

  const starterPromptPlacement = normalizeStarterPromptPlacement(rawOverride.starterPromptPlacement);
  if (starterPromptPlacement) {
    override.starterPromptPlacement = starterPromptPlacement;
  }

  return Object.keys(override).length > 0 ? override : undefined;
}

export function buildPhasePromptSurfaces(
  context: PhasePromptRenderContext,
  runPreferences: PhaseRunPreferences,
): PhasePromptSurfaces {
  return {
    scopedChat: buildScopedChatStarter(context, runPreferences),
    agent: buildCopilotAgentStarter(context, runPreferences),
    cli: buildCopilotCliPrompt(context, runPreferences),
    directModel: buildDirectModelPrompt(context, runPreferences),
  };
}

export function buildScopedChatStarter(
  context: PhasePromptRenderContext,
  runPreferences?: PhaseRunPreferences,
): string {
  return buildPhaseCopilotPrompt([
    context.sessionMarker,
    `Task: continue ${context.phaseName} for ${context.epicKey} by updating ${context.artifactBasename}.`,
    runPreferences?.preferredChatAgent ? `Routing hint: prefer GitHub Copilot Chat agent "${runPreferences.preferredChatAgent}" if available.` : undefined,
    runPreferences?.agentTag ? `Routing tag: ${runPreferences.agentTag}` : undefined,
    'Scope:',
    `- Stay inside the ${context.phaseName} phase only.`,
    `- Keep the conversation bound to ${context.epicKey}. Ignore unrelated prior turns or other APEX_SESSION markers.`,
    '- Update the existing artifact in place when possible.',
    '- If source information is missing, leave explicit open questions instead of inventing facts.',
    'Source of truth:',
    context.epicDisplayPath ? `- ${context.epicDisplayPath}` : undefined,
    `- ${context.artifactDisplayPath}`,
    context.statusDisplayPath ? `- ${context.statusDisplayPath}` : undefined,
    isPbiDeliveryWorkflow(context.workflowId) ? `Workflow note: ${buildPbiPromptGuidance(context)}` : undefined,
  ], runPreferences);
}

export function buildCopilotAgentStarter(
  context: PhasePromptRenderContext,
  runPreferences: PhaseRunPreferences,
): string {
  return buildPhaseCopilotPrompt([
    context.sessionMarker,
    `Task: update attached artifact ${context.artifactBasename} for ${context.epicKey} (${context.epicTitle}).`,
    runPreferences.preferredChatAgent ? `Routing hint: prefer GitHub Copilot Chat agent "${runPreferences.preferredChatAgent}" if available.` : undefined,
    runPreferences.agentTag ? `Routing tag: ${runPreferences.agentTag}` : undefined,
    'Scope:',
    `- Stay inside the ${context.phaseName} phase only.`,
    `- Keep the conversation bound to ${context.epicKey}. Ignore unrelated prior turns or other APEX_SESSION markers.`,
    '- Edit the existing artifact in place instead of creating a side document.',
    '- If source information is missing, leave explicit open questions.',
    isPbiDeliveryWorkflow(context.workflowId) ? `Workflow note: ${buildPbiPromptGuidance(context)}` : undefined,
  ], runPreferences);
}

export function buildCopilotCliPrompt(
  context: PhasePromptRenderContext,
  runPreferences: PhaseRunPreferences,
): string {
  const lines = [
    `Work inside workspace: ${context.workspaceRootDisplayPath ?? '<workspace>'}`,
    '',
    buildScopedChatStarter(context, runPreferences),
    '',
    'Source text:',
    context.referenceText ?? 'Preview source text is not attached in workflow configuration.',
  ];
  return lines.join('\n');
}

export function buildDirectModelPrompt(
  context: PhasePromptRenderContext,
  runPreferences?: PhaseRunPreferences,
): string {
  const lines = buildPromptLinesWithStarterPrompt([
    'You are assisting one APEX delivery phase inside VS Code.',
    'Stay scoped to this phase only. Do not change or speculate about unrelated phases.',
    'Use only the provided source text and phase metadata as your source of truth.',
    'Return markdown with these exact sections:',
    '## Phase Assessment',
    '## Recommended Artifact Updates',
    '## Open Questions',
    '## Next Action',
    '',
    `Epic: ${context.epicKey} - ${context.epicTitle}`,
    `Phase: ${context.phaseName} (${context.phaseId})`,
    `Status: ${context.phaseStatus}`,
    `Expected output: ${context.phaseOutput}`,
    `Primary artifact: ${context.artifactDisplayPath}`,
    isPbiDeliveryWorkflow(context.workflowId) ? `Workflow note: ${buildPbiPromptGuidance(context)}` : undefined,
    '',
    'Source text:',
    context.referenceText ?? 'Preview source text is not attached in workflow configuration.',
  ], runPreferences?.starterPrompt, runPreferences?.starterPromptPlacement);

  return lines.filter((line): line is string => typeof line === 'string').join('\n');
}

export function buildPromptLinesWithStarterPrompt(
  lines: readonly (string | undefined)[],
  starterPrompt: string | undefined,
  placement: StarterPromptPlacement | undefined,
): readonly (string | undefined)[] {
  const starterPromptPrefix = buildStarterPromptPrefix(starterPrompt);
  if (!starterPromptPrefix) {
    return lines;
  }

  const resolvedPlacement = placement ?? 'prepend';
  if (resolvedPlacement === 'replace') {
    const firstInstruction = lines.find((line): line is string => typeof line === 'string' && line.length > 0);
    if (firstInstruction?.startsWith('APEX_SESSION=')) {
      return [
        firstInstruction,
        '',
        starterPromptPrefix,
      ];
    }
    return [starterPromptPrefix];
  }
  if (resolvedPlacement === 'append') {
    return [
      ...lines,
      '',
      'Starter prompt:',
      starterPromptPrefix,
    ];
  }

  return [
    starterPromptPrefix,
    '',
    ...lines,
  ];
}

function buildPhaseCopilotPrompt(
  lines: readonly (string | undefined)[],
  runPreferences?: Pick<PhaseRunPreferences, 'starterPrompt' | 'starterPromptPlacement'>,
): string {
  return buildPromptLinesWithStarterPrompt(lines, runPreferences?.starterPrompt, runPreferences?.starterPromptPlacement)
    .filter((line): line is string => typeof line === 'string' && line.length > 0)
    .join('\n');
}

function buildStarterPromptPrefix(starterPrompt: string | undefined): string | undefined {
  const normalizedPrompt = starterPrompt?.trim();
  if (!normalizedPrompt) {
    return undefined;
  }

  return normalizedPrompt;
}

function buildPbiPromptGuidance(context: Pick<PhasePromptRenderContext, 'branchNames' | 'pullRequestCount'>): string {
  const linkedBranches = context.branchNames?.join(', ') || 'none';
  const pullRequestCount = context.pullRequestCount ?? 0;
  return `keep requirements, design, tests, and review evidence traceable. Linked branches: ${linkedBranches}. Linked PRs: ${pullRequestCount}.`;
}

function isPbiDeliveryWorkflow(workflowId: string): boolean {
  return workflowId === PBI_DELIVERY_WORKFLOW_ID;
}

function readPhaseRunProfileOverrideFromScope(scope: unknown, phaseId: string): PhaseRunProfileOverride | undefined {
  if (!isRecord(scope)) {
    return undefined;
  }

  return parsePhaseRunProfileOverride(scope[phaseId]);
}

function resolveBooleanPreference(
  candidates: readonly { value: boolean | undefined; source: string }[],
  fallbackValue: boolean,
): { value: boolean; source: string } {
  for (const candidate of candidates) {
    if (typeof candidate.value === 'boolean') {
      return { value: candidate.value, source: candidate.source };
    }
  }

  return { value: fallbackValue, source: 'hardcoded fallback' };
}

function resolveStringPreference(
  candidates: readonly { value: string | undefined; source: string }[],
): { value: string | undefined; source: string } {
  for (const candidate of candidates) {
    const normalizedValue = normalizeNonEmptyString(candidate.value);
    if (normalizedValue) {
      return { value: normalizedValue, source: candidate.source };
    }
  }

  return { value: undefined, source: 'not configured' };
}

function resolvePlacementPreference(
  candidates: readonly { value: StarterPromptPlacement | undefined; source: string }[],
  fallbackValue: StarterPromptPlacement,
): { value: StarterPromptPlacement; source: string } {
  for (const candidate of candidates) {
    if (candidate.value) {
      return { value: candidate.value, source: candidate.source };
    }
  }

  return { value: fallbackValue, source: 'hardcoded fallback' };
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
