import * as vscode from 'vscode';
import type { EpicStatus, PhaseStatus } from './pipelineModel';

const APEX_SESSION_PROVIDER_STORAGE_KEY = 'apexDelivery.sessionProviderState';
const APEX_SESSION_PROVIDER_STORAGE_VERSION = 1;

export type ApexSessionStatus =
  | 'prepared'
  | 'opened'
  | 'submitted'
  | 'waitingForAgent'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'orphaned';

export type ApexTransportStability = 'stable-public' | 'best-effort-command' | 'internal-unsupported' | 'not-configured';

export type ApexChatLaunchResult = 'submitted' | 'prefilled' | 'opened' | 'unavailable';

export interface ApexSessionRecord {
  sessionId: string;
  sessionKey: string;
  epicKey: string;
  workflowId?: string;
  currentPhaseId: string;
  currentPhaseName: string;
  transportId: string;
  transportStability: ApexTransportStability;
  transportResource?: string;
  status: ApexSessionStatus;
  lastLaunchMode?: 'ask' | 'agent' | 'direct-model';
  lastFallbackReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistedApexSessionState {
  version: number;
  records: Record<string, ApexSessionRecord>;
  epicBindings: Record<string, string>;
}

export interface ApexSessionStore {
  getByEpic(epicKey: string): Promise<ApexSessionRecord | undefined>;
  getBySessionId(sessionId: string): Promise<ApexSessionRecord | undefined>;
  upsert(record: ApexSessionRecord): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export interface ApexSessionTransportDescriptor {
  readonly id: string;
  readonly stability: ApexTransportStability;
  readonly supportsExactSessionTargeting: boolean;
}

export interface ApexChatLaunchPayload {
  prompt: string;
  attachFiles: readonly vscode.Uri[];
  autoSubmit: boolean;
}

export interface ApexChatSessionTransport extends ApexSessionTransportDescriptor {
  openAsk(record: ApexSessionRecord, payload: ApexChatLaunchPayload): Promise<ApexChatLaunchResult>;
  openAgent(record: ApexSessionRecord, payload: ApexChatLaunchPayload): Promise<ApexChatLaunchResult>;
}

export interface ApexDirectModelTransport<TResult, TPayload = void> extends ApexSessionTransportDescriptor {
  run(record: ApexSessionRecord, payload: TPayload): Promise<TResult>;
}

export interface ApexSessionProvider {
  getByEpic(epicKey: string): Promise<ApexSessionRecord | undefined>;
  getOrCreate(epic: EpicStatus, phase: PhaseStatus): Promise<ApexSessionRecord>;
  bindPhase(sessionId: string, phase: PhaseStatus): Promise<ApexSessionRecord | undefined>;
  bindTransport(
    sessionId: string,
    descriptor: ApexSessionTransportDescriptor,
    options?: {
      resource?: string;
      launchMode?: ApexSessionRecord['lastLaunchMode'];
      fallbackReason?: string;
    },
  ): Promise<ApexSessionRecord | undefined>;
  markStatus(sessionId: string, status: ApexSessionStatus, reason?: string): Promise<ApexSessionRecord | undefined>;
}

export class WorkspaceApexSessionStore implements ApexSessionStore {
  constructor(private readonly store: vscode.Memento) {}

  async getByEpic(epicKey: string): Promise<ApexSessionRecord | undefined> {
    const snapshot = readSnapshot(this.store);
    const sessionId = snapshot.epicBindings[epicKey];
    return sessionId ? snapshot.records[sessionId] : undefined;
  }

  async getBySessionId(sessionId: string): Promise<ApexSessionRecord | undefined> {
    return readSnapshot(this.store).records[sessionId];
  }

  async upsert(record: ApexSessionRecord): Promise<void> {
    const snapshot = readSnapshot(this.store);
    snapshot.records[record.sessionId] = record;
    snapshot.epicBindings[record.epicKey] = record.sessionId;
    await this.store.update(APEX_SESSION_PROVIDER_STORAGE_KEY, snapshot);
  }

  async delete(sessionId: string): Promise<void> {
    const snapshot = readSnapshot(this.store);
    delete snapshot.records[sessionId];
    for (const [epicKey, boundSessionId] of Object.entries(snapshot.epicBindings)) {
      if (boundSessionId === sessionId) {
        delete snapshot.epicBindings[epicKey];
      }
    }
    await this.store.update(APEX_SESSION_PROVIDER_STORAGE_KEY, snapshot);
  }
}

export class PersistentApexSessionProvider implements ApexSessionProvider {
  constructor(
    private readonly store: ApexSessionStore,
    private readonly buildSessionKey: (epic: EpicStatus) => string,
  ) {}

  async getByEpic(epicKey: string): Promise<ApexSessionRecord | undefined> {
    return this.store.getByEpic(epicKey);
  }

