import * as fs from 'fs';
import type { PhaseAutopilotPolicy, PhaseDefinition } from './pipelineModel';
import { isWorkspaceTemplateRef, normalizeTemplateRef, resolveTemplateRefPath, validateTemplateRef } from './templateRef';
import { normalizeWorkspaceTextRef, readWorkspaceTextRef, resolveWorkspaceTextRefPath, validateWorkspaceTextRef } from './workspaceTextRef';
import { DEFAULT_WORKFLOW_ID, type WorkflowDefinition } from './workflowModel';

export type WorkflowEditorTemplateMode = 'artifact' | 'bundled' | 'workspace';
export type WorkflowEditorAutoSubmitMode = 'inherit' | 'true' | 'false';
export type WorkflowEditorTextMode = 'inline' | 'file';

export interface WorkflowEditorSessionDefaultsDraft {
  autoSubmit: WorkflowEditorAutoSubmitMode;
  agentTag: string;
  preferredChatAgent: string;
  modelFamily: string;
  starterPromptMode: WorkflowEditorTextMode;
  starterPrompt: string;
  starterPromptRef: string;
}

export interface WorkflowEditorPhaseDraft {
  id: string;
  name: string;
  owner: string;
  artifact: string;
  gate: string;
  outputMode: WorkflowEditorTextMode;
  output: string;
  outputRef: string;
  templateMode: WorkflowEditorTemplateMode;
  templateRef: string;
  sessionDefaults: WorkflowEditorSessionDefaultsDraft;
  autopilot?: PhaseAutopilotPolicy;
}

export interface WorkflowEditorWorkflowDraft {
  id: string;
  name: string;
  phases: WorkflowEditorPhaseDraft[];
}

export interface WorkflowEditorDraft {
  workflows: WorkflowEditorWorkflowDraft[];
}

export interface WorkflowEditorValidationIssue {
  path: string;
  message: string;
}

const VALID_GATES: ReadonlySet<string> = new Set(['Gate 1', 'Gate 2', 'Gate 3']);
const ARTIFACT_FILENAME_PATTERN = /^[^\\/]+\.md$/i;

export function listBundledTemplateRefs(templateRoot: string): readonly string[] {
  if (!fs.existsSync(templateRoot)) {
    return [];
  }

  return fs.readdirSync(templateRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function buildWorkflowEditorDraft(workflows: readonly WorkflowDefinition[]): WorkflowEditorDraft {
  return {
    workflows: workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      phases: workflow.phases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        owner: phase.owner,
        artifact: phase.artifact,
        gate: phase.gate,
        outputMode: phase.outputRef ? 'file' : 'inline',
        output: phase.output,
        outputRef: phase.outputRef ?? '',
        templateMode: getTemplateMode(phase.templateRef),
        templateRef: phase.templateRef ?? '',
        sessionDefaults: {
          autoSubmit: phase.sessionDefaults?.autoSubmit === undefined
            ? 'inherit'
            : phase.sessionDefaults.autoSubmit ? 'true' : 'false',
          agentTag: phase.sessionDefaults?.agentTag ?? '',
          preferredChatAgent: phase.sessionDefaults?.preferredChatAgent ?? '',
          modelFamily: phase.sessionDefaults?.modelFamily ?? '',
          starterPromptMode: phase.sessionDefaults?.starterPromptRef ? 'file' : 'inline',
          starterPrompt: phase.sessionDefaults?.starterPrompt ?? '',
          starterPromptRef: phase.sessionDefaults?.starterPromptRef ?? '',
        },
        autopilot: sanitizeAutopilot(phase.autopilot),
      })),
    })),
  };
}

export function createEmptyWorkflowDraft(index: number): WorkflowEditorWorkflowDraft {
  return {
    id: `workflow-${index + 1}`,
    name: 'New Workflow',
    phases: [createEmptyPhaseDraft(0)],
  };
}

export function createEmptyPhaseDraft(index: number): WorkflowEditorPhaseDraft {
  return {
    id: `phase-${index + 1}`,
    name: 'New Phase',
    owner: '',
    artifact: `PHASE-${index + 1}.md`,
    gate: 'Gate 1',
    outputMode: 'inline',
    output: '',
    outputRef: '',
    templateMode: 'artifact',
    templateRef: '',
    sessionDefaults: {
      autoSubmit: 'inherit',
      agentTag: '',
      preferredChatAgent: '',
      modelFamily: '',
      starterPromptMode: 'inline',
      starterPrompt: '',
      starterPromptRef: '',
    },
  };
}

