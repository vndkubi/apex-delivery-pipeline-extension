import * as fs from 'fs';
import * as path from 'path';
import { resolvePhaseTemplateRef } from './pipelineModel';
import { writePhaseStatus } from './pipelineScanner';
import { TemplateContext, writeFromTemplate } from './templateRenderer';
import { WorkflowDefinition, writeWorkflowMetadata } from './workflowModel';

export interface BootstrapResult {
  epicKey: string;
  folderPath: string;
  created: boolean;
  workflowId: string;
  workflowName: string;
}

export interface CreateEpicOptions {
  title: string;
  owner: string;
  initialPhaseNote?: string;
}

export function createSampleEpic(
  workspaceRoot: string,
  epicsRelativePath: string,
  templateRoot: string,
  owner: string,
  workflowDefinition: WorkflowDefinition,
  title = 'AI Delivery Pipeline Pilot',
): BootstrapResult {
  return createWorkflowEpic(
    workspaceRoot,
    epicsRelativePath,
    templateRoot,
    workflowDefinition,
    {
      title,
      owner,
      initialPhaseNote: 'Sample epic created. Start with this workflow entry phase.',
    },
  );
}

export function createWorkflowEpic(
  workspaceRoot: string,
  epicsRelativePath: string,
  templateRoot: string,
  workflowDefinition: WorkflowDefinition,
  options: CreateEpicOptions,
): BootstrapResult {
  const epicsDir = path.resolve(workspaceRoot, epicsRelativePath);
  fs.mkdirSync(epicsDir, { recursive: true });

  const epicKey = nextEpicKey(epicsDir);
  const folderPath = path.join(epicsDir, epicKey);
  fs.mkdirSync(folderPath, { recursive: true });

  const context: TemplateContext = {
    epicKey,
    title: options.title,
    owner: options.owner,
    date: new Date().toISOString().slice(0, 10),
  };

  writeFromTemplate(workspaceRoot, templateRoot, 'EPIC.md', path.join(folderPath, 'EPIC.md'), context);
  writeWorkflowMetadata(folderPath, workflowDefinition);

  const firstPhaseId = workflowDefinition.phases[0]?.id;
  for (const phase of workflowDefinition.phases) {
    writeFromTemplate(workspaceRoot, templateRoot, resolvePhaseTemplateRef(phase), path.join(folderPath, phase.artifact), context);
    const status = phase.id === firstPhaseId ? 'in_progress' : 'pending';
    const note = phase.id === firstPhaseId
      ? options.initialPhaseNote ?? 'Workflow created. Start with this entry phase.'
      : 'Waiting for upstream phase completion.';
    writePhaseStatus(
      path.join(folderPath, 'phases', phase.id, 'status.json'),
      phase.id,
      status,
      options.owner,
      note,
    );
  }

  return {
    epicKey,
    folderPath,
    created: true,
    workflowId: workflowDefinition.id,
    workflowName: workflowDefinition.name,
  };
}

function nextEpicKey(epicsDir: string): string {
  const existingNumbers = fs.readdirSync(epicsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.match(/^APEX-(\d+)$/)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

  const nextNumber = existingNumbers.length === 0 ? 1000 : Math.max(...existingNumbers) + 1;
  return `APEX-${nextNumber}`;
}
