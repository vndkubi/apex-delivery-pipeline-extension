import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PHASES,
  type PhaseAutopilotPolicy,
  type PhaseDefinition,
  type PhaseSessionDefaults,
  isStarterPromptPlacement,
  isWorkflowExecutionMode,
  type WorkflowExecutionPolicy,
} from './pipelineModel';
import { validateTemplateRef } from './templateRef';
import { readWorkspaceTextRef, validateWorkspaceTextRef } from './workspaceTextRef';

export const DEFAULT_WORKFLOW_ID = 'default';
export const PBI_DELIVERY_WORKFLOW_ID = 'pbi-delivery';
export const EPIC_WORKFLOW_METADATA_FILE = '.apex-workflow.json';

export interface WorkflowDefinition {
  id: string;
  name: string;
  execution?: WorkflowExecutionPolicy;
  phases: readonly PhaseDefinition[];
  source: 'built-in' | 'workspace' | 'snapshot';
}

export interface WorkflowDefinitionsResult {
  workflows: readonly WorkflowDefinition[];
  errors: readonly string[];
}

export interface WorkflowParseOptions {
  workspaceRoot?: string;
}

interface EpicWorkflowMetadata {
  workflowId: string;
  workflowName: string;
  execution?: WorkflowExecutionPolicy;
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

export function getPbiDeliveryWorkflowDefinition(): WorkflowDefinition {
  return {
    id: PBI_DELIVERY_WORKFLOW_ID,
    name: 'PBI Delivery',
    execution: {
      mode: 'pinned',
      commands: {
        runPhase: 'pinned',
        reviewPullRequest: 'pinned',
        openWorkspace: 'pinned',
      },
    },
    phases: [
      {
        id: 'intake',
        name: 'Intake',
        owner: 'BA',
        artifact: 'PBI.md',
        gate: 'Gate 1',
        output: 'Problem statement, acceptance criteria, unknowns, source links, and intake triage.',
        sessionDefaults: {
          preferredChatAgent: 'Business Analyst',
          starterPrompt: 'Normalize the request into goal, constraints, acceptance criteria, unknowns, dependencies, and readiness questions before implementation.',
        },
      },
      {
        id: 'investigation',
        name: 'Investigation',
        owner: 'BA',
        artifact: 'INVESTIGATION.md',
        gate: 'Gate 1',
        output: 'Relevant codebase flows, dependencies, risks, exception paths, and affected modules.',
        sessionDefaults: {
          preferredChatAgent: 'Business Analyst',
          starterPrompt: 'Trace the current behavior from entry point to side effects, then call out gaps, assumptions, and investigation risks explicitly.',
        },
      },
      {
        id: 'code-flow',
        name: 'Code Flow',
        owner: 'Tech Lead',
        artifact: 'CODE-FLOW.md',
        gate: 'Gate 2',
        output: 'Entry points, control flow, integrations, exception handlers, and test coverage notes.',
        sessionDefaults: {
          preferredChatAgent: 'Tech Lead',
          starterPrompt: 'Explain the concrete request or execution flow, including data movement, exception handling, retries, and existing test touchpoints.',
        },
      },
      {
        id: 'design-decision',
        name: 'Design Decision',
        owner: 'Tech Lead',
        artifact: 'DESIGN-DECISION.md',
        gate: 'Gate 2',
        output: 'Selected design, rejected options, risks, migration impact, and rollback plan.',
        sessionDefaults: {
          preferredChatAgent: 'Tech Lead',
          starterPrompt: 'Compare viable implementation options, choose one, and record why it is the right tradeoff for this PBI.',
        },
      },
      {
        id: 'test-decision',
        name: 'Test Decision',
        owner: 'QA',
        artifact: 'TEST-DECISION.md',
        gate: 'Gate 2',
        output: 'Chosen test levels, edge cases, exception coverage, and evidence expectations.',
        sessionDefaults: {
          preferredChatAgent: 'QA',
          starterPrompt: 'Decide the narrowest tests that prove the change, capture edge cases, and explain what will not be tested and why.',
        },
      },
      {
        id: 'tdd-implementation',
        name: 'TDD Implementation',
        owner: 'Developer',
        artifact: 'TDD-PLAN.md',
        gate: 'Gate 2',
        output: 'Slice plan, red-green-refactor evidence, changed files, and implementation notes.',
        sessionDefaults: {
          preferredChatAgent: 'Developer',
          starterPrompt: 'Execute the implementation as small TDD slices and keep red, green, refactor, and evidence clearly separated.',
        },
      },
      {
        id: 'pbi-review',
        name: 'PBI Review',
        owner: 'Reviewer',
        artifact: 'PBI-REVIEW.md',
        gate: 'Gate 2',
        output: 'PBI-aware review findings, requirement coverage, design drift, and residual risk.',
        sessionDefaults: {
          preferredChatAgent: 'Code Reviewer',
          starterPrompt: 'Review the change against the PBI intent, acceptance criteria, design decision, and test decision instead of diff-only review.',
        },
      },
      {
        id: 'evidence-ready',
        name: 'Evidence Ready',
        owner: 'Release Manager',
        artifact: 'EVIDENCE.md',
        gate: 'Gate 3',
        output: 'Evidence pack, commands run, review readiness, rollout notes, and unresolved gaps.',
        sessionDefaults: {
          preferredChatAgent: 'Release Manager',
          starterPrompt: 'Package the final evidence for handoff: requirements, implementation, validation, review, residual risks, and release notes.',
        },
      },
    ],
    source: 'built-in',
  };
}

export function getBuiltInWorkflowDefinitions(): readonly WorkflowDefinition[] {
  return [
    getDefaultWorkflowDefinition(),
    getPbiDeliveryWorkflowDefinition(),
  ];
}

export function parseWorkflowDefinitions(raw: unknown, options: WorkflowParseOptions = {}): WorkflowDefinitionsResult {
  const workflows: WorkflowDefinition[] = [...getBuiltInWorkflowDefinitions()];
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return { workflows, errors };
  }

