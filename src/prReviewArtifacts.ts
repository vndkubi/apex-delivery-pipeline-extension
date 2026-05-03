export interface PullRequestReviewArtifactContext {
  generatedAt: string;
  reviewer: string;
  mode: 'linked-epic' | 'unlinked';
  pr: {
    provider?: string;
    number?: number;
    url?: string;
    title?: string;
    baseBranch?: string;
    headBranch?: string;
    author?: string;
  };
  linkedEpic?: {
    key: string;
    title: string;
  };
  changedFiles: string[];
}

export function buildPullRequestReviewMarkdown(context: PullRequestReviewArtifactContext): string {
  const label = formatPullRequestLabel(context.pr.number, context.pr.url);
  const changedFiles = context.changedFiles.length > 0
    ? context.changedFiles.map((file) => `- ${file}`).join('\n')
    : '- No local diff was available from repo-local Git signals.';

  return [
    `# PR Review - ${label}`,
    '',
    '## Context',
    `- Provider: ${context.pr.provider ?? 'github'}`,
    `- URL: ${context.pr.url ?? 'Unknown'}`,
    `- Base: ${context.pr.baseBranch ?? 'Unknown'}`,
    `- Head: ${context.pr.headBranch ?? 'Unknown'}`,
    `- Author: ${context.pr.author ?? 'Unknown'}`,
    `- Linked Epic: ${context.linkedEpic ? `${context.linkedEpic.key} - ${context.linkedEpic.title}` : 'None'}`,
    `- Reviewer: ${context.reviewer}`,
    `- Generated: ${context.generatedAt}`,
    '',
    '## Changed Files',
    changedFiles,
    '',
    '## Findings',
    '| Severity | File | Issue | Recommendation |',
    '|---|---|---|---|',
    '| Pending | Review required | Add concrete findings after inspection. | Replace this row with evidence-backed findings. |',
    '',
    '## Missing Tests',
    '- Verify behavioral coverage against the changed files and linked epic artifacts.',
    '',
    '## Risk Assessment',
    `- Review mode: ${context.mode}`,
    '- Jira or provider enrichment was optional in this MVP path.',
    '',
    '## Verdict',
    '- Approve / Comment / Request Changes',
  ].join('\n');
}

export function buildPullRequestReviewSection(context: PullRequestReviewArtifactContext): string {
  const label = formatPullRequestLabel(context.pr.number, context.pr.url);
  const changedFiles = context.changedFiles.length > 0
    ? context.changedFiles.map((file) => `- ${file}`).join('\n')
    : '- No local diff was available from repo-local Git signals.';

  return [
    `## PR Review - ${label}`,
    '',
    `- Base: ${context.pr.baseBranch ?? 'Unknown'}`,
    `- Head: ${context.pr.headBranch ?? 'Unknown'}`,
    `- Linked Epic: ${context.linkedEpic ? context.linkedEpic.key : 'None'}`,
    `- Reviewer: ${context.reviewer}`,
    `- Generated: ${context.generatedAt}`,
    '',
    '### Changed Files',
    changedFiles,
    '',
    '### Findings',
    '| Severity | File | Issue | Recommendation |',
    '|---|---|---|---|',
    '| Pending | Review required | Add concrete findings after inspection. | Replace this row with evidence-backed findings. |',
    '',
    '### Verdict',
    '- Approve / Comment / Request Changes',
  ].join('\n');
}

export function buildPullRequestReviewContextJson(context: PullRequestReviewArtifactContext): string {
  return JSON.stringify({
    schemaVersion: 1,
    mode: 'pr-review',
    generatedAt: context.generatedAt,
    reviewer: context.reviewer,
    linkedEpic: context.linkedEpic?.key,
    pr: {
      provider: context.pr.provider ?? 'github',
      number: context.pr.number,
      url: context.pr.url,
      title: context.pr.title,
      baseBranch: context.pr.baseBranch,
      headBranch: context.pr.headBranch,
      author: context.pr.author,
    },
    changedFiles: context.changedFiles,
  }, null, 2) + '\n';
}

export function upsertPullRequestReviewSection(
  existingContent: string | undefined,
  prNumber: number | undefined,
  sectionMarkdown: string,
): string {
  const reviewKey = prNumber ?? 0;
  const startMarker = `<!-- APEX:PR-REVIEW:${reviewKey}:START -->`;
  const endMarker = `<!-- APEX:PR-REVIEW:${reviewKey}:END -->`;
  const wrappedSection = [startMarker, sectionMarkdown.trimEnd(), endMarker].join('\n');

  if (!existingContent || existingContent.trim().length === 0) {
    return ['# Review', '', wrappedSection, ''].join('\n');
  }

  const markerPattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`, 'm');
  if (markerPattern.test(existingContent)) {
    return `${existingContent.replace(markerPattern, wrappedSection).trimEnd()}\n`;
  }

  return `${existingContent.trimEnd()}\n\n${wrappedSection}\n`;
}

function formatPullRequestLabel(number: number | undefined, url: string | undefined): string {
  if (number !== undefined) {
    return `#${number}`;
  }
  return url ?? 'Unknown PR';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}