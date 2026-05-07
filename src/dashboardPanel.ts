import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { escapeHtml } from './html';
import type { PortfolioEpicEntry, PortfolioSnapshot } from './portfolioModel';
import { computePbiReviewScore, isPbiDeliveryWorkflow } from './pbiWorkflow';

export class DashboardPanel {
  private static currentPanel: DashboardPanel | undefined;

  private constructor(private readonly panel: vscode.WebviewPanel) {
    this.panel.onDidDispose(() => {
      DashboardPanel.currentPanel = undefined;
    });
  }

  static show(snapshot: PortfolioSnapshot): void {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      DashboardPanel.currentPanel.update(snapshot);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'apexDeliveryDashboard',
      'APEX Delivery Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    DashboardPanel.currentPanel = new DashboardPanel(panel);
    DashboardPanel.currentPanel.update(snapshot);
  }

  static updateIfVisible(snapshot: PortfolioSnapshot): void {
    DashboardPanel.currentPanel?.update(snapshot);
  }

  private update(snapshot: PortfolioSnapshot): void {
    this.panel.webview.html = this.render(snapshot);
  }

  private render(snapshot: PortfolioSnapshot): string {
    const total = snapshot.entries.length;
    const { summary } = snapshot;
    const pbiEntries = snapshot.entries.filter((entry) => isPbiDeliveryWorkflow(entry.epic.workflowId));
    const reviewReadyPbis = pbiEntries.filter((entry) => computePbiReviewScore(entry.epic).score >= 80).length;
    const staleHandoffs = pbiEntries.filter((entry) => hasStaleHandoff(entry.epic.folderPath)).length;
    const owners = uniqueSorted(snapshot.entries.flatMap((entry) => [
      entry.epic.coordination?.owner,
      ...entry.epic.phases.map((phase) => phase.owner),
    ]));
    const statuses = uniqueSorted(snapshot.entries.flatMap((entry) => entry.epic.phases.map((phase) => phase.status)));
    const indexStateLabel = snapshot.indexState === 'available'
      ? 'Portfolio index loaded'
      : snapshot.indexState === 'invalid'
        ? 'Portfolio index invalid'
        : 'Portfolio index missing';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>APEX Delivery Dashboard</title>
<style>
  :root {
    --surface: color-mix(in srgb, var(--vscode-editor-background) 84%, #0f766e 16%);
    --surface-strong: color-mix(in srgb, var(--vscode-sideBar-background) 78%, #164e63 22%);
    --line: color-mix(in srgb, var(--vscode-panel-border) 65%, #5eead4 35%);
    --accent: #5eead4;
    --accent-strong: #0f766e;
    --warning: #f59e0b;
    --danger: #f97316;
    --success: #22c55e;
    --muted: var(--vscode-descriptionForeground);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--vscode-foreground);
    font-family: Aptos, 'Segoe UI Variable', 'Segoe UI', sans-serif;
    background:
      radial-gradient(circle at top right, rgba(94, 234, 212, 0.16), transparent 32%),
      radial-gradient(circle at bottom left, rgba(249, 115, 22, 0.10), transparent 30%),
      var(--vscode-editor-background);
    padding: 28px;
  }
  .shell { max-width: 1200px; margin: 0 auto; }
  .hero {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    align-items: flex-end;
    margin-bottom: 24px;
  }
  h1 {
    font-size: 30px;
    line-height: 1.05;
    margin: 0 0 8px;
    letter-spacing: -0.03em;
  }
  .subtitle {
    color: var(--muted);
    max-width: 700px;
    margin: 0;
    line-height: 1.5;
  }
  .hero-note {
    border: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(15, 118, 110, 0.16), rgba(8, 47, 73, 0.10));
    border-radius: 18px;
    padding: 14px 16px;
    min-width: 280px;
    color: var(--muted);
  }
  .hero-note strong {
    display: block;
    margin-bottom: 6px;
    color: var(--vscode-foreground);
  }
  .hero-note code {
    font-family: Consolas, 'Courier New', monospace;
    color: var(--accent);
  }
  .stats, .inbox {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 22px;
  }
  .stat, .epic, .warning-card, .inbox-card {
    border: 1px solid var(--line);
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
    backdrop-filter: blur(12px);
  }
  .stat, .inbox-card {
    padding: 18px;
  }
  .stat strong, .inbox-card strong {
    display: block;
    font-size: 28px;
    letter-spacing: -0.04em;
    margin-bottom: 4px;
  }
  .stat span, .inbox-card span {
    color: var(--muted);
    font-size: 13px;
  }
  .section-title {
    margin: 28px 0 12px;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    align-items: end;
    margin: 0 0 22px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255,255,255,0.03);
  }
  .field label, .toggle {
    display: block;
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 6px;
  }
  select {
    width: 100%;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--line));
    border-radius: 4px;
    padding: 7px 8px;
  }
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
  .filter-count {
    color: var(--muted);
    font-size: 12px;
    align-self: center;
  }
  .warning-list {
    display: grid;
    gap: 12px;
    margin-bottom: 22px;
  }
  .warning-card {
    padding: 14px 16px;
    border-color: rgba(245, 158, 11, 0.34);
    background: linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(120, 53, 15, 0.10));
  }
  .warning-card strong {
    display: block;
    margin-bottom: 6px;
  }
  .epic-list {
    display: grid;
    gap: 16px;
  }
  .epic {
    padding: 18px;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(8, 47, 73, 0.06));
  }
  .epic-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 14px;
  }
  .epic-title {
    font-weight: 700;
    font-size: 16px;
    margin-bottom: 6px;
  }
  .epic-key {
    color: var(--accent);
    font-weight: 700;
  }
  .epic-meta, .epic-details, .signal-list {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.55;
  }
  .epic-details, .signal-list {
    margin-top: 12px;
  }
  .signal-list code {
    font-family: Consolas, 'Courier New', monospace;
    color: var(--accent);
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }
  .badge {
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .badge.progress {
    background: rgba(94, 234, 212, 0.14);
    color: var(--accent);
    border-color: rgba(94, 234, 212, 0.24);
  }
  .badge.review {
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
    border-color: rgba(245, 158, 11, 0.28);
  }
  .badge.blocked {
    background: rgba(249, 115, 22, 0.12);
    color: #fdba74;
    border-color: rgba(249, 115, 22, 0.30);
  }
  .badge.signal {
    background: rgba(34, 197, 94, 0.12);
    color: #86efac;
    border-color: rgba(34, 197, 94, 0.28);
  }
  .progress-track {
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(15, 23, 42, 0.46);
    margin-bottom: 16px;
  }
  .bar {
    height: 100%;
    background: linear-gradient(90deg, #14b8a6, #5eead4, #f59e0b);
  }
  .phases {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
  }
  .phase {
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 16px;
    padding: 12px;
    background: rgba(255,255,255,0.03);
  }
  .phase-name {
    font-weight: 700;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .status {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .phase.passed, .phase.done {
    border-color: rgba(34, 197, 94, 0.34);
    box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.08);
  }
  .phase.in_progress {
    border-color: rgba(94, 234, 212, 0.32);
    box-shadow: inset 0 0 0 1px rgba(94, 234, 212, 0.08);
  }
  .phase.awaiting_review, .phase.stale {
    border-color: rgba(245, 158, 11, 0.34);
    box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.08);
  }
  .phase.blocked, .phase.rejected {
    border-color: rgba(249, 115, 22, 0.34);
    box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.08);
  }
  .empty {
    border: 1px dashed var(--line);
    border-radius: 24px;
    padding: 28px;
    text-align: center;
    color: var(--muted);
    background: linear-gradient(180deg, rgba(15, 118, 110, 0.10), rgba(15, 23, 42, 0.08));
  }
  .hidden { display: none; }
  @media (max-width: 760px) {
    body { padding: 20px; }
    .hero { flex-direction: column; align-items: stretch; }
    .badges { justify-content: flex-start; }
  }
</style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <h1>APEX Delivery Control Plane</h1>
        <p class="subtitle">A portfolio and worktree-aware cockpit for explicit epic coordination, local Git signals, and PR review readiness.</p>
      </div>
      <aside class="hero-note">
        <strong>${escapeHtml(indexStateLabel)}</strong>
        <div>Control branch: <code>${escapeHtml(snapshot.controlBranch ?? 'Not configured')}</code></div>
        <div>Current branch: <code>${escapeHtml(snapshot.currentBranch ?? 'Unavailable')}</code></div>
        <div>Index path: <code>${escapeHtml(snapshot.indexPath)}</code></div>
      </aside>
    </section>
    <section class="stats">
      <div class="stat"><strong>${total}</strong><span>Total epics</span></div>
      <div class="stat"><strong>${summary.activeEpics}</strong><span>Active now</span></div>
      <div class="stat"><strong>${pbiEntries.length}</strong><span>Daily PBIs</span></div>
      <div class="stat"><strong>${reviewReadyPbis}</strong><span>Review-ready PBIs</span></div>
      <div class="stat"><strong>${summary.openPullRequests}</strong><span>Linked PRs</span></div>
      <div class="stat"><strong>${summary.localWorktrees}</strong><span>Observed worktrees</span></div>
      <div class="stat"><strong>${summary.missingBranchLinks}</strong><span>Missing branch links</span></div>
      <div class="stat"><strong>${summary.stalePhases}</strong><span>Stale phases</span></div>
    </section>
    <h2 class="section-title">Coordinator Inbox</h2>
    <section class="inbox">
      <div class="inbox-card"><strong>${summary.blockedEpics}</strong><span>Blocked epics</span></div>
      <div class="inbox-card"><strong>${summary.awaitingReview}</strong><span>Awaiting review</span></div>
      <div class="inbox-card"><strong>${summary.readyForRelease}</strong><span>Ready for release</span></div>
      <div class="inbox-card"><strong>${summary.missingBranchLinks}</strong><span>Need branch mapping</span></div>
    </section>
    ${pbiEntries.length > 0 ? `<h2 class="section-title">Daily Work</h2><section class="inbox"><div class="inbox-card"><strong>${pbiEntries.length}</strong><span>Active PBI workflows</span></div><div class="inbox-card"><strong>${reviewReadyPbis}</strong><span>Review-ready</span></div><div class="inbox-card"><strong>${staleHandoffs}</strong><span>Stale CLI handoffs</span></div><div class="inbox-card"><strong>${pbiEntries.filter((entry) => entry.epic.hasBlocked).length}</strong><span>Blocked PBIs</span></div></section>` : ''}
    ${snapshot.warnings.length > 0 ? `<h2 class="section-title">Warnings</h2><section class="warning-list">${snapshot.warnings.map(renderWarning).join('')}</section>` : ''}
    <h2 class="section-title">Portfolio Lanes</h2>
    <section class="filters" aria-label="Dashboard filters">
      <div class="field">
        <label for="ownerFilter">Owner</label>
        <select id="ownerFilter">
          <option value="">All owners</option>
          ${owners.map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="statusFilter">Phase status</label>
        <select id="statusFilter">
          <option value="">All statuses</option>
          ${statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}
        </select>
      </div>
      <div class="toggles">
        <label class="toggle"><input id="blockedFilter" type="checkbox">Blocked</label>
        <label class="toggle"><input id="reviewFilter" type="checkbox">Awaiting review</label>
        <label class="toggle"><input id="openPrFilter" type="checkbox">Open PR</label>
        <label class="toggle"><input id="staleFilter" type="checkbox">Stale</label>
      </div>
      <div id="filterCount" class="filter-count"></div>
    </section>
    <section class="epic-list">
      ${snapshot.entries.length === 0 ? '<div class="empty">No epics found yet. Create an epic from the tree view to see the full APEX workflow.</div>' : snapshot.entries.map(renderEpicEntry).join('')}
    </section>
  </main>
  <script>
    const controls = {
      owner: document.getElementById('ownerFilter'),
      status: document.getElementById('statusFilter'),
      blocked: document.getElementById('blockedFilter'),
      review: document.getElementById('reviewFilter'),
      openPr: document.getElementById('openPrFilter'),
      stale: document.getElementById('staleFilter'),
      count: document.getElementById('filterCount'),
    };
    const cards = Array.from(document.querySelectorAll('[data-epic-card]'));
    function applyFilters() {
      let visible = 0;
      for (const card of cards) {
        const ownerMatch = !controls.owner.value || card.dataset.owners.split('|').includes(controls.owner.value);
        const statusMatch = !controls.status.value || card.dataset.statuses.split('|').includes(controls.status.value);
        const blockedMatch = !controls.blocked.checked || card.dataset.blocked === 'true';
        const reviewMatch = !controls.review.checked || card.dataset.review === 'true';
        const openPrMatch = !controls.openPr.checked || card.dataset.openPr === 'true';
        const staleMatch = !controls.stale.checked || card.dataset.stale === 'true';
        const matches = ownerMatch && statusMatch && blockedMatch && reviewMatch && openPrMatch && staleMatch;
        card.classList.toggle('hidden', !matches);
        if (matches) {
          visible += 1;
        }
      }
      controls.count.textContent = visible + ' of ' + cards.length + ' epics shown';
    }
    Object.values(controls).forEach((control) => {
      if (control && control !== controls.count) {
        control.addEventListener('change', applyFilters);
      }
    });
    applyFilters();
  </script>
</body>
</html>`;
  }
}

function uniqueSorted(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function renderWarning(warning: string): string {
  return `<article class="warning-card"><strong>Portfolio fallback</strong><div>${escapeHtml(warning)}</div></article>`;
}

function renderEpicEntry(entry: PortfolioEpicEntry): string {
  const { epic } = entry;
  const currentPhase = epic.phases[epic.currentPhaseIndex];
  const owners = uniqueSorted([
    epic.coordination?.owner,
    ...epic.phases.map((phase) => phase.owner),
  ]);
  const statuses = uniqueSorted(epic.phases.map((phase) => phase.status));
  const hasStaleSignal = epic.phases.some((phase) => phase.status === 'stale') || hasStalePullRequestSignal(entry);
  const reviewScore = isPbiDeliveryWorkflow(epic.workflowId) ? computePbiReviewScore(epic) : undefined;
  const blockedAge = formatBlockedAge(epic);
  const staleCli = hasStaleHandoff(epic.folderPath);
  const badges = [
    `<span class="badge progress">${epic.progress}% complete</span>`,
    currentPhase ? `<span class="badge progress">Now: ${escapeHtml(currentPhase.name)}</span>` : '<span class="badge progress">Workflow complete</span>',
    epic.hasAwaitingReview ? '<span class="badge review">Needs review</span>' : '',
    epic.hasBlocked ? '<span class="badge blocked">Blocked</span>' : '',
    entry.worktreeSignal ? '<span class="badge signal">Worktree observed</span>' : '',
    reviewScore ? `<span class="badge signal">Review ${reviewScore.score}/100</span>` : '',
    staleCli ? '<span class="badge blocked">Stale handoff</span>' : '',
  ].filter((badge) => badge.length > 0).join('');

  const details = [
    epic.coordination?.owner ? `Owner: ${escapeHtml(epic.coordination.owner)}` : undefined,
    epic.coordination?.team ? `Team: ${escapeHtml(epic.coordination.team)}` : undefined,
    epic.coordination?.priority ? `Priority: ${escapeHtml(epic.coordination.priority)}` : undefined,
    epic.coordination?.coordinationStatus ? `Coordination: ${escapeHtml(epic.coordination.coordinationStatus)}` : undefined,
    entry.linkedBranchNames.length > 0 ? `Branches: ${entry.linkedBranchNames.map((branch) => escapeHtml(branch)).join(', ')}` : 'Branches: Not linked yet',
    `Linked PRs: ${entry.pullRequestCount}`,
    reviewScore ? `Review readiness: ${reviewScore.readiness}` : undefined,
    blockedAge ? `Blocked age: ${escapeHtml(blockedAge)}` : undefined,
  ].filter((line): line is string => Boolean(line)).join(' · ');

  const signalLines = entry.worktreeSignal
    ? [
        `Observed branch: <code>${escapeHtml(entry.worktreeSignal.branchName)}</code>`,
        `Worktree: <code>${escapeHtml(entry.worktreeSignal.worktreePath)}</code>`,
        `Dirty files: ${entry.worktreeSignal.dirtyFiles}`,
        `Last commit: ${escapeHtml(formatTimestamp(entry.worktreeSignal.lastCommitAt))}`,
        `Branch exists locally: ${entry.worktreeSignal.branchExistsLocally ? 'yes' : 'no'}`,
        entry.worktreeSignal.current ? 'Current workspace: yes' : 'Current workspace: no',
        entry.worktreeSignal.error ? `Signal warning: ${escapeHtml(entry.worktreeSignal.error)}` : undefined,
      ].filter((line): line is string => Boolean(line))
    : ['No local worktree observed for the linked branches.'];

  return `<article class="epic" data-epic-card data-owners="${escapeHtml(owners.join('|'))}" data-statuses="${escapeHtml(statuses.join('|'))}" data-blocked="${epic.hasBlocked ? 'true' : 'false'}" data-review="${epic.hasAwaitingReview ? 'true' : 'false'}" data-open-pr="${entry.pullRequestCount > 0 ? 'true' : 'false'}" data-stale="${hasStaleSignal ? 'true' : 'false'}">
    <div class="epic-head">
      <div>
        <div class="epic-title"><span class="epic-key">${escapeHtml(epic.key)}</span> ${escapeHtml(epic.title)}</div>
        <div class="epic-meta">${currentPhase ? `Current phase: ${escapeHtml(currentPhase.name)} · ${escapeHtml(currentPhase.owner)}` : 'All phases complete'}</div>
      </div>
      <div class="badges">${badges}</div>
    </div>
    <div class="progress-track"><div class="bar" style="width:${epic.progress}%"></div></div>
    <div class="epic-details">${details}</div>
    <div class="signal-list">${signalLines.join(' · ')}</div>
    <div class="phases">${epic.phases.map(renderPhase).join('')}</div>
  </article>`;
}

function formatBlockedAge(epic: PortfolioEpicEntry['epic']): string | undefined {
  const blockedPhase = epic.phases.find((phase) => phase.status === 'blocked' || phase.status === 'rejected');
  if (!blockedPhase?.updatedAt) {
    return undefined;
  }

  const blockedAt = new Date(blockedPhase.updatedAt).getTime();
  if (Number.isNaN(blockedAt)) {
    return undefined;
  }

  const ageDays = Math.floor((Date.now() - blockedAt) / (24 * 60 * 60 * 1000));
  return `${ageDays}d`;
}

function hasStaleHandoff(epicFolderPath: string): boolean {
  const handoffDir = path.join(epicFolderPath, 'handoffs', 'copilot-cli');
  if (!fs.existsSync(handoffDir)) {
    return false;
  }

  const files = fs.readdirSync(handoffDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => path.join(handoffDir, entry.name));
  if (files.length === 0) {
    return false;
  }

  const newestMtime = Math.max(...files.map((filePath) => fs.statSync(filePath).mtimeMs));
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return Date.now() - newestMtime > twoDaysMs;
}

function hasStalePullRequestSignal(entry: PortfolioEpicEntry): boolean {
  if (entry.pullRequestCount === 0 || !entry.worktreeSignal?.lastCommitAt) {
    return false;
  }

  const lastCommitTime = new Date(entry.worktreeSignal.lastCommitAt).getTime();
  if (Number.isNaN(lastCommitTime)) {
    return false;
  }

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - lastCommitTime > sevenDaysMs;
}

function renderPhase(phase: { name: string; owner: string; status: string }): string {
  return `<div class="phase ${escapeHtml(phase.status)}">
    <div class="phase-name">${escapeHtml(phase.name)}</div>
    <div class="status">${escapeHtml(phase.status)}<br>${escapeHtml(phase.owner)}</div>
  </div>`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return 'Unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString()}`;
}
