import * as fs from 'fs';
import * as path from 'path';
import type { EpicStatus, PhaseStatus } from './pipelineModel';
import { PBI_DELIVERY_WORKFLOW_ID } from './workflowModel';

export const PBI_ROLE_PRESETS = [
  'BA',
  'Tech Lead',
  'Developer',
  'Reviewer',
  'QA',
  'Release Manager',
] as const;

export type PbiRolePreset = typeof PBI_ROLE_PRESETS[number];

export interface PbiReviewBreakdown {
  label: string;
  score: number;
  note: string;
}

export interface PbiReviewScore {
  score: number;
  summary: string;
  readiness: 'low' | 'medium' | 'high';
  breakdown: readonly PbiReviewBreakdown[];
}

export interface CopilotCliHandoffResult {
  promptPath: string;
  command: string;
  content: string;
}

const PBI_ARTIFACT_PRIORITY = [
  'PBI.md',
  'INVESTIGATION.md',
  'CODE-FLOW.md',
  'DESIGN-DECISION.md',
  'TEST-DECISION.md',
  'TDD-PLAN.md',
  'PBI-REVIEW.md',
  'EVIDENCE.md',
] as const;

export function isPbiDeliveryWorkflow(workflowId: string | undefined): boolean {
  return workflowId === PBI_DELIVERY_WORKFLOW_ID;
}

export function findPbiPhase(epic: EpicStatus, phaseId: string): PhaseStatus | undefined {
  return epic.phases.find((phase) => phase.id === phaseId);
}

export function listPbiReferencePaths(epic: EpicStatus, currentPhase: PhaseStatus): readonly string[] {
  const ordered = [
    path.join(epic.folderPath, 'EPIC.md'),
    ...PBI_ARTIFACT_PRIORITY.map((artifact) => path.join(epic.folderPath, artifact)),
    currentPhase.artifactPath,
    currentPhase.statusPath,
  ];

  return ordered.filter((candidate, index, all) => fs.existsSync(candidate) && all.indexOf(candidate) === index);
}

export function writePbiImportNotes(epic: EpicStatus, text: string, source?: string): string {
  const artifactPath = path.join(epic.folderPath, 'PBI.md');
  const sourceLabel = source?.trim() || 'manual';
  const content = [
    '# PBI Intake',
    '',
    `Imported: ${new Date().toISOString()}`,
    `Source: ${sourceLabel}`,
    '',
    '## Raw Input',
    text.trim(),
    '',
    '## Normalization Checklist',
    '- Problem statement',
    '- Acceptance criteria',
    '- Business rules',
    '- Dependencies',
    '- Unknowns / clarification needed',
    '- Risks / rollout impact',
    '',
  ].join('\n');
  fs.writeFileSync(artifactPath, content, 'utf8');
  return artifactPath;
}

export function computePbiReviewScore(epic: EpicStatus, changedFiles: readonly string[] = []): PbiReviewScore {
  const pbiPath = path.join(epic.folderPath, 'PBI.md');
  const designPath = path.join(epic.folderPath, 'DESIGN-DECISION.md');
  const testDecisionPath = path.join(epic.folderPath, 'TEST-DECISION.md');
  const reviewPath = path.join(epic.folderPath, 'PBI-REVIEW.md');
  const evidencePath = path.join(epic.folderPath, 'EVIDENCE.md');
  const codeFlowPath = path.join(epic.folderPath, 'CODE-FLOW.md');

  const pbiContent = readFileIfExists(pbiPath);
  const designContent = readFileIfExists(designPath);
  const testDecisionContent = readFileIfExists(testDecisionPath);
  const reviewContent = readFileIfExists(reviewPath);
  const evidenceContent = readFileIfExists(evidencePath);
  const codeFlowContent = readFileIfExists(codeFlowPath);

  const acceptanceCriteriaCount = countMarkdownBullets(extractSection(pbiContent, 'Acceptance Criteria'));
  const changedFilesCovered = changedFiles.length === 0
    ? true
    : changedFiles.some((file) => containsFileReference(reviewContent + '\n' + evidenceContent, file));
  const exceptionCoverage = /(exception|error path|retry|timeout|fallback)/i.test(codeFlowContent + '\n' + testDecisionContent);
  const hasBlockedOrStale = epic.phases.some((phase) => phase.status === 'blocked' || phase.status === 'stale' || phase.status === 'rejected');
  const hasEvidence = /(verification|evidence|command|result)/i.test(evidenceContent);
  const designLinked = /(selected approach|tradeoff|rollback|option)/i.test(designContent);

  const breakdown: PbiReviewBreakdown[] = [
    {
      label: 'Acceptance coverage',
      score: acceptanceCriteriaCount >= 3 ? 20 : acceptanceCriteriaCount > 0 ? 12 : 4,
      note: acceptanceCriteriaCount > 0 ? `${acceptanceCriteriaCount} acceptance criteria captured.` : 'Acceptance criteria are still thin or missing.',
    },
    {
      label: 'Design traceability',
      score: designLinked ? 20 : 8,
      note: designLinked ? 'Design decision records tradeoffs and rollback considerations.' : 'Design decision is missing tradeoffs or rollback reasoning.',
    },
    {
      label: 'Test evidence',
      score: hasEvidence ? 20 : 6,
      note: hasEvidence ? 'Evidence pack includes verification signals.' : 'Evidence pack is missing concrete verification output.',
    },
    {
      label: 'Changed-file relevance',
      score: changedFilesCovered ? 20 : changedFiles.length === 0 ? 14 : 6,
      note: changedFiles.length === 0
        ? 'No changed files were provided; scored from artifact readiness only.'
        : changedFilesCovered
          ? 'Review artifacts reference changed files or impacted modules.'
          : 'Changed files are not yet tied back to review/evidence artifacts.',
    },
    {
      label: 'Exception-path coverage',
      score: exceptionCoverage ? 20 : hasBlockedOrStale ? 4 : 10,
      note: exceptionCoverage
        ? 'Code-flow or test-decision artifacts mention failure handling.'
        : hasBlockedOrStale
          ? 'Blocked or stale phases exist without clear exception-path handling.'
          : 'Exception handling coverage is still implicit.',
    },
  ];

  let score = breakdown.reduce((total, item) => total + item.score, 0);
  if (hasBlockedOrStale) {
    score = Math.max(0, score - 10);
  }

  const readiness = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
  return {
    score,
    readiness,
    breakdown,
    summary: readiness === 'high'
      ? 'Review-ready with traceable requirements, design, tests, and evidence.'
      : readiness === 'medium'
        ? 'Partially review-ready; core artifacts exist but evidence or traceability is still incomplete.'
        : 'Not review-ready yet; key PBI artifacts or evidence are still missing.',
  };
}