  for (const [workflowId, value] of Object.entries(raw)) {
    const parsed = parseWorkflowDefinition(workflowId, value, options);
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
  options: WorkflowParseOptions = {},
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

  const parsedExecution = parseWorkflowExecutionPolicy(workflowId, value.execution);
  if ('error' in parsedExecution) {
    return parsedExecution;
  }

  if (!Array.isArray(value.phases) || value.phases.length === 0) {
    return { error: `Workflow "${workflowId}" must include a non-empty phases array.` };
  }

  const phases: PhaseDefinition[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawPhase] of value.phases.entries()) {
    const parsedPhase = parsePhaseDefinition(workflowId, index, rawPhase, options);
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
      execution: parsedExecution.execution,
      phases,
      source: 'workspace',
    },
  };
}

function parseWorkflowExecutionPolicy(
  workflowId: string,
  rawExecution: unknown,
): { execution?: WorkflowExecutionPolicy } | { error: string } {
  if (rawExecution === undefined) {
    return {};
  }

  if (!isRecord(rawExecution)) {
    return { error: `Workflow "${workflowId}" execution must be an object.` };
  }

  const execution: WorkflowExecutionPolicy = {};
  if (rawExecution.mode !== undefined) {
    if (!isWorkflowExecutionMode(rawExecution.mode)) {
      return { error: `Workflow "${workflowId}" execution.mode must be one of control, pooled, or pinned.` };
    }
    execution.mode = rawExecution.mode;
  }

  if (rawExecution.commands !== undefined) {
    if (!isRecord(rawExecution.commands)) {
      return { error: `Workflow "${workflowId}" execution.commands must be an object.` };
    }

    const commands: NonNullable<WorkflowExecutionPolicy['commands']> = {};
    for (const fieldName of ['runPhase', 'reviewPullRequest', 'openWorkspace'] as const) {
      const value = rawExecution.commands[fieldName];
      if (value === undefined) {
        continue;
      }
      if (!isWorkflowExecutionMode(value)) {
        return { error: `Workflow "${workflowId}" execution.commands.${fieldName} must be one of control, pooled, or pinned.` };
      }
      commands[fieldName] = value;
    }

    if (Object.keys(commands).length > 0) {
      execution.commands = commands;
    }
  }

  return Object.keys(execution).length > 0 ? { execution } : { execution: {} };
}

