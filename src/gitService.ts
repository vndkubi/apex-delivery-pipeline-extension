import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface GitCurrentBranchResult {
  branchName?: string;
  detached?: boolean;
  error?: string;
}

export interface GitWorktreeInfo {
  path: string;
  branchName?: string;
  head?: string;
  detached: boolean;
  bare: boolean;
  current: boolean;
}

export interface GitWorktreeStatus {
  branchName?: string;
  dirtyFiles: number;
  changedFiles: string[];
  lastCommitAt?: string;
  error?: string;
}

export interface GitWorktreeEnsureResult {
  worktreePath?: string;
  created: boolean;
  error?: string;
}

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export class GitService {
  getCurrentBranch(workspaceRoot: string): GitCurrentBranchResult {
    const result = this.runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (result.exitCode !== 0) {
      return result.error ? { error: result.error } : {};
    }

    const branchName = result.stdout.trim();
    if (branchName.length === 0 || branchName === 'HEAD') {
      return { detached: true };
    }

    return { branchName };
  }

  branchExists(workspaceRoot: string, branchName: string): boolean {
    const result = this.runGit(workspaceRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return result.exitCode === 0;
  }

  listLocalBranches(workspaceRoot: string): string[] {
    const result = this.runGit(workspaceRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      return [];
    }

    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  }

  listWorktrees(workspaceRoot: string): GitWorktreeInfo[] {
    const result = this.runGit(workspaceRoot, ['worktree', 'list', '--porcelain']);
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      return [];
    }

    const worktrees: GitWorktreeInfo[] = [];
    let current: Partial<GitWorktreeInfo> | undefined;
    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0) {
        if (current?.path) {
          worktrees.push({
            path: current.path,
            branchName: current.branchName,
            head: current.head,
            detached: current.detached === true,
            bare: current.bare === true,
            current: path.resolve(current.path) === path.resolve(workspaceRoot),
          });
        }
        current = undefined;
        continue;
      }

      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length) };
        continue;
      }

      if (!current) {
        continue;
      }

      if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
        continue;
      }

      if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length);
        current.branchName = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
        continue;
      }

      if (line === 'detached') {
        current.detached = true;
        continue;
      }

      if (line === 'bare') {
        current.bare = true;
      }
    }

    if (current?.path) {
      worktrees.push({
        path: current.path,
        branchName: current.branchName,
        head: current.head,
        detached: current.detached === true,
        bare: current.bare === true,
        current: path.resolve(current.path) === path.resolve(workspaceRoot),
      });
    }

    return worktrees;
  }

  findWorktreeForBranch(workspaceRoot: string, branchName: string): GitWorktreeInfo | undefined {
    return this.listWorktrees(workspaceRoot).find((worktree) => worktree.branchName === branchName);
  }

  ensureWorktreeForBranch(workspaceRoot: string, branchName: string, worktreePath: string): GitWorktreeEnsureResult {
    const existingWorktree = this.findWorktreeForBranch(workspaceRoot, branchName);
    if (existingWorktree) {
      return {
        worktreePath: existingWorktree.path,
        created: false,
      };
    }

    if (!this.branchExists(workspaceRoot, branchName)) {
      return {
        created: false,
        error: `Local branch "${branchName}" does not exist.`,
      };
    }

    if (fs.existsSync(worktreePath)) {
      return {
        created: false,
        error: `Worktree path already exists and is not registered for branch "${branchName}": ${worktreePath}`,
      };
    }

    const result = this.runGit(workspaceRoot, ['worktree', 'add', worktreePath, branchName]);
    if (result.exitCode !== 0) {
      return {
        created: false,
        error: result.error ?? (result.stderr || `Git worktree add failed for branch "${branchName}".`),
      };
    }

    return {
      worktreePath,
      created: true,
    };
  }

  getWorktreeStatus(worktreePath: string): GitWorktreeStatus {
    const statusResult = this.runGit(worktreePath, ['status', '--porcelain']);
    const branchResult = this.runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const logResult = this.runGit(worktreePath, ['log', '-1', '--format=%cI']);

    const changedFiles = statusResult.exitCode === 0
      ? statusResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
      : [];
    const branchName = branchResult.exitCode === 0 && branchResult.stdout.trim() !== 'HEAD'
      ? branchResult.stdout.trim()
      : undefined;
    const lastCommitAt = logResult.exitCode === 0 ? logResult.stdout.trim() || undefined : undefined;
    const error = statusResult.error ?? branchResult.error ?? logResult.error;

    return {
      branchName,
      dirtyFiles: changedFiles.length,
      changedFiles,
      lastCommitAt,
      error,
    };
  }

  getChangedFiles(workspaceRoot: string, baseRef: string, headRef: string): string[] {
    const result = this.runGit(workspaceRoot, ['diff', '--name-only', `${baseRef}...${headRef}`]);
    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  }

  private runGit(cwd: string, args: string[]): GitCommandResult {
    if (!hasGitMetadata(cwd)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: '',
      };
    }

    try {
      const stdout = execFileSync(
        'git',
        args,
        {
          cwd,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      return {
        exitCode: 0,
        stdout: stdout.trim(),
        stderr: '',
      };
    } catch (error: unknown) {
      const gitError = error as Error & { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
      return {
        exitCode: typeof gitError.status === 'number' ? gitError.status : 1,
        stdout: normalizeExecOutput(gitError.stdout),
        stderr: normalizeExecOutput(gitError.stderr),
        error: gitError.message,
      };
    }
  }
}

function hasGitMetadata(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, '.git'));
}

function normalizeExecOutput(value: string | Buffer | undefined): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value instanceof Buffer) {
    return value.toString('utf8').trim();
  }
  return '';
}