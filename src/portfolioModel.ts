import * as fs from 'fs';
import * as path from 'path';
import type { GitService, GitWorktreeInfo } from './gitService';
import type { EpicStatus } from './pipelineModel';

export interface PortfolioIndex {
  schemaVersion: number;
  controlBranch?: string;
  activeEpics: string[];
  archivedEpics: string[];
  releaseTrains: Record<string, unknown>;
}

export interface PortfolioIndexResult {
  path: string;
  index?: PortfolioIndex;
  error?: string;
}

export interface WorktreeSignal {
  branchName: string;
  worktreePath: string;
  current: boolean;
  dirtyFiles: number;
  lastCommitAt?: string;
  branchExistsLocally: boolean;
  error?: string;
}

export interface PortfolioEpicEntry {
  epic: EpicStatus;
  linkedBranchNames: string[];
  pullRequestCount: number;
  worktreeSignal?: WorktreeSignal;
  missingBranchLink: boolean;
}

export interface PortfolioSummary {
  activeEpics: number;
  blockedEpics: number;
  awaitingReview: number;
  openPullRequests: number;
  readyForRelease: number;
  stalePhases: number;
  missingBranchLinks: number;
  localWorktrees: number;
}

export interface PortfolioSnapshot {
  entries: PortfolioEpicEntry[];
  summary: PortfolioSummary;
  indexState: 'available' | 'missing' | 'invalid';
  indexPath: string;
  controlBranch?: string;
  currentBranch?: string;
  warnings: string[];
}

export function buildPortfolioSnapshot(
  workspaceRoot: string,
  epicsPath: string,
  epics: readonly EpicStatus[],
  gitService: GitService,
  currentBranch?: string,
): PortfolioSnapshot {
  const indexResult = readPortfolioIndex(workspaceRoot, epicsPath);
  const worktrees = gitService.listWorktrees(workspaceRoot);
  const worktreesByBranch = new Map<string, GitWorktreeInfo>();
  for (const worktree of worktrees) {
    if (worktree.branchName) {
      worktreesByBranch.set(worktree.branchName, worktree);
    }
  }

  const entries = epics.map((epic) => {
    const linkedBranchNames = epic.coordination?.branches.map((branch) => branch.name) ?? [];
    const matchingWorktree = linkedBranchNames.map((branchName) => worktreesByBranch.get(branchName)).find((candidate) => Boolean(candidate));
    const worktreeSignal = matchingWorktree && matchingWorktree.branchName
      ? buildWorktreeSignal(gitService, workspaceRoot, matchingWorktree)
      : undefined;

    return {
      epic,
      linkedBranchNames,
      pullRequestCount: epic.coordination?.pullRequests.length ?? 0,
      worktreeSignal,
      missingBranchLink: linkedBranchNames.length === 0,
    } satisfies PortfolioEpicEntry;
  });

  const warnings = [
    indexResult.error,
    indexResult.index ? undefined : 'Portfolio index missing. Dashboard is using epic scanning fallback.',
  ].filter((warning): warning is string => Boolean(warning));

  return {
    entries,
    summary: {
      activeEpics: entries.filter((entry) => entry.epic.progress > 0 && entry.epic.progress < 100).length,
      blockedEpics: entries.filter((entry) => entry.epic.hasBlocked).length,
      awaitingReview: entries.filter((entry) => entry.epic.hasAwaitingReview).length,
      openPullRequests: entries.reduce((total, entry) => total + entry.pullRequestCount, 0),
      readyForRelease: entries.filter((entry) => entry.epic.coordination?.coordinationStatus === 'ready_for_release').length,
      stalePhases: entries.reduce((total, entry) => total + entry.epic.phases.filter((phase) => phase.status === 'stale').length, 0),
      missingBranchLinks: entries.filter((entry) => entry.missingBranchLink).length,
      localWorktrees: entries.filter((entry) => entry.worktreeSignal).length,
    },
    indexState: indexResult.index ? 'available' : indexResult.error ? 'invalid' : 'missing',
    indexPath: indexResult.path,
    controlBranch: indexResult.index?.controlBranch,
    currentBranch,
    warnings,
  };
}

export function readPortfolioIndex(workspaceRoot: string, epicsPath: string): PortfolioIndexResult {
  const portfolioPath = path.resolve(workspaceRoot, epicsPath, '..', 'portfolio.json');
  if (!fs.existsSync(portfolioPath)) {
    return { path: portfolioPath };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(portfolioPath, 'utf8')) as unknown;
    if (!isRecord(raw)) {
      return {
        path: portfolioPath,
        error: `Portfolio index at ${portfolioPath} must be an object.`,
      };
    }

    const activeEpics = readStringArray(raw.activeEpics, 'activeEpics');
    if (typeof activeEpics === 'string') {
      return { path: portfolioPath, error: activeEpics };
    }
    const archivedEpics = readStringArray(raw.archivedEpics, 'archivedEpics');
    if (typeof archivedEpics === 'string') {
      return { path: portfolioPath, error: archivedEpics };
    }

    return {
      path: portfolioPath,
      index: {
        schemaVersion: typeof raw.schemaVersion === 'number' ? Math.trunc(raw.schemaVersion) : 1,
        controlBranch: typeof raw.controlBranch === 'string' ? raw.controlBranch.trim() || undefined : undefined,
        activeEpics,
        archivedEpics,
        releaseTrains: isRecord(raw.releaseTrains) ? raw.releaseTrains : {},
      },
    };
  } catch (error: unknown) {
    return {
      path: portfolioPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildWorktreeSignal(
  gitService: GitService,
  workspaceRoot: string,
  worktree: GitWorktreeInfo,
): WorktreeSignal {
  const status = gitService.getWorktreeStatus(worktree.path);
  return {
    branchName: worktree.branchName ?? status.branchName ?? '(detached)',
    worktreePath: worktree.path,
    current: path.resolve(worktree.path) === path.resolve(workspaceRoot),
    dirtyFiles: status.dirtyFiles,
    lastCommitAt: status.lastCommitAt,
    branchExistsLocally: worktree.branchName ? gitService.branchExists(workspaceRoot, worktree.branchName) : false,
    error: status.error,
  };
}

function readStringArray(value: unknown, fieldName: string): string[] | string {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return `${fieldName} must be an array.`;
  }
  const values = value.filter((candidate): candidate is string => typeof candidate === 'string').map((candidate) => candidate.trim()).filter((candidate) => candidate.length > 0);
  if (values.length !== value.length) {
    return `${fieldName} must contain only strings.`;
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}