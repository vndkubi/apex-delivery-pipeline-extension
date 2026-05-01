import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PHASES } from './pipelineModel';
import { writePhaseStatus } from './pipelineScanner';
import { TemplateContext, writeFromTemplate } from './templateRenderer';

export interface BootstrapResult {
  epicKey: string;
  folderPath: string;
  created: boolean;
}

export function createSampleEpic(
  workspaceRoot: string,
  epicsRelativePath: string,
  templateRoot: string,
  owner: string,
): BootstrapResult {
  const epicsDir = path.resolve(workspaceRoot, epicsRelativePath);
  fs.mkdirSync(epicsDir, { recursive: true });

  const epicKey = nextEpicKey(epicsDir);
  const folderPath = path.join(epicsDir, epicKey);
  fs.mkdirSync(folderPath, { recursive: true });

  const context: TemplateContext = {
    epicKey,
    title: 'AI Delivery Pipeline Pilot',
    owner,
    date: new Date().toISOString().slice(0, 10),
  };

  writeFromTemplate(templateRoot, 'EPIC.md', path.join(folderPath, 'EPIC.md'), context);
  for (const phase of DEFAULT_PHASES) {
    writeFromTemplate(templateRoot, phase.artifact, path.join(folderPath, phase.artifact), context);
    const status = phase.id === 'discover' ? 'in_progress' : 'pending';
    const note = phase.id === 'discover'
      ? 'Sample epic created. Start by validating the business problem and baseline.'
      : 'Waiting for upstream phase completion.';
    writePhaseStatus(
      path.join(folderPath, 'phases', phase.id, 'status.json'),
      phase.id,
      status,
      owner,
      note,
    );
  }

  return { epicKey, folderPath, created: true };
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