function parsePhaseDefinition(
  workflowId: string,
  index: number,
  rawPhase: unknown,
  options: WorkflowParseOptions,
): { phase: PhaseDefinition } | { error: string } {
  if (!isRecord(rawPhase)) {
    return { error: `Workflow "${workflowId}" phase #${index + 1} must be an object.` };
  }

  const id = typeof rawPhase.id === 'string' ? rawPhase.id.trim() : '';
  const name = typeof rawPhase.name === 'string' ? rawPhase.name.trim() : '';
  const owner = typeof rawPhase.owner === 'string' ? rawPhase.owner.trim() : '';
  const artifact = typeof rawPhase.artifact === 'string' ? rawPhase.artifact.trim() : '';
  const gate = typeof rawPhase.gate === 'string' ? rawPhase.gate.trim() : '';
  const output = typeof rawPhase.output === 'string' ? rawPhase.output : '';
  if (rawPhase.enabled !== undefined && typeof rawPhase.enabled !== 'boolean') {
    return { error: `Workflow "${workflowId}" phase "${id || `phase-${index + 1}`}" enabled must be a boolean when provided.` };
  }
  const enabled = rawPhase.enabled === undefined ? true : rawPhase.enabled === true;

  const parsedOutputRef = parseWorkspaceTextRefField(workflowId, id || `phase-${index + 1}`, 'outputRef', rawPhase.outputRef);
  if ('error' in parsedOutputRef) {
    return parsedOutputRef;
  }

  if (id.length === 0 || name.length === 0 || owner.length === 0 || artifact.length === 0 || gate.length === 0) {
    return { error: `Workflow "${workflowId}" phase #${index + 1} must include id, name, owner, artifact, and gate.` };
  }

  if (output.trim().length === 0 && !parsedOutputRef.value) {
    return { error: `Workflow "${workflowId}" phase "${id}" must include output text or outputRef.` };
  }

  if (gate !== 'Gate 1' && gate !== 'Gate 2' && gate !== 'Gate 3') {
    return { error: `Workflow "${workflowId}" phase "${id}" must use gate "Gate 1", "Gate 2", or "Gate 3".` };
  }

  const parsedTemplateRef = parsePhaseTemplateRef(workflowId, id, rawPhase.templateRef);
  if ('error' in parsedTemplateRef) {
    return parsedTemplateRef;
  }

  const parsedSessionDefaults = parsePhaseSessionDefaults(workflowId, id, rawPhase.sessionDefaults, options);
  if ('error' in parsedSessionDefaults) {
    return parsedSessionDefaults;
  }

  const resolvedOutput = resolveWorkflowTextValue(options.workspaceRoot, parsedOutputRef.value, output);

  return {
    phase: {
      id,
      name,
      owner,
      artifact,
      ...(enabled ? {} : { enabled: false }),
      templateRef: parsedTemplateRef.templateRef,
      outputRef: parsedOutputRef.value,
      gate,
      output: resolvedOutput,
      autopilot: parseAutopilotPolicy(rawPhase.autopilot),
      sessionDefaults: parsedSessionDefaults.sessionDefaults,
    },
  };
}

function parsePhaseTemplateRef(
  workflowId: string,
  phaseId: string,
  rawTemplateRef: unknown,
): { templateRef?: string } | { error: string } {
  if (rawTemplateRef === undefined) {
    return {};
  }

  if (typeof rawTemplateRef !== 'string') {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" templateRef must be a string.` };
  }

  const validation = validateTemplateRef(rawTemplateRef);
  if (!validation.normalized) {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" templateRef ${validation.error ?? 'is invalid.'}` };
  }

  return { templateRef: validation.normalized };
}