  async getOrCreate(epic: EpicStatus, phase: PhaseStatus): Promise<ApexSessionRecord> {
    const existing = await this.store.getByEpic(epic.key);
    const now = new Date().toISOString();
    if (existing) {
      const next = {
        ...existing,
        epicKey: epic.key,
        workflowId: epic.workflowId,
        currentPhaseId: phase.id,
        currentPhaseName: phase.name,
        updatedAt: now,
      } satisfies ApexSessionRecord;
      await this.store.upsert(next);
      return next;
    }

    const sessionKey = this.buildSessionKey(epic);
    const created: ApexSessionRecord = {
      sessionId: sessionKey,
      sessionKey,
      epicKey: epic.key,
      workflowId: epic.workflowId,
      currentPhaseId: phase.id,
      currentPhaseName: phase.name,
      transportId: 'not-configured',
      transportStability: 'not-configured',
      status: 'prepared',
      createdAt: now,
      updatedAt: now,
    };
    await this.store.upsert(created);
    return created;
  }

  async bindPhase(sessionId: string, phase: PhaseStatus): Promise<ApexSessionRecord | undefined> {
    const existing = await this.store.getBySessionId(sessionId);
    if (!existing) {
      return undefined;
    }

    const next = {
      ...existing,
      currentPhaseId: phase.id,
      currentPhaseName: phase.name,
      updatedAt: new Date().toISOString(),
    } satisfies ApexSessionRecord;
    await this.store.upsert(next);
    return next;
  }

  async bindTransport(
    sessionId: string,
    descriptor: ApexSessionTransportDescriptor,
    options?: {
      resource?: string;
      launchMode?: ApexSessionRecord['lastLaunchMode'];
      fallbackReason?: string;
    },
  ): Promise<ApexSessionRecord | undefined> {
    const existing = await this.store.getBySessionId(sessionId);
    if (!existing) {
      return undefined;
    }

    const next = {
      ...existing,
      transportId: descriptor.id,
      transportStability: descriptor.stability,
      transportResource: options?.resource ?? existing.transportResource,
      lastLaunchMode: options?.launchMode ?? existing.lastLaunchMode,
      lastFallbackReason: options?.fallbackReason ?? existing.lastFallbackReason,
      updatedAt: new Date().toISOString(),
    } satisfies ApexSessionRecord;
    await this.store.upsert(next);
    return next;
  }

  async markStatus(sessionId: string, status: ApexSessionStatus, reason?: string): Promise<ApexSessionRecord | undefined> {
    const existing = await this.store.getBySessionId(sessionId);
    if (!existing) {
      return undefined;
    }

    const next = {
      ...existing,
      status,
      lastFallbackReason: reason ?? existing.lastFallbackReason,
      updatedAt: new Date().toISOString(),
    } satisfies ApexSessionRecord;
    await this.store.upsert(next);
    return next;
  }
}

function readSnapshot(store: vscode.Memento): PersistedApexSessionState {
  const raw = store.get<unknown>(APEX_SESSION_PROVIDER_STORAGE_KEY);
  if (!isRecord(raw) || raw.version !== APEX_SESSION_PROVIDER_STORAGE_VERSION) {
    return emptySnapshot();
  }

  const records = isRecord(raw.records)
    ? Object.fromEntries(
      Object.entries(raw.records)
        .filter(([, value]) => isApexSessionRecord(value)),
    ) as Record<string, ApexSessionRecord>
    : {};

  const epicBindings = isRecord(raw.epicBindings)
    ? Object.fromEntries(
      Object.entries(raw.epicBindings)
        .filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>
    : {};

  return {
    version: APEX_SESSION_PROVIDER_STORAGE_VERSION,
    records,
    epicBindings,
  };
}

function emptySnapshot(): PersistedApexSessionState {
  return {
    version: APEX_SESSION_PROVIDER_STORAGE_VERSION,
    records: {},
    epicBindings: {},
  };
}

function isApexSessionRecord(value: unknown): value is ApexSessionRecord {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && typeof value.sessionKey === 'string'
    && typeof value.epicKey === 'string'
    && typeof value.currentPhaseId === 'string'
    && typeof value.currentPhaseName === 'string'
    && typeof value.transportId === 'string'
    && isApexTransportStability(value.transportStability)
    && isApexSessionStatus(value.status)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isApexSessionStatus(value: unknown): value is ApexSessionStatus {
  return value === 'prepared'
    || value === 'opened'
    || value === 'submitted'
    || value === 'waitingForAgent'
    || value === 'paused'
    || value === 'completed'
    || value === 'failed'
    || value === 'orphaned';
}

function isApexTransportStability(value: unknown): value is ApexTransportStability {
  return value === 'stable-public'
    || value === 'best-effort-command'
    || value === 'internal-unsupported'
    || value === 'not-configured';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}