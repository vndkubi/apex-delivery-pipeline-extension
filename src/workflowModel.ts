import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PHASES, type PhaseAutopilotPolicy, type PhaseDefinition } from './pipelineModel';

export const DEFAULT_WORKFLOW_ID = 'default';
export const EPIC_WORKFLOW_METADATA_FILE = '.apex-workflow.json';

export interface WorkflowDefinition {
  id: string;
  name: string;
  phases: readonly PhaseDefinition[];
  source: 'built-in' | 'workspace' | 'snapshot';
}

export interface WorkflowDefinitionsResult {
  workflows: readonly WorkflowDefinition[];
  errors: readonly string[];
}

interface EpicWorkflowMetadata {
  workflowId: string;
  workflowName: string;
  phases: readonly PhaseDefinition[];
  createdAt: string;
}

export function getDefaultWorkflowDefinition(): WorkflowDefinition {
  return {
    id: DEFAULT_WORKFLOW_ID,
    name: 'Default Delivery',
    phases: DEFAULT_PHASES,
    source: 'built-in',
  };
}

export function parseWorkflowDefinitions(raw: unknown): WorkflowDefinitionsResult {
  const workflows: WorkflowDefinition[] = [getDefaultWorkflowDefinition()];
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return { workflows, errors };
  }

  for (const [workflowId, value] of Object.entries(raw)) {
    const parsed = parseWorkflowDefinition(workflowId, value);
    if ('error' in parsed) {
      errors.push(parsed.error);
      continue;
    }
    workflows.push(parsed.workflow);
  }

  return { workflows, errors };
}

function parseWorkflowDefinition(
  workflowId: string,
  value: unknown,
): { workflow: WorkflowDefinition } | { error: string } {
  if (workflowId === DEFAULT_WORKFLOW_ID) {
    return { error: `Workflow id "${DEFAULT_WORKFLOW_ID}" is reserved for the built-in default workflow.` };
  }

  if (!isRecord(value)) {
    return { error: `Workflow "${workflowId}" must be an object.` };
  }

  const rawName = typeof value.name === 'string' ? value.name.trim() : '';
  if (rawName.length === 0) {
    return { error: `Workflow "${workflowId}" must include a non-empty name.` };
  }

  if (!Array.isArray(value.phases) || value.phases.length === 0) {
    return { error: `Workflow "${workflowId}" must include a non-empty phases array.` };
  }

  const phases: PhaseDefinition[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawPhase] of value.phases.entries()) {
    const parsedPhase = parsePhaseDefinition(workflowId, index, rawPhase);
    if ('error' in parsedPhase) {
      return parsedPhase;
    }

    if (seenIds.has(parsedPhase.phase.id)) {
      return { error: `Workflow "${workflowId}" contains duplicate phase id "${parsedPhase.phase.id}".` };
    }

    seenIds.add(parsedPhase.phase.id);
    phases.push(parsedPhase.phase);
  }

  return {
    workflow: {
      id: workflowId,
      name: rawName,
      phases,
      source: 'workspace',
    },
  };
}

function parsePhaseDefinition(
  workflowId: string,
  index: number,
  rawPhase: unknown,
): { phase: PhaseDefinition } | { error: string } {
  if (!isRecord(rawPhase)) {
    return { error: `Workflow "${workflowId}" phase #${index + 1} must be an object.` };
  }

  const id = typeof rawPhase.id === 'string' ? rawPhase.id.trim() : '';
  const name = typeof rawPhase.name === 'string' ? rawPhase.name.trim() : '';
  const owner = typeof rawPhase.owner === 'string' ? rawPhase.owner.trim() : '';
  const artifact = typeof rawPhase.artifact === 'string' ? rawPhase.artifact.trim() : '';
  const gate = typeof rawPhase.gate === 'string' ? rawPhase.gate.trim() : '';
  const output = typeof rawPhase.output === 'string' ? rawPhase.output.trim() : '';

  if (id.length === 0 || name.length === 0 || owner.length === 0 || artifact.length === 0 || gate.length === 0 || output.length === 0) {
    return { error: `Workflow "${workflowId}" phase #${index + 1} must include id, name, owner, artifact, gate, and output.` };
  }

  if (gate !== 'Gate 1' && gate !== 'Gate 2' && gate !== 'Gate 3') {
    return { error: `Workflow "${workflowId}" phase "${id}" must use gate "Gate 1", "Gate 2", or "Gate 3".` };
  }

  return {
    phase: {
      id,
      name,
      owner,
      artifact,
      gate,
      output,
      autopilot: parseAutopilotPolicy(rawPhase.autopilot),
    },
  };
}

function parseAutopilotPolicy(rawPolicy: unknown): PhaseAutopilotPolicy | undefined {
  if (!isRecord(rawPolicy)) {
    return undefined;
  }

  const policy: PhaseAutopilotPolicy = {};
  if (typeof rawPolicy.enabled === 'boolean') {
    policy.enabled = rawPolicy.enabled;
  }

  if (typeof rawPolicy.retryLimit === 'number' && Number.isFinite(rawPolicy.retryLimit) && rawPolicy.retryLimit >= 0) {
    policy.retryLimit = Math.floor(rawPolicy.retryLimit);
  }

  if (typeof rawPolicy.pauseOnManualIntervention === 'boolean') {
    policy.pauseOnManualIntervention = rawPolicy.pauseOnManualIntervention;
  }

  return Object.keys(policy).length > 0 ? policy : undefined;
}

export function workflowMetadataPath(epicFolderPath: string): string {
  return path.join(epicFolderPath, EPIC_WORKFLOW_METADATA_FILE);
}

export function writeWorkflowMetadata(epicFolderPath: string, workflow: WorkflowDefinition): void {
  const metadata: EpicWorkflowMetadata = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    phases: workflow.phases,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(workflowMetadataPath(epicFolderPath), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
}

export function readWorkflowMetadata(epicFolderPath: string): { workflow?: WorkflowDefinition; error?: string } {
  const metadataPath = workflowMetadataPath(epicFolderPath);
  if (!fs.existsSync(metadataPath)) {
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as unknown;
    if (!isRecord(raw)) {
      return { error: `Workflow metadata at ${metadataPath} must be an object.` };
    }

    const workflowId = typeof raw.workflowId === 'string' ? raw.workflowId.trim() : '';
    const workflowName = typeof raw.workflowName === 'string' ? raw.workflowName.trim() : '';
    if (workflowId.length === 0 || workflowName.length === 0) {
      return { error: `Workflow metadata at ${metadataPath} must include workflowId and workflowName.` };
    }

    const parsed = parseWorkflowDefinition(workflowId, {
      name: workflowName,
      phases: raw.phases,
    });
    if ('error' in parsed) {
      return { error: parsed.error };
    }

    return {
      workflow: {
        ...parsed.workflow,
        source: 'snapshot',
      },
    };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}