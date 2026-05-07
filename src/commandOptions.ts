export type GuidedAutopilotExecutionMode = 'agent-pause' | 'fully-automatic';

export interface PhaseCommandOptions {
  nonInteractive: boolean;
  forceChatFallback: boolean;
  autopilotExecutionMode: GuidedAutopilotExecutionMode;
}

export interface CreateSampleEpicCommandOptions {
  nonInteractive: boolean;
  workflowId?: string;
}

export interface LinkBranchToEpicCommandOptions {
  nonInteractive: boolean;
  branchName?: string;
}

export interface BindBranchToEpicCommandOptions {
  nonInteractive: boolean;
  branchName?: string;
  useCurrentBranch: boolean;
  openPinnedWorkspace: boolean;
}

export interface OpenLinkedBranchWorktreeCommandOptions {
  nonInteractive: boolean;
  branchName?: string;
  openInNewWindow?: boolean;
}

export interface ReviewPullRequestCommandOptions {
  nonInteractive: boolean;
  prInput?: string;
  prNumber?: number;
  prUrl?: string;
  prTitle?: string;
  baseBranch?: string;
  headBranch?: string;
  author?: string;
  provider?: string;
  linkedEpicKey?: string;
  openArtifact?: boolean;
}

export interface NormalizedPullRequestInput {
  number?: number;
  url?: string;
  provider?: string;
}

export interface IntegratedFlowCommandOptions {
  nonInteractive: boolean;
  openSpec: boolean;
  title?: string;
  source?: string;
}

export function getPhaseCommandOptions(
  value: unknown,
  defaultAutopilotExecutionMode: GuidedAutopilotExecutionMode,
): PhaseCommandOptions {
  if (isRecord(value) && 'nonInteractive' in value) {
    return {
      nonInteractive: value.nonInteractive === true,
      forceChatFallback: value.forceChatFallback === true,
      autopilotExecutionMode: parseGuidedAutopilotExecutionMode(value.autopilotExecutionMode)
        ?? defaultAutopilotExecutionMode,
    };
  }

  return {
    nonInteractive: false,
    forceChatFallback: false,
    autopilotExecutionMode: defaultAutopilotExecutionMode,
  };
}

export function parseGuidedAutopilotExecutionMode(value: unknown): GuidedAutopilotExecutionMode | undefined {
  return value === 'fully-automatic' || value === 'agent-pause'
    ? value
    : undefined;
}

export function getIntegratedFlowCommandOptions(value: unknown): IntegratedFlowCommandOptions {
  if (isRecord(value)) {
    return {
      nonInteractive: value.nonInteractive === true,
      openSpec: value.openSpec === true,
      title: typeof value.title === 'string' ? value.title : undefined,
      source: typeof value.source === 'string' ? value.source : undefined,
    };
  }

  return {
    nonInteractive: false,
    openSpec: false,
  };
}

export function getCreateSampleEpicCommandOptions(value: unknown): CreateSampleEpicCommandOptions {
  if (isRecord(value)) {
    return {
      nonInteractive: value.nonInteractive === true,
      workflowId: typeof value.workflowId === 'string' ? value.workflowId : undefined,
    };
  }

  return {
    nonInteractive: false,
  };
}

export function getLinkBranchToEpicCommandOptions(value: unknown): LinkBranchToEpicCommandOptions {
  if (!isRecord(value) || (!('nonInteractive' in value) && !('branchName' in value))) {
    return {
      nonInteractive: false,
    };
  }

  return {
    nonInteractive: value.nonInteractive === true,
    branchName: typeof value.branchName === 'string' ? value.branchName : undefined,
  };
}

export function getBindBranchToEpicCommandOptions(value: unknown): BindBranchToEpicCommandOptions {
  if (!isRecord(value)) {
    return {
      nonInteractive: false,
      useCurrentBranch: false,
      openPinnedWorkspace: false,
    };
  }

  return {
    nonInteractive: value.nonInteractive === true,
    branchName: typeof value.branchName === 'string' ? value.branchName : undefined,
    useCurrentBranch: value.useCurrentBranch === true,
    openPinnedWorkspace: value.openPinnedWorkspace === true,
  };
}

export function getOpenLinkedBranchWorktreeCommandOptions(value: unknown): OpenLinkedBranchWorktreeCommandOptions {
  if (!isRecord(value) || (!('nonInteractive' in value) && !('branchName' in value) && !('openInNewWindow' in value))) {
    return {
      nonInteractive: false,
      openInNewWindow: true,
    };
  }

  return {
    nonInteractive: value.nonInteractive === true,
    branchName: typeof value.branchName === 'string' ? value.branchName : undefined,
    openInNewWindow: typeof value.openInNewWindow === 'boolean' ? value.openInNewWindow : true,
  };
}

export function getReviewPullRequestCommandOptions(value: unknown): ReviewPullRequestCommandOptions {
  if (!isRecord(value)) {
    return {
      nonInteractive: false,
      openArtifact: true,
    };
  }

  if (!('nonInteractive' in value)
    && !('prInput' in value)
    && !('prNumber' in value)
    && !('prUrl' in value)
    && !('baseBranch' in value)
    && !('headBranch' in value)
    && !('linkedEpicKey' in value)
    && !('openArtifact' in value)
  ) {
    return {
      nonInteractive: false,
      openArtifact: true,
    };
  }

  return {
    nonInteractive: value.nonInteractive === true,
    prInput: typeof value.prInput === 'string' ? value.prInput : undefined,
    prNumber: typeof value.prNumber === 'number' ? Math.trunc(value.prNumber) : undefined,
    prUrl: typeof value.prUrl === 'string' ? value.prUrl : undefined,
    prTitle: typeof value.prTitle === 'string' ? value.prTitle : undefined,
    baseBranch: typeof value.baseBranch === 'string' ? value.baseBranch : undefined,
    headBranch: typeof value.headBranch === 'string' ? value.headBranch : undefined,
    author: typeof value.author === 'string' ? value.author : undefined,
    provider: typeof value.provider === 'string' ? value.provider : undefined,
    linkedEpicKey: typeof value.linkedEpicKey === 'string' ? value.linkedEpicKey : undefined,
    openArtifact: typeof value.openArtifact === 'boolean' ? value.openArtifact : true,
  };
}

export function normalizePullRequestInput(
  options: ReviewPullRequestCommandOptions,
): NormalizedPullRequestInput | undefined {
  if (options.prNumber !== undefined) {
    return {
      number: options.prNumber,
      url: options.prUrl,
      provider: options.provider,
    };
  }

  const raw = options.prUrl ?? options.prInput;
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  if (/^\d+$/.test(normalized)) {
    return {
      number: Number.parseInt(normalized, 10),
      url: options.prUrl,
      provider: options.provider,
    };
  }

  const githubMatch = normalized.match(/\/pull\/(\d+)(?:\/)?$/i);
  return {
    number: githubMatch ? Number.parseInt(githubMatch[1] ?? '0', 10) : undefined,
    url: normalized,
    provider: options.provider ?? (githubMatch ? 'github' : undefined),
  };
}

export function buildPullRequestFolderName(prNumber: number | undefined, prUrl: string | undefined): string {
  if (prNumber !== undefined) {
    return `PR-${prNumber}`;
  }
  return `PR-${sanitizePathSegment(prUrl ?? 'review')}`;
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'review';
}

export function formatPullRequestDisplay(prNumber: number | undefined, prUrl: string | undefined): string {
  if (prNumber !== undefined) {
    return `#${prNumber}`;
  }
  return prUrl ?? 'PR review';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
