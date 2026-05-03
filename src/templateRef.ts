import * as path from 'path';

export interface TemplateRefValidationResult {
  normalized?: string;
  error?: string;
}

export function normalizeTemplateRef(value: string): string {
  const trimmed = value.trim().replaceAll('\\', '/');
  return trimmed.replace(/^\.\//, '');
}

export function isWorkspaceTemplateRef(templateRef: string): boolean {
  return normalizeTemplateRef(templateRef).includes('/');
}

export function validateTemplateRef(value: string): TemplateRefValidationResult {
  const normalized = normalizeTemplateRef(value);
  if (normalized.length === 0) {
    return { error: 'cannot be empty.' };
  }

  if (!normalized.toLowerCase().endsWith('.md')) {
    return { error: 'must point to a markdown file ending in .md.' };
  }

  if (path.isAbsolute(normalized) || normalized.startsWith('/')) {
    return { error: 'must be a bundled template filename or a workspace-relative markdown path.' };
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return { error: 'must not contain empty, ".", or ".." path segments.' };
  }

  return { normalized };
}

export function resolveTemplateRefPath(
  workspaceRoot: string,
  templateRoot: string,
  templateRef: string,
): string | undefined {
  const validation = validateTemplateRef(templateRef);
  if (!validation.normalized) {
    return undefined;
  }

  if (!isWorkspaceTemplateRef(validation.normalized)) {
    return path.join(templateRoot, validation.normalized);
  }

  const resolvedPath = path.resolve(workspaceRoot, validation.normalized);
  const relative = path.relative(workspaceRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }

  return resolvedPath;
}