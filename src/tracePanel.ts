import * as vscode from 'vscode';
import { escapeHtml } from './html';

export interface VerificationTraceRecord {
  kind: 'build' | 'test' | 'lint';
  outcome: 'passed' | 'failed' | 'skipped';
  command?: string;
  output: string;
  durationMs: number;
  source: string;
}

export interface PhaseRunTraceEntry {
  id: string;
  startedAt: string;
  epicKey: string;
  epicTitle: string;
  workflowId?: string;
  workflowName?: string;
  phaseId: string;
  phaseName: string;
  artifactPath: string;
  executionPath: 'agent-chat' | 'direct-model' | 'chat-fallback' | 'artifact-proposal';
  result: string;
  prompt: string;
  contextFiles: readonly string[];
  preferredAgent?: string;
  activeAgent?: string;
  agentSelectionStatus?: 'not-configured' | 'unavailable' | 'matched' | 'mismatched';
  agentSelectionNote?: string;
  userRole?: string;
  preferredRole?: string;
  roleRoutingStatus?: 'not-configured' | 'not-required' | 'matched' | 'mismatched';
  roleRoutingNote?: string;
  fallbackReason?: string;
  modelLabel?: string;
  verification: readonly VerificationTraceRecord[];
}

export class TracePanel {
  private static currentPanel: TracePanel | undefined;

  private constructor(private readonly panel: vscode.WebviewPanel) {
    this.panel.onDidDispose(() => {
      TracePanel.currentPanel = undefined;
    });
  }