export function validateWorkflowEditorDraft(
  draft: WorkflowEditorDraft,
  workspaceRoot: string,
  templateRoot: string,
): readonly WorkflowEditorValidationIssue[] {
  const issues: WorkflowEditorValidationIssue[] = [];
  const seenWorkflowIds = new Map<string, number>();

  for (const [workflowIndex, workflow] of draft.workflows.entries()) {
    const workflowId = workflow.id.trim();
    if (workflowId.length === 0) {
      issues.push(issue(`workflow.${workflowIndex}.id`, 'Workflow id is required.'));
    } else if (workflowId === DEFAULT_WORKFLOW_ID) {
      issues.push(issue(`workflow.${workflowIndex}.id`, `Workflow id "${DEFAULT_WORKFLOW_ID}" is reserved.`));
    } else if (seenWorkflowIds.has(workflowId)) {
      issues.push(issue(`workflow.${workflowIndex}.id`, 'Workflow id must be unique within workspace workflows.'));
    } else {
      seenWorkflowIds.set(workflowId, workflowIndex);
    }

    if (workflow.name.trim().length === 0) {
      issues.push(issue(`workflow.${workflowIndex}.name`, 'Workflow name is required.'));
    }

    if (workflow.phases.length === 0) {
      issues.push(issue(`workflow.${workflowIndex}.phases`, 'At least one phase is required.'));
    }

    const seenPhaseIds = new Set<string>();
    for (const [phaseIndex, phase] of workflow.phases.entries()) {
      const phasePrefix = `workflow.${workflowIndex}.phase.${phaseIndex}`;
      const phaseId = phase.id.trim();
      if (phaseId.length === 0) {
        issues.push(issue(`${phasePrefix}.id`, 'Phase id is required.'));
      } else if (seenPhaseIds.has(phaseId)) {
        issues.push(issue(`${phasePrefix}.id`, 'Phase id must be unique within the workflow.'));
      } else {
        seenPhaseIds.add(phaseId);
      }

      if (phase.name.trim().length === 0) {
        issues.push(issue(`${phasePrefix}.name`, 'Phase name is required.'));
      }

      if (phase.owner.trim().length === 0) {
        issues.push(issue(`${phasePrefix}.owner`, 'Owner is required.'));
      }

      if (!VALID_GATES.has(phase.gate.trim())) {
        issues.push(issue(`${phasePrefix}.gate`, 'Gate must be Gate 1, Gate 2, or Gate 3.'));
      }

      if (!ARTIFACT_FILENAME_PATTERN.test(phase.artifact.trim())) {
        issues.push(issue(`${phasePrefix}.artifact`, 'Artifact filename must be a markdown filename like REVIEW.md.'));
      }

      issues.push(...validateTextSelection(
        workspaceRoot,
        phasePrefix,
        'Output summary',
        phase.outputMode,
        phase.output,
        phase.outputRef,
        'output',
        'outputRef',
      ));

      issues.push(...validateTextSelection(
        workspaceRoot,
        phasePrefix,
        'Starter prompt',
        phase.sessionDefaults.starterPromptMode,
        phase.sessionDefaults.starterPrompt,
        phase.sessionDefaults.starterPromptRef,
        'sessionDefaults.starterPrompt',
        'sessionDefaults.starterPromptRef',
        false,
      ));

      issues.push(...validateTemplateSelection(workspaceRoot, templateRoot, phase, phasePrefix));
    }
  }

  return issues;
}

export function serializeWorkflowEditorDraft(draft: WorkflowEditorDraft): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  for (const workflow of draft.workflows) {
    const workflowId = workflow.id.trim();
    serialized[workflowId] = {
      name: workflow.name.trim(),
      phases: workflow.phases.map((phase) => {
        const serializedPhase: Record<string, unknown> = {
          id: phase.id.trim(),
          name: phase.name.trim(),
          owner: phase.owner.trim(),
          artifact: phase.artifact.trim(),
          gate: phase.gate.trim(),
          output: phase.outputMode === 'inline' ? phase.output.trim() : phase.output,
        };

        const outputRef = serializeTextRef(phase.outputMode, phase.outputRef);
        if (outputRef) {
          serializedPhase.outputRef = outputRef;
        }

        const templateRef = serializeTemplateRef(phase);
        if (templateRef) {
          serializedPhase.templateRef = templateRef;
        }

        const sessionDefaults = serializeSessionDefaults(phase.sessionDefaults);
        if (sessionDefaults) {
          serializedPhase.sessionDefaults = sessionDefaults;
        }

        const autopilot = sanitizeAutopilot(phase.autopilot);
        if (autopilot) {
          serializedPhase.autopilot = autopilot;
        }

        return serializedPhase;
      }),
    };
  }

  return serialized;
}

function getTemplateMode(templateRef: string | undefined): WorkflowEditorTemplateMode {
  if (!templateRef) {
    return 'artifact';
  }

  return isWorkspaceTemplateRef(templateRef) ? 'workspace' : 'bundled';
}

