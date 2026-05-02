import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PHASES,
  EpicStatus,
  PhaseStatus,
  PhaseStatusValue,
  isCompletedStatus,
  isPhaseStatusValue,
} from './pipelineModel';
import { getDefaultWorkflowDefinition, readWorkflowMetadata } from './workflowModel';

interface ParsedEpicKey {
  prefix: string;
  number: number;
}

interface ParsedStatus {
  status: PhaseStatusValue;
  updatedAt?: string;
  notes?: string;
}

export class PipelineScanner {
  private epicsDir: string;

  constructor(private readonly workspaceRoot: string, epicsRelativePath: string) {
    this.epicsDir = path.resolve(workspaceRoot, epicsRelativePath);
  }

  getEpicsDir(): string {
    return this.epicsDir;
  }

  setEpicsPath(epicsRelativePath: string): void {
    this.epicsDir = path.resolve(this.workspaceRoot, epicsRelativePath);
  }

  scanAll(): EpicStatus[] {
    if (!fs.existsSync(this.epicsDir)) {
      return [];
    }

    return fs.readdirSync(this.epicsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Z][A-Z0-9]*-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareEpicKeys)
      .map((key) => this.scanEpic(key));
  }

  scanEpic(key: string): EpicStatus {
    const folderPath = path.join(this.epicsDir, key);
    const workflowMetadata = readWorkflowMetadata(folderPath);
    if (workflowMetadata.error) {
      console.warn(`[APEX Delivery] ${workflowMetadata.error}`);
    }

    const workflow = workflowMetadata.workflow ?? getDefaultWorkflowDefinition();
    const phases = workflow.phases.map((definition) => {
      const artifactPath = path.join(folderPath, definition.artifact);
      const statusPath = path.join(folderPath, 'phases', definition.id, 'status.json');
      const parsed = this.readPhaseStatus(statusPath);
      const inferred = hasUsefulContent(artifactPath) ? 'passed' : 'pending';
      return {
        id: definition.id,
        name: definition.name,
        owner: definition.owner,
        artifact: definition.artifact,
        artifactPath,
        statusPath,
        status: parsed?.status ?? inferred,
        gate: definition.gate,
        output: definition.output,
        autopilot: definition.autopilot,
        updatedAt: parsed?.updatedAt,
        notes: parsed?.notes,
      } satisfies PhaseStatus;
    });

    const firstOpenIndex = phases.findIndex((phase) => !isCompletedStatus(phase.status));
    const currentPhaseIndex = firstOpenIndex >= 0 ? firstOpenIndex : phases.length;
    const currentPhase = phases[currentPhaseIndex];
    if (currentPhase && currentPhase.status === 'pending') {
      currentPhase.status = 'in_progress';
    }

    const doneCount = phases.filter((phase) => isCompletedStatus(phase.status)).length;
    const progress = phases.length === 0 ? 0 : Math.round((doneCount / phases.length) * 100);

    return {
      key,
      title: this.extractTitle(folderPath, key),
      folderPath,
      workflowId: workflow.id,
      workflowName: workflow.name,
      phases,
      currentPhaseIndex,
      progress,
      hasBlocked: phases.some((phase) => phase.status === 'blocked' || phase.status === 'rejected'),
      hasAwaitingReview: phases.some((phase) => phase.status === 'awaiting_review'),
    };
  }

  private readPhaseStatus(statusPath: string): ParsedStatus | undefined {
    if (!fs.existsSync(statusPath)) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as unknown;
      if (!isRecord(parsed) || !isPhaseStatusValue(parsed.status)) {
        return undefined;
      }
      const updatedAt = typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined;
      const notes = typeof parsed.notes === 'string' ? parsed.notes : undefined;
      return { status: parsed.status, updatedAt, notes };
    } catch {
      return undefined;
    }
  }

  private extractTitle(folderPath: string, key: string): string {
    const candidates = ['EPIC.md', `${key}.md`, 'README.md'];
    for (const filename of candidates) {
      const filePath = path.join(folderPath, filename);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const title = firstMarkdownHeading(fs.readFileSync(filePath, 'utf8'));
      if (title) {
        return title.replace(/^Epic:\s*/i, '').trim();
      }
    }
    return key;
  }
}

export function writePhaseStatus(
  statusPath: string,
  phaseId: string,
  status: PhaseStatusValue,
  owner: string,
  notes: string,
): void {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(
    statusPath,
    JSON.stringify({
      phase: phaseId,
      status,
      owner,
      updated_at: new Date().toISOString(),
      notes,
    }, null, 2) + '\n',
    'utf8',
  );
}

function compareEpicKeys(left: string, right: string): number {
  const parsedLeft = parseEpicKey(left);
  const parsedRight = parseEpicKey(right);
  if (parsedLeft.prefix !== parsedRight.prefix) {
    return parsedLeft.prefix.localeCompare(parsedRight.prefix);
  }
  return parsedRight.number - parsedLeft.number;
}

function parseEpicKey(key: string): ParsedEpicKey {
  const match = key.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
  if (!match) {
    return { prefix: key, number: 0 };
  }
  return {
    prefix: match[1] ?? key,
    number: Number.parseInt(match[2] ?? '0', 10),
  };
}

function firstMarkdownHeading(content: string): string | undefined {
  const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith('# '));
  return line?.replace(/^#\s+/, '').trim();
}

const TEMPLATE_MARKERS = [
  '[Describe',
  '[What',
  '[Item]',
  '[Question]',
  '[Command]',
  '[Entity]',
  '[File]',
  '[Scenario]',
  '[Limitation]',
  '[Insight]',
  'TBD',
];

function hasUsefulContent(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8').replace(/^---[\s\S]*?---/, '').trim();
  if (content.length < 160) {
    return false;
  }
  return !TEMPLATE_MARKERS.some((marker) => content.includes(marker));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