  static show(entries: readonly PhaseRunTraceEntry[]): void {
    if (TracePanel.currentPanel) {
      TracePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      TracePanel.currentPanel.update(entries);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'apexDeliveryTracePanel',
      'APEX Developer Trace',
      vscode.ViewColumn.One,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    TracePanel.currentPanel = new TracePanel(panel);
    TracePanel.currentPanel.update(entries);
  }

  static updateIfVisible(entries: readonly PhaseRunTraceEntry[]): void {
    if (!TracePanel.currentPanel) {
      return;
    }

    TracePanel.currentPanel.update(entries);
  }

  private update(entries: readonly PhaseRunTraceEntry[]): void {
    this.panel.webview.html = render(entries);
  }
}

function render(entries: readonly PhaseRunTraceEntry[]): string {
  const total = entries.length;
  const withFallback = entries.filter((entry) => typeof entry.fallbackReason === 'string' && entry.fallbackReason.length > 0).length;
  const applied = entries.filter((entry) => entry.executionPath === 'artifact-proposal' && entry.result.toLowerCase().includes('applied')).length;
  const direct = entries.filter((entry) => entry.executionPath === 'direct-model').length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>APEX Developer Trace</title>
<style>
  :root {
    --surface: color-mix(in srgb, var(--vscode-editor-background) 86%, #172554 14%);
    --line: color-mix(in srgb, var(--vscode-panel-border) 64%, #38bdf8 36%);
    --accent: #38bdf8;
    --accent-soft: rgba(56, 189, 248, 0.14);
    --success: #22c55e;
    --warning: #f59e0b;
    --danger: #f97316;
    --muted: var(--vscode-descriptionForeground);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--vscode-foreground);
    font-family: Aptos, 'Segoe UI Variable', 'Segoe UI', sans-serif;
    background:
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.18), transparent 28%),
      radial-gradient(circle at bottom left, rgba(245, 158, 11, 0.10), transparent 24%),
      var(--vscode-editor-background);
    padding: 24px;
  }
  .shell { max-width: 1180px; margin: 0 auto; }
  .hero { margin-bottom: 20px; }
  h1 {
    margin: 0 0 8px;
    font-size: 30px;
    letter-spacing: -0.03em;
  }
  .subtitle {
    margin: 0;
    color: var(--muted);
    max-width: 760px;
    line-height: 1.5;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 20px;
  }
  .stat, .entry {
    border: 1px solid var(--line);
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
  }
  .stat { padding: 18px; }
  .stat strong {
    display: block;
    font-size: 28px;
    letter-spacing: -0.04em;
    margin-bottom: 4px;
  }
  .stat span { color: var(--muted); font-size: 13px; }
  .entry-list { display: grid; gap: 18px; }
  .entry { padding: 18px; background: linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(2, 132, 199, 0.05)); }
  .entry-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 14px;
  }
  .entry-title { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
  .entry-meta { color: var(--muted); font-size: 13px; line-height: 1.5; }
  .badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
  .badge {
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 700;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid rgba(56, 189, 248, 0.28);
  }
  .badge.failed { background: rgba(249, 115, 22, 0.14); color: #fdba74; border-color: rgba(249, 115, 22, 0.28); }
  .badge.applied { background: rgba(34, 197, 94, 0.14); color: #86efac; border-color: rgba(34, 197, 94, 0.26); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
  }
  .card {
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 18px;
    padding: 14px;
    background: rgba(255,255,255,0.03);
  }
  .card h2 {
    margin: 0 0 10px;
    font-size: 13px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--muted);
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: Consolas, 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.55;
    background: rgba(15, 23, 42, 0.46);
    border-radius: 14px;
    padding: 12px;
    border: 1px solid rgba(255,255,255,0.08);
  }
  ul {
    margin: 0;
    padding-left: 18px;
    color: var(--vscode-foreground);
  }
  li { margin: 0 0 8px; }
  .verification-grid { display: grid; gap: 12px; }
  .verification-item {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 12px;
    background: rgba(15, 23, 42, 0.34);
  }
  .verification-item strong { display: block; margin-bottom: 6px; }
  .verification-item span { color: var(--muted); display: block; margin-bottom: 8px; font-size: 12px; }
  .empty {
    border: 1px dashed var(--line);
    border-radius: 24px;
    padding: 28px;
    text-align: center;
    color: var(--muted);
    background: linear-gradient(180deg, rgba(2, 132, 199, 0.12), rgba(15, 23, 42, 0.08));
  }
</style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <h1>APEX Developer Trace</h1>
      <p class="subtitle">Inspect phase prompts, context files, execution paths, fallback reasons, and verification outcomes across recent runs.</p>
    </section>
    <section class="stats">
      <div class="stat"><strong>${total}</strong><span>Total recorded runs</span></div>
      <div class="stat"><strong>${direct}</strong><span>Direct model runs</span></div>
      <div class="stat"><strong>${applied}</strong><span>Applied artifact proposals</span></div>
      <div class="stat"><strong>${withFallback}</strong><span>Runs with fallback reasons</span></div>
    </section>
    <section class="entry-list">
      ${entries.length === 0 ? '<div class="empty">No phase runs recorded yet. Run a phase or propose an artifact update to populate this developer trace.</div>' : entries.map(renderEntry).join('')}
    </section>
  </main>
</body>
</html>`;
}

function renderEntry(entry: PhaseRunTraceEntry): string {
  const failedVerification = entry.verification.some((record) => record.outcome === 'failed');
  const appliedProposal = entry.executionPath === 'artifact-proposal' && entry.result.toLowerCase().includes('applied');
  const workflowLabel = entry.workflowName
    ? `${entry.workflowName}${entry.workflowId ? ` (${entry.workflowId})` : ''}`
    : 'Default workflow';

  return `<article class="entry">
    <div class="entry-head">
      <div>
        <div class="entry-title">${escapeHtml(entry.epicKey)} · ${escapeHtml(entry.phaseName)}</div>
        <div class="entry-meta">
          ${escapeHtml(entry.epicTitle)}<br>
          Workflow: ${escapeHtml(workflowLabel)}<br>
          ${escapeHtml(formatDateTime(entry.startedAt))} · ${escapeHtml(entry.executionPath)} · ${escapeHtml(entry.artifactPath)}${entry.preferredAgent ? `<br>Preferred Agent: ${escapeHtml(entry.preferredAgent)}` : ''}${entry.userRole ? `<br>User Role: ${escapeHtml(entry.userRole)}` : ''}${entry.preferredRole ? `<br>Preferred Role: ${escapeHtml(entry.preferredRole)}` : ''}
        </div>
      </div>
      <div class="badges">
        <span class="badge ${failedVerification ? 'failed' : appliedProposal ? 'applied' : ''}">${escapeHtml(entry.result)}</span>
        ${entry.modelLabel ? `<span class="badge">${escapeHtml(entry.modelLabel)}</span>` : ''}
      </div>
    </div>
    <div class="grid">
      <section class="card">
        <h2>Prompt</h2>
        <pre>${escapeHtml(entry.prompt)}</pre>
      </section>
      <section class="card">
        <h2>Context Files</h2>
        ${entry.contextFiles.length === 0 ? '<div class="entry-meta">No context files recorded.</div>' : `<ul>${entry.contextFiles.map((filePath) => `<li>${escapeHtml(filePath)}</li>`).join('')}</ul>`}
      </section>
      <section class="card">
        <h2>Decision</h2>
        <div class="entry-meta">Path: ${escapeHtml(entry.executionPath)}</div>
        <div class="entry-meta">Result: ${escapeHtml(entry.result)}</div>
        <div class="entry-meta">Agent check: ${escapeHtml(entry.agentSelectionStatus ?? 'not-configured')}</div>
        ${entry.activeAgent ? `<div class="entry-meta">Active agent: ${escapeHtml(entry.activeAgent)}</div>` : ''}
        ${entry.agentSelectionNote ? `<div class="entry-meta">${escapeHtml(entry.agentSelectionNote)}</div>` : ''}
        <div class="entry-meta">Role routing: ${escapeHtml(entry.roleRoutingStatus ?? 'not-configured')}</div>
        ${entry.roleRoutingNote ? `<div class="entry-meta">${escapeHtml(entry.roleRoutingNote)}</div>` : ''}
        <div class="entry-meta">Fallback: ${escapeHtml(entry.fallbackReason ?? 'None')}</div>
      </section>
      <section class="card">
        <h2>Verification</h2>
        <div class="verification-grid">
          ${entry.verification.map(renderVerificationRecord).join('')}
        </div>
      </section>
    </div>
  </article>`;
}

function renderVerificationRecord(record: VerificationTraceRecord): string {
  return `<div class="verification-item">
    <strong>${escapeHtml(record.kind.toUpperCase())} · ${escapeHtml(record.outcome)}</strong>
    <span>${escapeHtml(record.command ?? 'Not configured')} · ${escapeHtml(record.source)} · ${escapeHtml(formatDuration(record.durationMs))}</span>
    <pre>${escapeHtml(record.output)}</pre>
  </div>`;
}

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}