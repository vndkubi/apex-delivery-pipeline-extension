import type { CoordinationBranchBinding, CoordinationPullRequestBinding } from './coordinationModel';

export const PHASE_STATUS_VALUES = [
  'pending',
  'in_progress',
  'awaiting_review',
  'passed',
  'rejected',
  'stale',
  'blocked',
  'done',
] as const;

export type PhaseStatusValue = typeof PHASE_STATUS_VALUES[number];

export type PhaseId = string;

export interface PhaseAutopilotPolicy {
  enabled?: boolean;
  retryLimit?: number;
  pauseOnManualIntervention?: boolean;
}

export const STARTER_PROMPT_PLACEMENTS = [
  'prepend',
  'append',
  'replace',
] as const;

export type StarterPromptPlacement = typeof STARTER_PROMPT_PLACEMENTS[number];

export interface PhaseSessionDefaults {
  autoSubmit?: boolean;
  agentTag?: string;
  modelFamily?: string;
  preferredChatAgent?: string;
  starterPrompt?: string;
  starterPromptRef?: string;
  starterPromptPlacement?: StarterPromptPlacement;
}

export const WORKFLOW_EXECUTION_MODES = [
  'control',
  'pooled',
  'pinned',
] as const;

export type WorkflowExecutionMode = typeof WORKFLOW_EXECUTION_MODES[number];

export interface WorkflowExecutionCommands {
  runPhase?: WorkflowExecutionMode;
  reviewPullRequest?: WorkflowExecutionMode;
  openWorkspace?: WorkflowExecutionMode;
}

export interface WorkflowExecutionPolicy {
  mode?: WorkflowExecutionMode;
  commands?: WorkflowExecutionCommands;
}

export interface PhaseDefinition {
  id: PhaseId;
  name: string;
  owner: string;
  artifact: string;
  enabled?: boolean;
  templateRef?: string;
  outputRef?: string;
  gate: 'Gate 1' | 'Gate 2' | 'Gate 3';
  output: string;
  autopilot?: PhaseAutopilotPolicy;
  sessionDefaults?: PhaseSessionDefaults;
}

export interface PhaseStatus {
  id: PhaseId;
  name: string;
  owner: string;
  artifact: string;
  enabled?: boolean;
  templateRef?: string;
  outputRef?: string;
  artifactPath: string;
  statusPath: string;
  status: PhaseStatusValue;
  gate: PhaseDefinition['gate'];
  output: string;
  autopilot?: PhaseAutopilotPolicy;
  sessionDefaults?: PhaseSessionDefaults;
  updatedAt?: string;
  notes?: string;
}

export interface EpicStatus {
  key: string;
  title: string;
  folderPath: string;
  workflowId: string;
  workflowName: string;
  execution?: WorkflowExecutionPolicy;
  phases: PhaseStatus[];
  currentPhaseIndex: number;
  progress: number;
  hasBlocked: boolean;
  hasAwaitingReview: boolean;
  coordination?: EpicCoordinationStatus;
}

export interface EpicCoordinationStatus {
  metadataPath: string;
  error?: string;
  mode?: string;
  baseBranch?: string;
  team?: string;
  owner?: string;
  priority?: string;
  coordinationStatus?: string;
  branches: CoordinationBranchBinding[];
  pullRequests: CoordinationPullRequestBinding[];
}

export const DEFAULT_PHASES: readonly PhaseDefinition[] = [
  {
    id: 'discover',
    name: 'Discover',
    owner: 'Product / Business',
    artifact: 'DISCOVERY.md',
    gate: 'Gate 3',
    output: 'Business problem, baseline, opportunity, ROI hypothesis',
  },
  {
    id: 'specify',
    name: 'Specify',
    owner: 'Product Owner',
    artifact: 'SPEC.md',
    gate: 'Gate 1',
    output: 'Goal, constraints, acceptance criteria, open questions',
  },
  {
    id: 'design',
    name: 'Design',
    owner: 'Tech Lead',
    artifact: 'DESIGN.md',
    gate: 'Gate 2',
    output: 'Architecture, data model, command flow, risks, verification',
  },
  {
    id: 'implement',
    name: 'Implement',
    owner: 'Developer',
    artifact: 'IMPLEMENTATION.md',
    gate: 'Gate 2',
    output: 'Files changed, AC mapping, implementation notes, evidence',
  },
  {
    id: 'review',
    name: 'Review',
    owner: 'Reviewer',
    artifact: 'REVIEW.md',
    gate: 'Gate 2',
    output: 'Findings, residual risk, verdict',
  },
  {
    id: 'test',
    name: 'Test',
    owner: 'QA',
    artifact: 'TEST-PLAN.md',
    gate: 'Gate 2',
    output: 'Functional, edge, and manual validation scenarios',
  },
  {
    id: 'release',
    name: 'Release',
    owner: 'Release Manager',
    artifact: 'RELEASE.md',
    gate: 'Gate 3',
    output: 'Readiness checklist, limitations, rollback plan',
  },
  {
    id: 'learn',
    name: 'Learn',
    owner: 'APEX Owner',
    artifact: 'LEARNINGS.md',
    gate: 'Gate 3',
    output: 'Experiment result, ROI metrics, adoption decision',
  },
];

export function isPhaseStatusValue(value: unknown): value is PhaseStatusValue {
  return typeof value === 'string' && (PHASE_STATUS_VALUES as readonly string[]).includes(value);
}

export function isWorkflowExecutionMode(value: unknown): value is WorkflowExecutionMode {
  return typeof value === 'string' && (WORKFLOW_EXECUTION_MODES as readonly string[]).includes(value);
}

export function isStarterPromptPlacement(value: unknown): value is StarterPromptPlacement {
  return typeof value === 'string' && (STARTER_PROMPT_PLACEMENTS as readonly string[]).includes(value);
}

export function isCompletedStatus(status: PhaseStatusValue): boolean {
  return status === 'passed' || status === 'done';
}

export function phaseDefinitionById(phaseId: PhaseId): PhaseDefinition {
  const found = DEFAULT_PHASES.find((phase) => phase.id === phaseId);
  if (!found) {
    throw new Error(`Unknown phase: ${phaseId}`);
  }
  return found;
}

export function resolvePhaseTemplateRef(phase: Pick<PhaseDefinition, 'artifact' | 'templateRef'>): string {
  return phase.templateRef?.trim() || phase.artifact;
}
