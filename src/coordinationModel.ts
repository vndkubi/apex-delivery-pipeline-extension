import * as fs from 'fs';
import * as path from 'path';

export const EPIC_COORDINATION_METADATA_FILE = '.apex-coordination.json';
export const EPIC_COORDINATION_SCHEMA_VERSION = 1;

const MACHINE_LOCAL_BRANCH_FIELDS = new Set([
  'worktreePath',
  'isCheckedOut',
  'dirtyFiles',
  'lastObservedAt',
  'branchExistsLocally',
  'changedFilesCount',
  'lastCommitAge',
]);

export interface CoordinationBranchBinding {
  name: string;
  role?: string;
  baseBranch?: string;
  createdByApex?: boolean;
  linkedAt?: string;
}

export interface CoordinationPullRequestBinding {
  provider?: string;
  number?: number;
  url?: string;
  baseBranch?: string;
  headBranch?: string;
  author?: string;
  linkedAt?: string;
}

export interface EpicCoordinationMetadata {
  schemaVersion: number;
  epicKey: string;
  mode?: string;
  baseBranch?: string;
  team?: string;
  owner?: string;
  coordinator?: string;
  priority?: string;
  targetDate?: string;
  jiraKeys: string[];
  branches: CoordinationBranchBinding[];
  pullRequests: CoordinationPullRequestBinding[];
  dependsOn: string[];
  blockedReason?: string;
  coordinationStatus?: string;
  lastCoordinatorReviewAt?: string;
}

export interface CoordinationMetadataReadResult {
  metadata?: EpicCoordinationMetadata;
  error?: string;
  raw?: Record<string, unknown>;
}

export function coordinationMetadataPath(epicFolderPath: string): string {
  return path.join(epicFolderPath, EPIC_COORDINATION_METADATA_FILE);
}

export function createDefaultCoordinationMetadata(epicKey: string): EpicCoordinationMetadata {
  return {
    schemaVersion: EPIC_COORDINATION_SCHEMA_VERSION,
    epicKey,
    jiraKeys: [],
    branches: [],
    pullRequests: [],
    dependsOn: [],
  };
}

