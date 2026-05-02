import * as vscode from 'vscode';
import { EpicStatus, PhaseStatus } from './pipelineModel';
import { escapeHtml } from './html';

export class DashboardPanel {
  private static currentPanel: DashboardPanel | undefined;

  private constructor(private readonly panel: vscode.WebviewPanel) {
    this.panel.onDidDispose(() => {
      DashboardPanel.currentPanel = undefined;
    });
  }

  static show(epics: EpicStatus[]): void {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      DashboardPanel.currentPanel.update(epics);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'apexDeliveryDashboard',
      'APEX Delivery Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    DashboardPanel.currentPanel = new DashboardPanel(panel);
    DashboardPanel.currentPanel.update(epics);
  }

  private update(epics: EpicStatus[]): void {
    this.panel.webview.html = this.render(epics);
  }

  private render(epics: EpicStatus[]): string {
    const total = epics.length;
    const completed = epics.filter((epic) => epic.progress === 100).length;
    const active = epics.filter((epic) => epic.progress > 0 && epic.progress < 100).length;
    const blocked = epics.filter((epic) => epic.hasBlocked).length;
    const awaitingReview = epics.filter((epic) => epic.hasAwaitingReview).length;

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
  .shell { max-width: 1120px; margin: 0 auto; }
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
    max-width: 680px;
    margin: 0;
    line-height: 1.5;
  }
  .hero-note {
    border: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(15, 118, 110, 0.16), rgba(8, 47, 73, 0.10));
    border-radius: 18px;
    padding: 14px 16px;
    min-width: 250px;
    color: var(--muted);
  }
  .hero-note strong {
    display: block;
    margin-bottom: 6px;
    color: var(--vscode-foreground);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 22px;
  }
  .stat, .epic {
    border: 1px solid var(--line);
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
    backdrop-filter: blur(12px);
  }
  .stat {
    padding: 18px;
  }
  .stat strong {
    display: block;
    font-size: 28px;
    letter-spacing: -0.04em;
    margin-bottom: 4px;
  }
  .stat span {
    color: var(--muted);
    font-size: 13px;
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
  .epic-meta {
    color: var(--muted);
    font-size: 13px;
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
        <h1>APEX Delivery Dashboard</h1>
        <p class="subtitle">A Copilot-first cockpit for file-based epics, phase gates, and spec-driven delivery progress.</p>
      </div>
      <aside class="hero-note">
        <strong>Live workflow surface</strong>
        Tree items now auto-refresh when phase artifacts or status files change, so this dashboard stays in sync with the working folder.
      </aside>
    </section>
    <section class="stats">
      <div class="stat"><strong>${total}</strong><span>Total epics</span></div>
      <div class="stat"><strong>${active}</strong><span>Active now</span></div>
      <div class="stat"><strong>${completed}</strong><span>Complete</span></div>
      <div class="stat"><strong>${awaitingReview}</strong><span>Awaiting review</span></div>
      <div class="stat"><strong>${blocked}</strong><span>Blocked or rejected</span></div>
    </section>
    <section class="epic-list">
      ${epics.length === 0 ? '<div class="empty">No epics found yet. Create a sample epic from the tree view to see the full APEX workflow.</div>' : epics.map(renderEpic).join('')}
    </section>
  </main>
</body>
</html>`;
  }
}

function renderEpic(epic: EpicStatus): string {
  const currentPhase = epic.phases[epic.currentPhaseIndex];
  const badges = [
    `<span class="badge progress">${epic.progress}% complete</span>`,
    currentPhase ? `<span class="badge progress">Now: ${escapeHtml(currentPhase.name)}</span>` : '<span class="badge progress">Workflow complete</span>',
    epic.hasAwaitingReview ? '<span class="badge review">Needs review</span>' : '',
    epic.hasBlocked ? '<span class="badge blocked">Blocked</span>' : '',
  ].filter((badge) => badge.length > 0).join('');

  return `<article class="epic">
    <div class="epic-head">
      <div>
        <div class="epic-title"><span class="epic-key">${escapeHtml(epic.key)}</span> ${escapeHtml(epic.title)}</div>
        <div class="epic-meta">${currentPhase ? `Current phase: ${escapeHtml(currentPhase.name)} · ${escapeHtml(currentPhase.owner)}` : 'All phases complete'}</div>
      </div>
      <div class="badges">${badges}</div>
    </div>
    <div class="progress-track"><div class="bar" style="width:${epic.progress}%"></div></div>
    <div class="phases">${epic.phases.map(renderPhase).join('')}</div>
  </article>`;
}

function renderPhase(phase: PhaseStatus): string {
  return `<div class="phase ${escapeHtml(phase.status)}">
    <div class="phase-name">${escapeHtml(phase.name)}</div>
    <div class="status">${escapeHtml(phase.status)} · ${escapeHtml(phase.gate)}<br>${escapeHtml(phase.owner)}</div>
  </div>`;
}
