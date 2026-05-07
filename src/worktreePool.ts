import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowExecutionMode } from './pipelineModel';

export type ManagedWorktreeLeaseMode = Exclude<WorkflowExecutionMode, 'control'>;

export interface ManagedWorktreePoolOptions {
  maxSlots?: number;
}

export interface ManagedWorktreeSlot {
  slotId: string;
  worktreePath: string;
  state: 'idle' | 'leased';
  branchName?: string;
  leaseMode?: ManagedWorktreeLeaseMode;
  leasedAt?: string;
  releasedAt?: string;
  lastUsedAt?: string;
}

export interface ManagedWorktreeAcquireResult {
  ok: boolean;
  reusedExisting: boolean;
  slot?: ManagedWorktreeSlot;
  error?: string;
}

export interface ManagedWorktreeReleaseResult {
  released: boolean;
  slot?: ManagedWorktreeSlot;
  error?: string;
}

export interface ManagedWorktreePruneResult {
  prunedSlotIds: readonly string[];
  remainingSlots: readonly ManagedWorktreeSlot[];
}

interface ManagedWorktreePoolState {
  version: 1;
  slots: ManagedWorktreeSlot[];
}

export class ManagedWorktreePool {
  constructor(
    private readonly poolRoot: string,
    private readonly options: ManagedWorktreePoolOptions = {},
  ) {}

  getPoolRoot(): string {
    return this.poolRoot;
  }

  listSlots(): readonly ManagedWorktreeSlot[] {
    return this.readState().slots;
  }

  acquire(branchName: string, leaseMode: ManagedWorktreeLeaseMode = 'pooled'): ManagedWorktreeAcquireResult {
    const normalizedBranchName = branchName.trim();
    if (normalizedBranchName.length === 0) {
      return {
        ok: false,
        reusedExisting: false,
        error: 'Branch name is required.',
      };
    }

    const state = this.readState();
    const timestamp = new Date().toISOString();
    const existingSlot = state.slots.find((slot) => slot.branchName === normalizedBranchName);
    if (existingSlot) {
      existingSlot.state = 'leased';
      existingSlot.leaseMode = leaseMode;
      existingSlot.lastUsedAt = timestamp;
      if (!existingSlot.leasedAt) {
        existingSlot.leasedAt = timestamp;
      }
      delete existingSlot.releasedAt;
      this.ensureSlotDirectory(existingSlot.worktreePath);
      this.writeState(state);
      return {
        ok: true,
        reusedExisting: true,
        slot: existingSlot,
      };
    }

    const idleSlot = state.slots.find((slot) => slot.state === 'idle');
    const slot = idleSlot ?? this.createSlot(state.slots);
    if (!slot) {
      return {
        ok: false,
        reusedExisting: false,
        error: `Managed worktree pool is full (${this.maxSlots()} slots).`,
      };
    }

    slot.state = 'leased';
    slot.branchName = normalizedBranchName;
    slot.leaseMode = leaseMode;
    slot.leasedAt = timestamp;
    slot.lastUsedAt = timestamp;
    delete slot.releasedAt;
    this.ensureSlotDirectory(slot.worktreePath);

    if (!idleSlot) {
      state.slots.push(slot);
    }

    this.writeState(state);
    return {
      ok: true,
      reusedExisting: false,
      slot,
    };
  }

  releaseBranch(branchName: string): ManagedWorktreeReleaseResult {
    return this.release((slot) => slot.branchName === branchName.trim());
  }

  releaseSlot(slotId: string): ManagedWorktreeReleaseResult {
    return this.release((slot) => slot.slotId === slotId.trim());
  }

  pruneIdleSlots(): ManagedWorktreePruneResult {
    const state = this.readState();
    const prunedSlotIds: string[] = [];
    const remainingSlots = state.slots.filter((slot) => {
      if (slot.state !== 'idle') {
        return true;
      }
      prunedSlotIds.push(slot.slotId);
      if (fs.existsSync(slot.worktreePath)) {
        fs.rmSync(slot.worktreePath, { recursive: true, force: true });
      }
      return false;
    });

    if (prunedSlotIds.length > 0) {
      this.writeState({ version: 1, slots: remainingSlots });
    }

    return {
      prunedSlotIds,
      remainingSlots,
    };
  }

  private release(predicate: (slot: ManagedWorktreeSlot) => boolean): ManagedWorktreeReleaseResult {
    const state = this.readState();
    const slot = state.slots.find(predicate);
    if (!slot) {
      return {
        released: false,
        error: 'Managed worktree slot was not found.',
      };
    }

    slot.state = 'idle';
    delete slot.branchName;
    delete slot.leaseMode;
    delete slot.leasedAt;
    slot.releasedAt = new Date().toISOString();
    this.writeState(state);
    return {
      released: true,
      slot,
    };
  }

  private createSlot(existingSlots: readonly ManagedWorktreeSlot[]): ManagedWorktreeSlot | undefined {
    for (let index = 1; index <= this.maxSlots(); index += 1) {
      const slotId = this.buildSlotId(index);
      if (existingSlots.some((slot) => slot.slotId === slotId)) {
        continue;
      }

      return {
        slotId,
        worktreePath: path.join(this.poolRoot, slotId),
        state: 'idle',
      };
    }

    return undefined;
  }

  private buildSlotId(index: number): string {
    return `slot-${String(index).padStart(2, '0')}`;
  }

  private maxSlots(): number {
    return Math.max(1, Math.floor(this.options.maxSlots ?? 8));
  }

  private stateFilePath(): string {
    return path.join(this.poolRoot, '.managed-worktree-pool.json');
  }

  private ensurePoolRoot(): void {
    fs.mkdirSync(this.poolRoot, { recursive: true });
  }

  private ensureSlotDirectory(slotPath: string): void {
    this.ensurePoolRoot();
    fs.mkdirSync(slotPath, { recursive: true });
  }

  private readState(): ManagedWorktreePoolState {
    this.ensurePoolRoot();
    const stateFilePath = this.stateFilePath();
    if (!fs.existsSync(stateFilePath)) {
      return { version: 1, slots: [] };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(stateFilePath, 'utf8')) as ManagedWorktreePoolState;
      if (raw.version !== 1 || !Array.isArray(raw.slots)) {
        return { version: 1, slots: [] };
      }
      return {
        version: 1,
        slots: raw.slots.map((slot) => ({ ...slot })),
      };
    } catch {
      return { version: 1, slots: [] };
    }
  }

  private writeState(state: ManagedWorktreePoolState): void {
    this.ensurePoolRoot();
    fs.writeFileSync(this.stateFilePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
  }
}