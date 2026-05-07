import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ManagedWorktreePool } from '../../worktreePool';

export function runWorktreePoolSmokeSuite(workspaceRoot: string): void {
  const worktreePoolRoot = path.join(workspaceRoot, '.apex-test', 'worktree-pool');
  fs.rmSync(worktreePoolRoot, { recursive: true, force: true });
  const worktreePool = new ManagedWorktreePool(worktreePoolRoot, { maxSlots: 2 });
  const pooledSlot = worktreePool.acquire('feat/worktree-pool-a', 'pooled');
  assert.ok(pooledSlot.ok && pooledSlot.slot, 'AC5: Expected the managed worktree pool skeleton to acquire a pooled slot.');
  assert.strictEqual(pooledSlot.slot?.slotId, 'slot-01', 'AC5: Expected the managed worktree pool skeleton to allocate the first slot deterministically.');
  assert.ok(fs.existsSync(pooledSlot.slot?.worktreePath ?? ''), 'AC5: Expected the managed worktree pool skeleton to materialize the slot directory.');
  const reusedPooledSlot = worktreePool.acquire('feat/worktree-pool-a', 'pooled');
  assert.ok(reusedPooledSlot.ok && reusedPooledSlot.reusedExisting, 'AC5: Expected acquiring the same branch to reuse the existing managed pool slot.');
  const releasedPooledSlot = worktreePool.releaseBranch('feat/worktree-pool-a');
  assert.ok(releasedPooledSlot.released, 'AC5: Expected the managed worktree pool skeleton to release a slot by branch name.');
  const pinnedSlot = worktreePool.acquire('feat/worktree-pool-b', 'pinned');
  assert.ok(pinnedSlot.ok && pinnedSlot.slot, 'AC5: Expected the managed worktree pool skeleton to acquire a pinned slot.');
  const pruneWhileLeased = worktreePool.pruneIdleSlots();
  assert.deepStrictEqual(pruneWhileLeased.prunedSlotIds, [], 'AC5: Expected idle-slot pruning to leave leased slots untouched.');
  const releasedPinnedSlot = worktreePool.releaseSlot(pinnedSlot.slot?.slotId ?? '');
  assert.ok(releasedPinnedSlot.released, 'AC5: Expected the managed worktree pool skeleton to release a slot by slot id.');
  const prunedIdleSlots = worktreePool.pruneIdleSlots();
  assert.ok(prunedIdleSlots.prunedSlotIds.includes(pinnedSlot.slot?.slotId ?? ''), 'AC5: Expected idle-slot pruning to remove released slots from the pool skeleton state.');
  assert.ok(!fs.existsSync(pinnedSlot.slot?.worktreePath ?? ''), 'AC5: Expected idle-slot pruning to remove the released slot directory.');
}