export function buildPbiEvidencePack(epic: EpicStatus, changedFiles: readonly string[] = []): string {
  const score = computePbiReviewScore(epic, changedFiles);
  const lines = [
    `# Evidence Pack - ${epic.key}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Workflow: ${epic.workflowName}`,
    `Current phase: ${epic.phases[epic.currentPhaseIndex]?.name ?? 'Completed'}`,
    '',
    '## Review Readiness',
    `- Score: ${score.score}/100`,
    `- Readiness: ${score.readiness}`,
    `- Summary: ${score.summary}`,
    '',
    '## Artifact Checklist',
    ...PBI_ARTIFACT_PRIORITY.map((artifact) => {
      const artifactPath = path.join(epic.folderPath, artifact);
      return `- [${fs.existsSync(artifactPath) ? 'x' : ' '}] ${artifact}`;
    }),
    '',
    '## Review Breakdown',
    ...score.breakdown.map((item) => `- ${item.label}: ${item.score}/20 - ${item.note}`),
    '',
    '## Phase Status',
    ...epic.phases.map((phase) => `- ${phase.name} (${phase.id}): ${phase.status} - ${phase.owner}`),
    '',
    '## Changed Files',
    ...(changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`) : ['- No changed files supplied.']),
    '',
    '## Residual Risks',
    '- [Describe remaining delivery or rollout risk.]',
    '- [Describe any unresolved dependency or clarification.]',
    '',
  ];

  return lines.join('\n');
}

export function buildPbiReviewArtifact(epic: EpicStatus, changedFiles: readonly string[] = []): string {
  const score = computePbiReviewScore(epic, changedFiles);
  const lines = [
    `# PBI Review - ${epic.key}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Readiness: ${score.score}/100 (${score.readiness})`,
    '',
    '## Requirement Alignment',
    '- [Map acceptance criteria to implementation evidence.]',
    '',
    '## Design Drift',
    '- [Note any divergence from the selected design decision.]',
    '',
    '## Test Coverage',
    '- [Note missing tests, edge cases, or exception-path gaps.]',
    '',
    '## Changed Files',
    ...(changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`) : ['- No changed files supplied.']),
    '',
    '## Review Score Breakdown',
    ...score.breakdown.map((item) => `- ${item.label}: ${item.note}`),
    '',
    '## Findings',
    '| Severity | Area | Finding | Action |',
    '|---|---|---|---|',
    '| Pending | Review | Add evidence-backed findings after inspection. | Replace this row with concrete findings. |',
    '',
  ];

  return lines.join('\n');
}

export function buildCopilotCliHandoff(
  workspaceRoot: string,
  epic: EpicStatus,
  phase: PhaseStatus,
  prompt: string,
): CopilotCliHandoffResult {
  const handoffDir = path.join(epic.folderPath, 'handoffs', 'copilot-cli');
  fs.mkdirSync(handoffDir, { recursive: true });
  const promptPath = path.join(handoffDir, `${phase.id}.prompt.md`);
  const content = [
    `# Copilot CLI Handoff - ${epic.key} / ${phase.name}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    prompt.trim(),
    '',
  ].join('\n');
  fs.writeFileSync(promptPath, content, 'utf8');
  const relativePath = path.relative(workspaceRoot, promptPath).replaceAll('\\', '/');
  return {
    promptPath,
    command: `copilot -p "@${relativePath}"`,
    content,
  };
}

function readFileIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function extractSection(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^##\\s+${escapedHeading}[\\s\\S]*?(?=^##\\s+|\\Z)`, 'im'));
  return match?.[0] ?? '';
}

function countMarkdownBullets(content: string): number {
  return content.split(/\r?\n/).filter((line) => /^\s*[-*]\s+\S+/.test(line)).length;
}

function containsFileReference(content: string, filePath: string): boolean {
  const normalizedFilePath = filePath.replaceAll('\\', '/');
  return content.includes(normalizedFilePath) || content.includes(path.basename(normalizedFilePath));
}