function validateTemplateSelection(
  workspaceRoot: string,
  templateRoot: string,
  phase: WorkflowEditorPhaseDraft,
  phasePrefix: string,
): WorkflowEditorValidationIssue[] {
  if (phase.templateMode === 'artifact') {
    return [];
  }

  const templateRef = phase.templateRef.trim();
  if (templateRef.length === 0) {
    return [issue(`${phasePrefix}.templateRef`, 'Template reference is required for the selected template source.')];
  }

  const validation = validateTemplateRef(templateRef);
  if (!validation.normalized) {
    return [issue(`${phasePrefix}.templateRef`, `Template reference ${validation.error ?? 'is invalid.'}`)];
  }

  if (phase.templateMode === 'bundled' && isWorkspaceTemplateRef(validation.normalized)) {
    return [issue(`${phasePrefix}.templateRef`, 'Bundled templates must use a filename like DESIGN.md.')] ;
  }

  if (phase.templateMode === 'workspace' && !isWorkspaceTemplateRef(validation.normalized)) {
    return [issue(`${phasePrefix}.templateRef`, 'Workspace templates must use a relative path like docs/templates/design.md.')] ;
  }

  const resolvedPath = resolveTemplateRefPath(workspaceRoot, templateRoot, validation.normalized);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return [issue(`${phasePrefix}.templateRef`, 'Template reference could not be resolved to an existing markdown file.')] ;
  }

  return [];
}

function serializeTemplateRef(phase: WorkflowEditorPhaseDraft): string | undefined {
  if (phase.templateMode === 'artifact') {
    return undefined;
  }

  const normalized = normalizeTemplateRef(phase.templateRef);
  return normalized.length > 0 ? normalized : undefined;
}

function serializeTextRef(mode: WorkflowEditorTextMode, textRef: string): string | undefined {
  if (mode !== 'file') {
    return undefined;
  }

  const normalized = normalizeWorkspaceTextRef(textRef);
  return normalized.length > 0 ? normalized : undefined;
}

function serializeSessionDefaults(sessionDefaults: WorkflowEditorSessionDefaultsDraft): Record<string, unknown> | undefined {
  const serialized: Record<string, unknown> = {};

  if (sessionDefaults.autoSubmit === 'true') {
    serialized.autoSubmit = true;
  } else if (sessionDefaults.autoSubmit === 'false') {
    serialized.autoSubmit = false;
  }

  if (sessionDefaults.agentTag.trim().length > 0) {
    serialized.agentTag = sessionDefaults.agentTag.trim();
  }

  if (sessionDefaults.preferredChatAgent.trim().length > 0) {
    serialized.preferredChatAgent = sessionDefaults.preferredChatAgent.trim();
  }

  if (sessionDefaults.modelFamily.trim().length > 0) {
    serialized.modelFamily = sessionDefaults.modelFamily.trim();
  }

  if (sessionDefaults.starterPromptMode === 'inline') {
    if (sessionDefaults.starterPrompt.trim().length > 0) {
      serialized.starterPrompt = sessionDefaults.starterPrompt.trim();
    }
  } else {
    const starterPromptRef = serializeTextRef(sessionDefaults.starterPromptMode, sessionDefaults.starterPromptRef);
    if (starterPromptRef) {
      serialized.starterPromptRef = starterPromptRef;
    }
    if (sessionDefaults.starterPrompt.length > 0) {
      serialized.starterPrompt = sessionDefaults.starterPrompt;
    }
  }

  return Object.keys(serialized).length > 0 ? serialized : undefined;
}

function validateTextSelection(
  workspaceRoot: string,
  phasePrefix: string,
  label: string,
  mode: WorkflowEditorTextMode,
  value: string,
  textRef: string,
  valueField: string,
  refField: string,
  required = true,
): WorkflowEditorValidationIssue[] {
  if (mode === 'inline') {
    if (required && value.trim().length === 0) {
      return [issue(`${phasePrefix}.${valueField}`, `${label} is required.`)];
    }

    return [];
  }

  const validation = validateWorkspaceTextRef(textRef);
  if (!validation.normalized) {
    return [issue(`${phasePrefix}.${refField}`, `${label} file reference ${validation.error ?? 'is invalid.'}`)];
  }

  const resolvedPath = resolveWorkspaceTextRefPath(workspaceRoot, validation.normalized);
  if (!resolvedPath) {
    return [issue(`${phasePrefix}.${refField}`, `${label} file reference must stay inside the workspace.`)];
  }

  const resolvedText = readWorkspaceTextRef(workspaceRoot, validation.normalized);
  if (resolvedText.content === undefined) {
    return [issue(`${phasePrefix}.${refField}`, `${label} file reference ${resolvedText.error ?? 'could not be read.'}`)];
  }

  return [];
}

function sanitizeAutopilot(autopilot: PhaseAutopilotPolicy | undefined): PhaseAutopilotPolicy | undefined {
  if (!autopilot) {
    return undefined;
  }

  const sanitized: PhaseAutopilotPolicy = {};
  if (typeof autopilot.enabled === 'boolean') {
    sanitized.enabled = autopilot.enabled;
  }
  if (typeof autopilot.retryLimit === 'number' && Number.isFinite(autopilot.retryLimit) && autopilot.retryLimit >= 0) {
    sanitized.retryLimit = Math.floor(autopilot.retryLimit);
  }
  if (typeof autopilot.pauseOnManualIntervention === 'boolean') {
    sanitized.pauseOnManualIntervention = autopilot.pauseOnManualIntervention;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function issue(path: string, message: string): WorkflowEditorValidationIssue {
  return { path, message };
}