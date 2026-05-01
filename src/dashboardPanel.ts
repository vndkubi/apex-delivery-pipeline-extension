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
    const blocked = epics.filter((epic) => epic.hasBlocked).length;
    const awaitingReview = epics.filter((epic) => epic.hasAwaitingReview).length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>APEX Delivery Dashboard</title>
<style>
  body {
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    padding: 24px;
  }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat, .epic { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 14px; background: var(--vscode-sideBar-background); }
  .stat strong { display: block; font-size: 24px; margin-bottom: 4px; }
  .epic { margin-bottom: 14px; }
  .epic-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 10px; }
  .epic-title { font-weight: 600; }
  .progress { height: 8px; background: var(--vscode-input-background); border-radius: 999px; overflow: hidden; margin-bottom: 12px; }
  .bar { height: 100%; background: var(--vscode-progressBar-background); }
  .phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .phase { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; }
  .phase-name { font-weight: 600; font-size: 12px; }
  .status { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
  .passed { border-color: var(--vscode-testing-iconPassed); }
  .blocked, .rejected { border-color: var(--vscode-testing-iconFailed); }
  .awaiting_review { border-color: var(--vscode-charts-orange); }
</style>
</head>
<body>
  <h1>APEX Delivery Dashboard</h1>
  <div class="subtitle">File-based AI delivery workflow status with APEX quality gates.</div>
  <section class="stats">
    <div class="stat"><strong>${total}</strong>Total epics</div>
    <div class="stat"><strong>${completed}</strong>Complete</div>
    <div class="stat"><strong>${awaitingReview}</strong>Awaiting review</div>
    <div class="stat"><strong>${blocked}</strong>Blocked or rejected</div>
  </section>
  <section>
    ${epics.length === 0 ? '<p>No epics found. Create a sample epic from the tree view.</p>' : epics.map(renderEpic).join('')}
  </section>
</body>
</html>`;
  }
}

function renderEpic(epic: EpicStatus): string {
  return `<article class="epic">
    <div class="epic-head">
      <div class="epic-title">${escapeHtml(epic.key)} - ${escapeHtml(epic.title)}</div>
      <div>${epic.progress}%</div>
    </div>
    <div class="progress"><div class="bar" style="width:${epic.progress}%"></div></div>
    <div class="phases">${epic.phases.map(renderPhase).join('')}</div>
  </article>`;
}

function renderPhase(phase: PhaseStatus): string {
  return `<div class="phase ${escapeHtml(phase.status)}">
    <div class="phase-name">${escapeHtml(phase.name)}</div>
    <div class="status">${escapeHtml(phase.status)} - ${escapeHtml(phase.gate)}</div>
  </div>`;
}
