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

export type PhaseId =
  | 'discover'
  | 'specify'
  | 'design'
  | 'implement'
  | 'review'
  | 'test'
  | 'release'
  | 'learn';

export interface PhaseDefinition {
  id: PhaseId;
  name: string;
  owner: string;
  artifact: string;
  gate: 'Gate 1' | 'Gate 2' | 'Gate 3';
  output: string;
}

export interface PhaseStatus {
  id: PhaseId;
  name: string;
  owner: string;
  artifact: string;
  artifactPath: string;
  statusPath: string;
  status: PhaseStatusValue;
  gate: PhaseDefinition['gate'];
  output: string;
  updatedAt?: string;
  notes?: string;
}

export interface EpicStatus {
  key: string;
  title: string;
  folderPath: string;
  phases: PhaseStatus[];
  currentPhaseIndex: number;
  progress: number;
  hasBlocked: boolean;
  hasAwaitingReview: boolean;
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