export function readCoordinationMetadata(epicFolderPath: string): CoordinationMetadataReadResult {
  const metadataPath = coordinationMetadataPath(epicFolderPath);
  if (!fs.existsSync(metadataPath)) {
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as unknown;
    if (!isRecord(raw)) {
      return { error: `Coordination metadata at ${metadataPath} must be an object.` };
    }

    const parsed = parseCoordinationMetadata(raw, metadataPath);
    if (parsed.error) {
      return parsed;
    }

    return {
      metadata: parsed.metadata,
      raw,
    };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeCoordinationMetadata(
  epicFolderPath: string,
  metadata: EpicCoordinationMetadata,
  baseRecord?: Record<string, unknown>,
): void {
  const metadataPath = coordinationMetadataPath(epicFolderPath);
  const merged = mergeCoordinationMetadata(baseRecord, metadata);
  fs.writeFileSync(metadataPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}

export function withBranchBinding(
  metadata: EpicCoordinationMetadata,
  binding: CoordinationBranchBinding,
): EpicCoordinationMetadata {
  const sanitizedBinding = sanitizeBranchBinding(binding, 'branch binding');
  const existingBindings = metadata.branches.filter((candidate) => candidate.name !== sanitizedBinding.name);
  return sanitizeCoordinationMetadata({
    ...metadata,
    branches: [...existingBindings, sanitizedBinding],
  });
}

export function withPullRequestBinding(
  metadata: EpicCoordinationMetadata,
  binding: CoordinationPullRequestBinding,
): EpicCoordinationMetadata {
  const sanitizedBinding = sanitizePullRequestBinding(binding, 'pull request binding');
  const existingBindings = metadata.pullRequests.filter((candidate) => !isSamePullRequestBinding(candidate, sanitizedBinding));
  return sanitizeCoordinationMetadata({
    ...metadata,
    pullRequests: [...existingBindings, sanitizedBinding],
  });
}

export function parseCoordinationMetadata(
  raw: unknown,
  sourceLabel = 'coordination metadata',
): { metadata?: EpicCoordinationMetadata; error?: string; raw?: Record<string, unknown> } {
  if (!isRecord(raw)) {
    return { error: `${sourceLabel} must be an object.` };
  }

  const epicKey = readOptionalTrimmedString(raw.epicKey);
  if (!epicKey) {
    return { error: `${sourceLabel} must include epicKey.` };
  }

  const schemaVersion = raw.schemaVersion === undefined
    ? EPIC_COORDINATION_SCHEMA_VERSION
    : readRequiredNumber(raw.schemaVersion, `${sourceLabel} schemaVersion`);
  if (typeof schemaVersion !== 'number') {
    return { error: schemaVersion };
  }

  const jiraKeys = readStringArray(raw.jiraKeys, `${sourceLabel} jiraKeys`);
  if (typeof jiraKeys === 'string') {
    return { error: jiraKeys };
  }

  const dependsOn = readStringArray(raw.dependsOn, `${sourceLabel} dependsOn`);
  if (typeof dependsOn === 'string') {
    return { error: dependsOn };
  }

  const pullRequests = raw.pullRequests === undefined
    ? []
    : parsePullRequestBindings(raw.pullRequests, `${sourceLabel} pullRequests`);
  if (typeof pullRequests === 'string') {
    return { error: pullRequests };
  }

  const branches = raw.branches === undefined
    ? []
    : parseBranchBindings(raw.branches, `${sourceLabel} branches`);
  if (typeof branches === 'string') {
    return { error: branches };
  }

  return {
    metadata: sanitizeCoordinationMetadata({
      schemaVersion,
      epicKey,
      mode: readOptionalTrimmedString(raw.mode),
      baseBranch: readOptionalTrimmedString(raw.baseBranch),
      team: readOptionalTrimmedString(raw.team),
      owner: readOptionalTrimmedString(raw.owner),
      coordinator: readOptionalTrimmedString(raw.coordinator),
      priority: readOptionalTrimmedString(raw.priority),
      targetDate: readOptionalTrimmedString(raw.targetDate),
      jiraKeys,
      branches,
      pullRequests,
      dependsOn,
      blockedReason: readOptionalTrimmedString(raw.blockedReason),
      coordinationStatus: readOptionalTrimmedString(raw.coordinationStatus),
      lastCoordinatorReviewAt: readOptionalTrimmedString(raw.lastCoordinatorReviewAt),
    }),
    raw,
  };
}

export function sanitizeCoordinationMetadata(metadata: EpicCoordinationMetadata): EpicCoordinationMetadata {
  return {
    schemaVersion: EPIC_COORDINATION_SCHEMA_VERSION,
    epicKey: metadata.epicKey.trim(),
    mode: normalizeOptionalString(metadata.mode),
    baseBranch: normalizeOptionalString(metadata.baseBranch),
    team: normalizeOptionalString(metadata.team),
    owner: normalizeOptionalString(metadata.owner),
    coordinator: normalizeOptionalString(metadata.coordinator),
    priority: normalizeOptionalString(metadata.priority),
    targetDate: normalizeOptionalString(metadata.targetDate),
    jiraKeys: dedupeStrings(metadata.jiraKeys),
    branches: metadata.branches.map((binding) => sanitizeBranchBinding(binding, 'branch binding')),
    pullRequests: metadata.pullRequests.map((binding) => sanitizePullRequestBinding(binding, 'pull request binding')),
    dependsOn: dedupeStrings(metadata.dependsOn),
    blockedReason: normalizeOptionalString(metadata.blockedReason),
    coordinationStatus: normalizeOptionalString(metadata.coordinationStatus),
    lastCoordinatorReviewAt: normalizeOptionalString(metadata.lastCoordinatorReviewAt),
  };
}

function mergeCoordinationMetadata(
  baseRecord: Record<string, unknown> | undefined,
  metadata: EpicCoordinationMetadata,
): Record<string, unknown> {
  const merged = { ...(baseRecord ?? {}) };
  const sanitized = sanitizeCoordinationMetadata(metadata);

  delete merged.worktreePath;
  delete merged.isCheckedOut;
  delete merged.dirtyFiles;
  delete merged.lastObservedAt;

  merged.schemaVersion = sanitized.schemaVersion;
  merged.epicKey = sanitized.epicKey;
  setOptionalField(merged, 'mode', sanitized.mode);
  setOptionalField(merged, 'baseBranch', sanitized.baseBranch);
  setOptionalField(merged, 'team', sanitized.team);
  setOptionalField(merged, 'owner', sanitized.owner);
  setOptionalField(merged, 'coordinator', sanitized.coordinator);
  setOptionalField(merged, 'priority', sanitized.priority);
  setOptionalField(merged, 'targetDate', sanitized.targetDate);
  merged.jiraKeys = sanitized.jiraKeys;
  merged.branches = sanitized.branches.map((binding) => ({ ...binding }));
  merged.pullRequests = sanitized.pullRequests;
  merged.dependsOn = sanitized.dependsOn;
  setOptionalField(merged, 'blockedReason', sanitized.blockedReason);
  setOptionalField(merged, 'coordinationStatus', sanitized.coordinationStatus);
  setOptionalField(merged, 'lastCoordinatorReviewAt', sanitized.lastCoordinatorReviewAt);
  return merged;
}

function parseBranchBindings(value: unknown, fieldLabel: string): CoordinationBranchBinding[] | string {
  if (!Array.isArray(value)) {
    return `${fieldLabel} must be an array when present.`;
  }

  const bindings: CoordinationBranchBinding[] = [];
  for (const [index, rawBinding] of value.entries()) {
    if (!isRecord(rawBinding)) {
      return `${fieldLabel}[${index}] must be an object.`;
    }

    try {
      bindings.push(sanitizeBranchBinding(rawBinding, `${fieldLabel}[${index}]`));
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  return bindings;
}

function parsePullRequestBindings(value: unknown, fieldLabel: string): CoordinationPullRequestBinding[] | string {
  if (!Array.isArray(value)) {
    return `${fieldLabel} must be an array when present.`;
  }

  const bindings: CoordinationPullRequestBinding[] = [];
  for (const [index, rawBinding] of value.entries()) {
    if (!isRecord(rawBinding)) {
      return `${fieldLabel}[${index}] must be an object.`;
    }

    try {
      bindings.push(sanitizePullRequestBinding(rawBinding, `${fieldLabel}[${index}]`));
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  return bindings;
}

function sanitizeBranchBinding(rawBinding: unknown, fieldLabel: string): CoordinationBranchBinding {
  if (!isRecord(rawBinding)) {
    throw new Error(`${fieldLabel} must be an object.`);
  }

  const name = readOptionalTrimmedString(rawBinding.name);
  if (!name) {
    throw new Error(`${fieldLabel} must include a non-empty name.`);
  }

  const binding: CoordinationBranchBinding = { name };
  const role = readOptionalTrimmedString(rawBinding.role);
  const baseBranch = readOptionalTrimmedString(rawBinding.baseBranch);
  const linkedAt = readOptionalTrimmedString(rawBinding.linkedAt);

  if (role) {
    binding.role = role;
  }
  if (baseBranch) {
    binding.baseBranch = baseBranch;
  }
  if (typeof rawBinding.createdByApex === 'boolean') {
    binding.createdByApex = rawBinding.createdByApex;
  }
  if (linkedAt) {
    binding.linkedAt = linkedAt;
  }

  return binding;
}

function sanitizePullRequestBinding(rawBinding: unknown, fieldLabel: string): CoordinationPullRequestBinding {
  if (!isRecord(rawBinding)) {
    throw new Error(`${fieldLabel} must be an object.`);
  }

  const provider = readOptionalTrimmedString(rawBinding.provider);
  const url = readOptionalTrimmedString(rawBinding.url);
  const baseBranch = readOptionalTrimmedString(rawBinding.baseBranch);
  const headBranch = readOptionalTrimmedString(rawBinding.headBranch);
  const author = readOptionalTrimmedString(rawBinding.author);
  const linkedAt = readOptionalTrimmedString(rawBinding.linkedAt);
  const number = readOptionalInteger(rawBinding.number, `${fieldLabel} number`);
  if (typeof number === 'string') {
    throw new Error(number);
  }

  if (number === undefined && !url && !headBranch) {
    throw new Error(`${fieldLabel} must include at least one of number, url, or headBranch.`);
  }

  const binding: CoordinationPullRequestBinding = {};
  if (provider) {
    binding.provider = provider;
  }
  if (number !== undefined) {
    binding.number = number;
  }
  if (url) {
    binding.url = url;
  }
  if (baseBranch) {
    binding.baseBranch = baseBranch;
  }
  if (headBranch) {
    binding.headBranch = headBranch;
  }
  if (author) {
    binding.author = author;
  }
  if (linkedAt) {
    binding.linkedAt = linkedAt;
  }

  return binding;
}

function readStringArray(value: unknown, fieldLabel: string): string[] | string {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return `${fieldLabel} must be an array when present.`;
  }
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return `${fieldLabel} must contain strings only.`;
    }
    const normalized = item.trim();
    if (normalized.length > 0) {
      strings.push(normalized);
    }
  }
  return dedupeStrings(strings);
}

function readRequiredNumber(value: unknown, fieldLabel: string): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${fieldLabel} must be a number.`;
  }
  return Math.trunc(value);
}

function readOptionalInteger(value: unknown, fieldLabel: string): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredNumber(value, fieldLabel);
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function setOptionalField(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) {
    delete target[key];
    return;
  }

  target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSamePullRequestBinding(
  left: CoordinationPullRequestBinding,
  right: CoordinationPullRequestBinding,
): boolean {
  if (left.number !== undefined && right.number !== undefined) {
    return left.number === right.number;
  }
  if (left.url && right.url) {
    return left.url === right.url;
  }
  if (left.headBranch && right.headBranch) {
    return left.headBranch === right.headBranch;
  }
  return false;
}