function parsePhaseSessionDefaults(
  workflowId: string,
  phaseId: string,
  rawDefaults: unknown,
  options: WorkflowParseOptions,
): { sessionDefaults?: PhaseSessionDefaults } | { error: string } {
  if (rawDefaults === undefined) {
    return {};
  }

  if (!isRecord(rawDefaults)) {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" sessionDefaults must be an object.` };
  }

  const sessionDefaults: PhaseSessionDefaults = {};

  if (rawDefaults.autoSubmit !== undefined) {
    if (typeof rawDefaults.autoSubmit !== 'boolean') {
      return { error: `Workflow "${workflowId}" phase "${phaseId}" sessionDefaults.autoSubmit must be a boolean.` };
    }
    sessionDefaults.autoSubmit = rawDefaults.autoSubmit;
  }

  const agentTag = parseRequiredWorkflowStringField(
    workflowId,
    phaseId,
    'sessionDefaults.agentTag',
    rawDefaults.agentTag,
  );
  if ('error' in agentTag) {
    return agentTag;
  }
  if (agentTag.value) {
    sessionDefaults.agentTag = agentTag.value;
  }

  const modelFamily = parseRequiredWorkflowStringField(
    workflowId,
    phaseId,
    'sessionDefaults.modelFamily',
    rawDefaults.modelFamily,
  );
  if ('error' in modelFamily) {
    return modelFamily;
  }
  if (modelFamily.value) {
    sessionDefaults.modelFamily = modelFamily.value;
  }

  const preferredChatAgent = parseRequiredWorkflowStringField(
    workflowId,
    phaseId,
    'sessionDefaults.preferredChatAgent',
    rawDefaults.preferredChatAgent,
  );
  if ('error' in preferredChatAgent) {
    return preferredChatAgent;
  }
  if (preferredChatAgent.value) {
    sessionDefaults.preferredChatAgent = preferredChatAgent.value;
  }

  const starterPrompt = parseRequiredWorkflowStringField(
    workflowId,
    phaseId,
    'sessionDefaults.starterPrompt',
    rawDefaults.starterPrompt,
  );
  if ('error' in starterPrompt) {
    return starterPrompt;
  }

  const starterPromptRef = parseWorkspaceTextRefField(
    workflowId,
    phaseId,
    'sessionDefaults.starterPromptRef',
    rawDefaults.starterPromptRef,
  );
  if ('error' in starterPromptRef) {
    return starterPromptRef;
  }

  const resolvedStarterPrompt = resolveWorkflowTextValue(options.workspaceRoot, starterPromptRef.value, starterPrompt.value ?? '');
  if (resolvedStarterPrompt.trim().length > 0) {
    sessionDefaults.starterPrompt = resolvedStarterPrompt;
  }
  if (starterPromptRef.value) {
    sessionDefaults.starterPromptRef = starterPromptRef.value;
  }

  if (rawDefaults.starterPromptPlacement !== undefined) {
    if (!isStarterPromptPlacement(rawDefaults.starterPromptPlacement)) {
      return { error: `Workflow "${workflowId}" phase "${phaseId}" sessionDefaults.starterPromptPlacement must be prepend, append, or replace.` };
    }
    sessionDefaults.starterPromptPlacement = rawDefaults.starterPromptPlacement;
  }

  return Object.keys(sessionDefaults).length > 0 ? { sessionDefaults } : {};
}

function parseWorkspaceTextRefField(
  workflowId: string,
  phaseId: string,
  fieldPath: string,
  value: unknown,
): { value?: string } | { error: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'string') {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" ${fieldPath} must be a string.` };
  }

  const validation = validateWorkspaceTextRef(value);
  if (!validation.normalized) {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" ${fieldPath} ${validation.error ?? 'is invalid.'}` };
  }

  return { value: validation.normalized };
}

function resolveWorkflowTextValue(workspaceRoot: string | undefined, textRef: string | undefined, fallback: string): string {
  if (!workspaceRoot || !textRef) {
    return fallback;
  }

  const resolved = readWorkspaceTextRef(workspaceRoot, textRef);
  if (resolved.content === undefined) {
    return fallback;
  }

  return resolved.content;
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

function parseRequiredWorkflowStringField(
  workflowId: string,
  phaseId: string,
  fieldPath: string,
  value: unknown,
): { value?: string } | { error: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'string') {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" ${fieldPath} must be a string.` };
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return { error: `Workflow "${workflowId}" phase "${phaseId}" ${fieldPath} cannot be empty.` };
  }

  return { value: normalized };
}

export function workflowMetadataPath(epicFolderPath: string): string {
  return path.join(epicFolderPath, EPIC_WORKFLOW_METADATA_FILE);
}

export function writeWorkflowMetadata(epicFolderPath: string, workflow: WorkflowDefinition): void {
  const metadata: EpicWorkflowMetadata = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    ...(workflow.execution ? { execution: workflow.execution } : {}),
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
      execution: raw.execution,
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
