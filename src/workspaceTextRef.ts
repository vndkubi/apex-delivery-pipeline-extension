import * as fs from 'fs';
import * as path from 'path';

export interface WorkspaceTextRefValidation {
  normalized?: string;
  error?: string;
}

export interface WorkspaceTextRefReadResult {
  normalized?: string;
  resolvedPath?: string;
  content?: string;
  error?: string;
}

export function normalizeWorkspaceTextRef(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

export function validateWorkspaceTextRef(value: string): WorkspaceTextRefValidation {
  const normalized = normalizeWorkspaceTextRef(value);
  if (normalized.length === 0) {
    return { error: 'is required.' };
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return { error: 'must be a workspace-relative file path.' };
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { error: 'must be a workspace-relative file path.' };
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { error: 'must stay inside the workspace.' };
  }

  return { normalized };
}

export function resolveWorkspaceTextRefPath(workspaceRoot: string, textRef: string): string | undefined {
  const validation = validateWorkspaceTextRef(textRef);
  if (!validation.normalized) {
    return undefined;
  }

  const resolvedPath = path.resolve(workspaceRoot, validation.normalized);
  const relativePath = path.relative(workspaceRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return undefined;
  }

  return resolvedPath;
}

export function readWorkspaceTextRef(workspaceRoot: string, textRef: string): WorkspaceTextRefReadResult {
  const validation = validateWorkspaceTextRef(textRef);
  if (!validation.normalized) {
    return { error: validation.error };
  }

  const resolvedPath = resolveWorkspaceTextRefPath(workspaceRoot, validation.normalized);
  if (!resolvedPath) {
    return { error: 'must stay inside the workspace.' };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { normalized: validation.normalized, resolvedPath, error: 'could not be resolved to an existing file.' };
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return { normalized: validation.normalized, resolvedPath, error: 'must point to a file, not a folder.' };
  }

  return {
    normalized: validation.normalized,
    resolvedPath,
    content: fs.readFileSync(resolvedPath, 'utf8'),
  };
}

export function ensureWorkspaceTextRefFile(
  workspaceRoot: string,
  textRef: string,
  seedContent: string,
): WorkspaceTextRefReadResult {
  const validation = validateWorkspaceTextRef(textRef);
  if (!validation.normalized) {
    return { error: validation.error };
  }

  const resolvedPath = resolveWorkspaceTextRefPath(workspaceRoot, validation.normalized);
  if (!resolvedPath) {
    return { error: 'must stay inside the workspace.' };
  }

  try {
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, seedContent, 'utf8');
    }
  } catch (error: unknown) {
    return {
      normalized: validation.normalized,
      resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return readWorkspaceTextRef(workspaceRoot, validation.normalized);
}