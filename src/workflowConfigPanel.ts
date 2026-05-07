import * as path from 'path';
import * as vscode from 'vscode';
import { parseWorkflowDefinitions } from './workflowModel';
import {
  buildWorkflowEditorDraft,
  buildWorkflowPresetDrafts,
  createEmptyPhaseDraft,
  createEmptyWorkflowDraft,
  listBundledTemplateRefs,
  serializeWorkflowEditorDraft,
  validateWorkflowEditorDraft,
  type WorkflowEditorValidationIssue,
  type WorkflowEditorDraft,
} from './workflowConfigModel';
import {
  buildPhasePromptSurfaces,
  normalizeStarterPromptPlacement,
  resolvePhaseRunPlan,
  type PhaseRunPreferenceSources,
  type PhaseRunPreferences,
} from './phaseRunPlan';
import { ensureWorkspaceTextRefFile } from './workspaceTextRef';

interface WorkflowConfigPanelOptions {
  workspaceRoot: string;
  templateRoot: string;
  output: vscode.OutputChannel;
  onDidSave: () => void;
}

interface WorkflowConfigMessage {
  type: 'save' | 'reload' | 'pickWorkspaceTemplate' | 'preview';
  draft?: WorkflowEditorDraft;
  workflowIndex?: number;
  phaseIndex?: number;
}

interface WorkflowRuntimePreview {
  provider: string;
  roleLabel: string;
  autoSubmitLabel: string;
  preferredChatAgent?: string;
  agentTag?: string;
  starterPromptPlacement: string;
  promptSurfaces: {
    scopedChat: string;
    agent: string;
    cli: string;
  };
  defaultSurface: 'scopedChat' | 'agent' | 'cli';
  sources: PhaseRunPreferenceSources;
}

export class WorkflowConfigPanel {
  private static currentPanel: WorkflowConfigPanel | undefined;

  private readonly bundledTemplates: readonly string[];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly options: WorkflowConfigPanelOptions,
  ) {
    this.bundledTemplates = listBundledTemplateRefs(options.templateRoot);

    this.panel.onDidDispose(() => {
      WorkflowConfigPanel.currentPanel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: WorkflowConfigMessage) => {
      void this.handleMessage(message);
    });
  }

  static show(options: WorkflowConfigPanelOptions): void {
    if (WorkflowConfigPanel.currentPanel) {
      WorkflowConfigPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      WorkflowConfigPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'apexDeliveryWorkflowConfig',
      'APEX Workflow Configuration',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    WorkflowConfigPanel.currentPanel = new WorkflowConfigPanel(panel, options);
    WorkflowConfigPanel.currentPanel.update();
  }

  private async handleMessage(message: WorkflowConfigMessage): Promise<void> {
    switch (message.type) {
      case 'reload':
        await this.postState('Reloaded workspace workflow configuration.');
        return;
      case 'preview':
        if (!message.draft) {
          return;
        }
        await this.postPreviewState(message.draft);
        return;
      case 'pickWorkspaceTemplate':
        await this.pickWorkspaceTemplate(message.workflowIndex, message.phaseIndex);
        return;
      case 'save':
        if (!message.draft) {
          return;
        }
        await this.saveDraft(message.draft);
        return;
      default:
        return;
    }
  }

  private async saveDraft(draft: WorkflowEditorDraft): Promise<void> {
    const materialized = materializeFileBackedDraft(draft, this.options.workspaceRoot);
    const issues = [
      ...materialized.issues,
      ...validateWorkflowEditorDraft(materialized.draft, this.options.workspaceRoot, this.options.templateRoot),
    ];
    if (issues.length > 0) {
      await this.panel.webview.postMessage({
        type: 'validation',
        issues,
        message: 'Fix the highlighted workflow fields before saving.',
      });
      return;
    }

    try {
      const serialized = serializeWorkflowEditorDraft(materialized.draft);
      const configuration = vscode.workspace.getConfiguration('apexDelivery');
      await configuration.update('workflowDefinitions', serialized, vscode.ConfigurationTarget.Workspace);

      const reloaded = parseWorkflowDefinitions(configuration.get<unknown>('workflowDefinitions', {}), {
        workspaceRoot: this.options.workspaceRoot,
      });
      if (reloaded.errors.length > 0) {
        throw new Error(reloaded.errors.join(' '));
      }

      this.options.output.appendLine(`[Workflow UI] Saved ${draft.workflows.length} workspace workflows.`);
      this.options.onDidSave();
      await this.postState('Saved workflow configuration to workspace settings.');
      void vscode.window.showInformationMessage('Saved APEX workflow configuration.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[Workflow UI] Save failed: ${message}`);
      await this.panel.webview.postMessage({
        type: 'saveError',
        message: `Unable to save workspace workflows: ${message}`,
      });
      void vscode.window.showErrorMessage(`Unable to save APEX workflow configuration: ${message}`);
    }
  }

  private async pickWorkspaceTemplate(workflowIndex: number | undefined, phaseIndex: number | undefined): Promise<void> {
    if (workflowIndex === undefined || phaseIndex === undefined) {
      return;
    }

    const selection = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: vscode.Uri.file(this.options.workspaceRoot),
      filters: { Markdown: ['md'] },
      openLabel: 'Use Template',
    });

    const selectedPath = selection?.[0]?.fsPath;
    if (!selectedPath) {
      return;
    }

    const relativePath = path.relative(this.options.workspaceRoot, selectedPath).replaceAll('\\', '/');
    await this.panel.webview.postMessage({
      type: 'workspaceTemplatePicked',
      workflowIndex,
      phaseIndex,
      templateRef: relativePath,
    });
  }

  private update(): void {
    const draft = this.readDraft();
    this.panel.webview.html = buildWorkflowConfigPanelHtml(this.panel.webview, draft, this.bundledTemplates, this.options.workspaceRoot);
  }

  private async postState(message: string): Promise<void> {
    const draft = this.readDraft();
    await this.panel.webview.postMessage({
      type: 'state',
      draft,
      runtimePreviews: buildWorkflowRuntimePreviews(draft, this.options.workspaceRoot),
      message,
    });
  }

  private async postPreviewState(draft: WorkflowEditorDraft): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'previewState',
      runtimePreviews: buildWorkflowRuntimePreviews(draft, this.options.workspaceRoot),
    });
  }

  private readDraft(): WorkflowEditorDraft {
    const rawDefinitions = vscode.workspace.getConfiguration('apexDelivery').get<unknown>('workflowDefinitions', {});
    const parsed = parseWorkflowDefinitions(rawDefinitions, { workspaceRoot: this.options.workspaceRoot });
    for (const error of parsed.errors) {
      this.options.output.appendLine(`[Workflow UI] ${error}`);
    }

    return buildWorkflowEditorDraft(parsed.workflows.filter((workflow) => workflow.source === 'workspace'));
  }
}

export function buildWorkflowConfigPanelHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  draft: WorkflowEditorDraft,
  bundledTemplates: readonly string[],
  workspaceRoot: string,
): string {
  const nonce = createNonce();
  const initialState = JSON.stringify({
    draft,
    bundledTemplates,
    presetWorkflows: buildWorkflowPresetDrafts(),
    rolePresets: ['BA', 'Tech Lead', 'Developer', 'Reviewer', 'QA', 'Release Manager'],
    runtimeContext: buildRuntimePreviewContext(),
    runtimePreviews: buildWorkflowRuntimePreviews(draft, workspaceRoot),
    factory: {
      createEmptyWorkflowDraft: createEmptyWorkflowDraft(0),
      createEmptyPhaseDraft: createEmptyPhaseDraft(0),
    },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>APEX Workflow Configuration</title>
<style>
  :root {
    --surface: color-mix(in srgb, var(--vscode-editor-background) 88%, #14532d 12%);
    --surface-strong: color-mix(in srgb, var(--vscode-sideBar-background) 76%, #1d4ed8 24%);
    --line: color-mix(in srgb, var(--vscode-panel-border) 72%, #38bdf8 28%);
    --accent: #38bdf8;
    --accent-soft: rgba(56, 189, 248, 0.12);
    --danger: #fb7185;
    --warning: #f59e0b;
    --success: #22c55e;
    --muted: var(--vscode-descriptionForeground);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--vscode-foreground);
    font-family: Aptos, 'Segoe UI Variable', 'Segoe UI', sans-serif;
    background:
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.14), transparent 24%),
      radial-gradient(circle at bottom left, rgba(34, 197, 94, 0.10), transparent 22%),
      var(--vscode-editor-background);
  }
  .shell { max-width: 1240px; margin: 0 auto; padding: 24px; }
  .hero {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    align-items: flex-start;
    margin-bottom: 18px;
  }
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
  .hero-note {
    min-width: 280px;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 16px;
    background: linear-gradient(180deg, rgba(17, 24, 39, 0.24), rgba(30, 64, 175, 0.10));
    color: var(--muted);
  }
  .hero-note strong { display: block; color: var(--vscode-foreground); margin-bottom: 6px; }
  .toolbar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .toolbar-left, .toolbar-right {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  button {
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 10px 14px;
    font: inherit;
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button.secondary {
    color: var(--vscode-foreground);
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.10);
  }
  button.ghost {
    color: var(--muted);
    background: transparent;
    border-color: rgba(255,255,255,0.08);
  }
  button.danger {
    background: rgba(225, 29, 72, 0.14);
    color: #fecdd3;
    border-color: rgba(251, 113, 133, 0.28);
  }
  button.preview-surface {
    padding: 8px 12px;
  }
  button.preview-surface.is-active {
    background: color-mix(in srgb, var(--vscode-button-background) 72%, #38bdf8 28%);
    border-color: rgba(56, 189, 248, 0.45);
    color: var(--vscode-button-foreground);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .status {
    border-radius: 14px;
    padding: 12px 14px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    color: var(--muted);
    margin-bottom: 18px;
    display: none;
  }
  .status.visible { display: block; }
  .status.error {
    border-color: rgba(251, 113, 133, 0.32);
    color: #fecdd3;
    background: rgba(225, 29, 72, 0.12);
  }
  .status.success {
    border-color: rgba(34, 197, 94, 0.32);
    color: #bbf7d0;
    background: rgba(34, 197, 94, 0.10);
  }
  .workflow-list {
    display: grid;
    gap: 18px;
  }
  .workflow {
    border: 1px solid var(--line);
    border-radius: 24px;
    padding: 18px;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(2, 132, 199, 0.05));
  }
  .workflow-head, .phase-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 14px;
  }
  .workflow-head h2, .phase-head h3 {
    margin: 0 0 4px;
  }
  .workflow-head p, .phase-head p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }
  .phase-list {
    display: grid;
    gap: 14px;
    margin-top: 12px;
  }
  .phase {
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 18px;
    padding: 16px;
    background: rgba(255,255,255,0.03);
  }
  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .field-grid.full {
    grid-template-columns: 1fr;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .field.full-span {
    grid-column: 1 / -1;
  }
  label {
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input, select, textarea {
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(15, 23, 42, 0.44);
    color: var(--vscode-input-foreground);
    padding: 10px 12px;
    font: inherit;
  }
  textarea { min-height: 94px; resize: vertical; }
  .field input.invalid, .field select.invalid, .field textarea.invalid {
    border-color: rgba(251, 113, 133, 0.55);
    box-shadow: inset 0 0 0 1px rgba(251, 113, 133, 0.16);
  }
  .error {
    min-height: 16px;
    font-size: 12px;
    color: #fecdd3;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.45;
  }
  .phase-actions, .workflow-actions, .template-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .section-title {
    margin: 18px 0 10px;
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .autopilot-note {
    margin-top: 10px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .empty {
    border: 1px dashed var(--line);
    border-radius: 24px;
    padding: 28px;
    text-align: center;
    color: var(--muted);
    background: linear-gradient(180deg, rgba(2, 132, 199, 0.12), rgba(15, 23, 42, 0.08));
  }
  @media (max-width: 820px) {
    .shell { padding: 18px; }
    .hero { flex-direction: column; }
  }
</style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <h1>APEX Workflow Configuration</h1>
        <p class="subtitle">Edit workspace workflows, per-phase template routing, file-backed prompt sources, and run defaults without hand-editing JSON. Chat agent fields remain best-effort, while auto-submit, model family, and starter prompts are applied by the extension.</p>
      </div>
      <aside class="hero-note">
        <strong>Persistence</strong>
        Saves to the workspace setting <code>apexDelivery.workflowDefinitions</code>. The built-in default workflow is always available and is not edited here.
      </aside>
    </section>
    <section class="toolbar">
      <div class="toolbar-left">
        <button type="button" class="secondary" data-action="add-workflow">Add Workflow</button>
        <button type="button" class="secondary" data-action="add-pbi-preset">Add PBI Delivery Preset</button>
        <button type="button" class="ghost" data-action="reload">Reload From Settings</button>
      </div>
      <div class="toolbar-right">
        <span id="summary" class="hint"></span>
        <button type="button" id="saveButton" data-action="save">Save Workflows</button>
      </div>
    </section>
    <div id="status" class="status" role="status" aria-live="polite"></div>
    <section id="app"></section>
    <datalist id="rolePresetList">
      ${['BA', 'Tech Lead', 'Developer', 'Reviewer', 'QA', 'Release Manager'].map((role) => `<option value="${role}"></option>`).join('')}
    </datalist>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const initial = ${initialState};
    let draft = deepClone(initial.draft);
    let bundledTemplates = [...initial.bundledTemplates];
    let runtimePreviews = deepClone(initial.runtimePreviews || {});
    let hostIssues = [];
    let previewUpdateTimer;

    document.body.addEventListener('click', onClick);
    document.body.addEventListener('input', onFieldChange);
    document.body.addEventListener('change', onFieldChange);
    window.addEventListener('message', onMessage);

    render();

    function onMessage(event) {
      const message = event.data;
      if (!message || typeof message.type !== 'string') {
        return;
      }

      if (message.type === 'state' && message.draft) {
        draft = deepClone(message.draft);
        runtimePreviews = deepClone(message.runtimePreviews || {});
        hostIssues = [];
        setStatus(message.message, 'success');
        render();
        return;
      }

      if (message.type === 'previewState') {
        runtimePreviews = deepClone(message.runtimePreviews || {});
        paintRuntimePreviews();
        return;
      }

      if (message.type === 'validation') {
        hostIssues = Array.isArray(message.issues) ? message.issues : [];
        setStatus(message.message, 'error');
        paintValidation();
        return;
      }

      if (message.type === 'saveError') {
        setStatus(message.message, 'error');
        return;
      }

      if (message.type === 'workspaceTemplatePicked') {
        const phase = draft.workflows?.[message.workflowIndex]?.phases?.[message.phaseIndex];
        if (!phase) {
          return;
        }
        phase.templateMode = 'workspace';
        phase.templateRef = message.templateRef || '';
        hostIssues = [];
        render();
        schedulePreviewUpdate();
      }
    }

    function onClick(event) {
      if (!(event.target instanceof Element)) {
        return;
      }

      const target = event.target.closest('[data-action]');
      if (!target) {
        return;
      }

      const action = target.dataset.action;
      const workflowIndex = toNumber(target.dataset.workflowIndex);
      const phaseIndex = toNumber(target.dataset.phaseIndex);

      if (action === 'set-preview-surface') {
        const container = target.closest('[data-preview-key]');
        if (container instanceof HTMLElement && target.dataset.surface) {
          container.dataset.previewSurface = target.dataset.surface;
          paintRuntimePreviews();
        }
        return;
      }

      if (action === 'add-workflow') {
        draft.workflows.push(createWorkflowDraft(draft.workflows.length));
        hostIssues = [];
        render();
        return;
      }

      if (action === 'add-pbi-preset') {
        const preset = deepClone(initial.presetWorkflows[0]);
        if (!preset) {
          return;
        }
        preset.id = uniqueWorkflowId(preset.id);
        preset.name = uniqueWorkflowName(preset.name);
        draft.workflows.push(preset);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'reload') {
        vscode.postMessage({ type: 'reload' });
        return;
      }

      if (action === 'save') {
        const issues = validateDraft(draft);
        hostIssues = [];
        if (issues.length > 0) {
          setStatus('Fix the highlighted workflow fields before saving.', 'error');
          paintValidation();
          return;
        }

        setStatus('Saving workflow configuration...', 'success');
        vscode.postMessage({ type: 'save', draft });
        return;
      }

      if (workflowIndex === undefined) {
        return;
      }

      const workflow = draft.workflows[workflowIndex];
      if (!workflow) {
        return;
      }

      if (action === 'remove-workflow') {
        draft.workflows.splice(workflowIndex, 1);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'duplicate-workflow') {
        const duplicated = duplicateWorkflow(workflow, workflowIndex);
        draft.workflows.splice(workflowIndex + 1, 0, duplicated);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'move-workflow-up' && workflowIndex > 0) {
        swap(draft.workflows, workflowIndex, workflowIndex - 1);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'move-workflow-down' && workflowIndex < draft.workflows.length - 1) {
        swap(draft.workflows, workflowIndex, workflowIndex + 1);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'add-phase') {
        workflow.phases.push(createPhaseDraft(workflow.phases.length));
        hostIssues = [];
        render();
        return;
      }

      if (phaseIndex === undefined) {
        return;
      }

      if (action === 'remove-phase') {
        workflow.phases.splice(phaseIndex, 1);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'move-phase-up' && phaseIndex > 0) {
        swap(workflow.phases, phaseIndex, phaseIndex - 1);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'move-phase-down' && phaseIndex < workflow.phases.length - 1) {
        swap(workflow.phases, phaseIndex, phaseIndex + 1);
        hostIssues = [];
        render();
        return;
      }

      if (action === 'pick-template') {
        vscode.postMessage({ type: 'pickWorkspaceTemplate', workflowIndex, phaseIndex });
      }
    }

    function onFieldChange(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        return;
      }

      const workflowIndex = toNumber(target.dataset.workflowIndex);
      if (workflowIndex === undefined) {
        return;
      }

      const workflow = draft.workflows[workflowIndex];
      if (!workflow) {
        return;
      }

      const phaseIndex = toNumber(target.dataset.phaseIndex);
      const scope = target.dataset.scope;
      const field = target.dataset.field;
      if (!field) {
        return;
      }

      if (scope === 'workflow') {
        if (field.startsWith('execution.')) {
          setNestedValue(workflow, field, target.value);
          workflow.execution.configured = true;
        } else {
          workflow[field] = target.value;
        }
        hostIssues = [];
        paintValidation();
        return;
      }

      const phase = workflow.phases[phaseIndex];
      if (!phase) {
        return;
      }

      if (field === 'templateMode') {
        phase.templateMode = target.value;
        if (phase.templateMode === 'artifact') {
          phase.templateRef = '';
        } else if (!phase.templateRef && phase.templateMode === 'bundled' && bundledTemplates.length > 0) {
          phase.templateRef = bundledTemplates[0];
        }
        hostIssues = [];
        render();
        return;
      }

      if (field === 'outputMode') {
        phase.outputMode = target.value;
        hostIssues = [];
        render();
        return;
      }

      if (field === 'sessionDefaults.starterPromptMode') {
        phase.sessionDefaults.starterPromptMode = target.value;
        hostIssues = [];
        render();
        return;
      }

      if (field === 'enabled') {
        phase.enabled = target.checked;
        hostIssues = [];
        paintValidation();
        return;
      }

      if (field.startsWith('sessionDefaults.')) {
        const key = field.replace('sessionDefaults.', '');
        phase.sessionDefaults[key] = target.value;
      } else {
        phase[field] = target.value;
      }

      hostIssues = [];
      paintValidation();
      schedulePreviewUpdate();
    }

    function previewKey(workflowIndex, phaseIndex) {
      return workflowIndex + ':' + phaseIndex;
    }

    function schedulePreviewUpdate() {
      window.clearTimeout(previewUpdateTimer);
      previewUpdateTimer = window.setTimeout(() => {
        vscode.postMessage({ type: 'preview', draft });
      }, 160);
    }

    function paintRuntimePreviews() {
      const previewSections = document.querySelectorAll('[data-preview-key]');
      previewSections.forEach((section) => {
        if (!(section instanceof HTMLElement)) {
          return;
        }

        const key = section.dataset.previewKey;
        if (!key) {
          return;
        }

        const preview = runtimePreviews[key];
        if (!preview) {
          const previewField = section.querySelector('[data-preview-field="promptPreview"]');
          if (previewField instanceof HTMLTextAreaElement) {
            previewField.value = 'Preview unavailable for this phase.';
          }
          return;
        }

        const activeSurface = section.dataset.previewSurface || preview.defaultSurface || 'scopedChat';
        section.dataset.previewSurface = activeSurface;

        const promptPreviewField = section.querySelector('[data-preview-field="promptPreview"]');
        if (promptPreviewField instanceof HTMLTextAreaElement) {
          promptPreviewField.value = preview.promptSurfaces[activeSurface] || '';
        }

        setPreviewField(section, 'provider', preview.provider || 'vscodeBuiltIn');
        setPreviewField(section, 'roleLabel', preview.roleLabel || 'not configured');
        setPreviewField(section, 'autoSubmitLabel', preview.autoSubmitLabel || 'false');
        setPreviewField(section, 'preferredChatAgent', preview.preferredChatAgent || 'none');
        setPreviewField(section, 'agentTag', preview.agentTag || 'none');
        setPreviewField(section, 'starterPromptPlacement', preview.starterPromptPlacement || 'prepend');
        setPreviewField(section, 'sourceSummary', formatPreviewSources(preview.sources));

        section.querySelectorAll('[data-action="set-preview-surface"]').forEach((button) => {
          if (!(button instanceof HTMLElement)) {
            return;
          }
          button.classList.toggle('is-active', button.dataset.surface === activeSurface);
        });
      });
    }

    function setPreviewField(section, field, value) {
      section.querySelectorAll('[data-preview-field="' + field + '"]').forEach((element) => {
        element.textContent = value;
      });
    }

    function formatPreviewSources(sources) {
      if (!sources || typeof sources !== 'object') {
        return 'unavailable';
      }
      return [
        'starterPrompt=' + (sources.starterPrompt || 'n/a'),
        'placement=' + (sources.starterPromptPlacement || 'n/a'),
        'agent=' + (sources.preferredChatAgent || 'n/a'),
        'autoSubmit=' + (sources.autoSubmit || 'n/a'),
      ].join(' | ');
    }

    function render() {
      const app = document.getElementById('app');
      if (!app) {
        return;
      }

      if (draft.workflows.length === 0) {
        app.innerHTML = '<div class="empty">No workspace workflows yet. Add one here to store phase templates and session defaults in workspace settings.</div>';
      } else {
        app.innerHTML = '<section class="workflow-list">' + draft.workflows.map(renderWorkflow).join('') + '</section>';
      }

      paintValidation();
      paintRuntimePreviews();
      updateSummary();
      vscode.setState({ draft, bundledTemplates, runtimePreviews });
      schedulePreviewUpdate();
    }

    function renderWorkflow(workflow, workflowIndex) {
      return '' +
        '<article class="workflow">' +
          '<div class="workflow-head">' +
            '<div>' +
              '<h2>Workflow ' + (workflowIndex + 1) + '</h2>' +
              '<p>Workspace-scoped flow used when creating new epics. Order is preserved exactly as shown.</p>' +
            '</div>' +
            '<div class="workflow-actions">' +
              actionButton('Duplicate', 'duplicate-workflow', workflowIndex, undefined, 'secondary') +
              actionButton('Move Up', 'move-workflow-up', workflowIndex, undefined, 'ghost') +
              actionButton('Move Down', 'move-workflow-down', workflowIndex, undefined, 'ghost') +
              actionButton('Remove Workflow', 'remove-workflow', workflowIndex, undefined, 'danger') +
            '</div>' +
          '</div>' +
          '<div class="field-grid">' +
            renderField('Workflow Id', workflow.id, 'workflow', workflowIndex, undefined, 'id') +
            renderField('Workflow Name', workflow.name, 'workflow', workflowIndex, undefined, 'name') +
          '</div>' +
          '<div class="section-title">Execution Policy</div>' +
          renderExecutionPolicy(workflow, workflowIndex) +
          '<div class="section-title">Phases</div>' +
          '<div class="phase-list">' + workflow.phases.map((phase, phaseIndex) => renderPhase(workflowIndex, phaseIndex, phase)).join('') + '</div>' +
          '<div style="margin-top: 14px;">' + actionButton('Add Phase', 'add-phase', workflowIndex, undefined, 'secondary') + '</div>' +
        '</article>';
    }

    function renderExecutionPolicy(workflow, workflowIndex) {
      return '' +
        '<div class="field-grid">' +
          renderSelect('Default Execution', workflow.execution.mode, ['control', 'pooled', 'pinned'], workflowIndex, undefined, 'execution.mode', ['Control Workspace', 'Managed Pool', 'Pinned Workspace']) +
          renderSelect('Run Phase Execution', workflow.execution.commands.runPhase, ['control', 'pooled', 'pinned'], workflowIndex, undefined, 'execution.commands.runPhase', ['Control Workspace', 'Managed Pool', 'Pinned Workspace']) +
          renderSelect('Review Pull Request Execution', workflow.execution.commands.reviewPullRequest, ['control', 'pooled', 'pinned'], workflowIndex, undefined, 'execution.commands.reviewPullRequest', ['Control Workspace', 'Managed Pool', 'Pinned Workspace']) +
          renderSelect('Open Workspace Execution', workflow.execution.commands.openWorkspace, ['control', 'pooled', 'pinned'], workflowIndex, undefined, 'execution.commands.openWorkspace', ['Control Workspace', 'Managed Pool', 'Pinned Workspace']) +
        '</div>' +
        '<div class="hint">Execution policy is snapshotted into new epics. This phase stores workflow policy only; pooled auto-routing is not enabled yet.</div>';
    }

    function renderPhase(workflowIndex, phaseIndex, phase) {
      const templateControl = renderTemplateControl(workflowIndex, phaseIndex, phase);
      const autopilotNote = phase.autopilot
        ? '<div class="autopilot-note">Autopilot metadata is preserved on save. Current snapshot: enabled=' + String(phase.autopilot.enabled ?? false) + ', retryLimit=' + String(phase.autopilot.retryLimit ?? 'inherit') + ', pauseOnManualIntervention=' + String(phase.autopilot.pauseOnManualIntervention ?? 'inherit') + '.</div>'
        : '';

      return '' +
        '<section class="phase">' +
          '<div class="phase-head">' +
            '<div>' +
              '<h3>Phase ' + (phaseIndex + 1) + '</h3>' +
              '<p>Edit artifact routing, larger file-backed text inputs, and run defaults for this phase.</p>' +
            '</div>' +
            '<div class="phase-actions">' +
              actionButton('Up', 'move-phase-up', workflowIndex, phaseIndex, 'ghost') +
              actionButton('Down', 'move-phase-down', workflowIndex, phaseIndex, 'ghost') +
              actionButton('Remove', 'remove-phase', workflowIndex, phaseIndex, 'danger') +
            '</div>' +
          '</div>' +
          '<div class="field-grid">' +
            renderField('Phase Id', phase.id, 'phase', workflowIndex, phaseIndex, 'id') +
            renderField('Phase Name', phase.name, 'phase', workflowIndex, phaseIndex, 'name') +
            renderOwnerField('Owner', phase.owner, workflowIndex, phaseIndex, 'owner') +
            renderField('Artifact Filename', phase.artifact, 'phase', workflowIndex, phaseIndex, 'artifact') +
          '</div>' +
          '<div class="field-grid">' +
            renderCheckbox('Enabled', phase.enabled !== false, workflowIndex, phaseIndex, 'enabled', 'Disabled phases stay in the workflow config but are skipped when new epics are created.') +
          '</div>' +
          '<div class="field-grid full">' +
            renderTextSourceEditor('Output Summary', phase.outputMode, phase.output, phase.outputRef, workflowIndex, phaseIndex, 'output', 'outputMode', 'outputRef', true) +
          '</div>' +
          '<div class="section-title">Template</div>' +
          '<div class="field-grid">' +
            renderSelect('Template Source', phase.templateMode, ['artifact', 'bundled', 'workspace'], workflowIndex, phaseIndex, 'templateMode', ['Use Artifact Filename', 'Bundled Generic Template', 'Workspace Relative Template']) +
          '</div>' +
          templateControl +
          '<div class="section-title">Run Defaults</div>' +
          '<div class="field-grid full">' +
            renderTextSourceEditor('Starter Prompt', phase.sessionDefaults.starterPromptMode, phase.sessionDefaults.starterPrompt, phase.sessionDefaults.starterPromptRef, workflowIndex, phaseIndex, 'sessionDefaults.starterPrompt', 'sessionDefaults.starterPromptMode', 'sessionDefaults.starterPromptRef', false) +
          '</div>' +
          '<div class="field-grid">' +
            renderSelect('Starter Prompt Placement', phase.sessionDefaults.starterPromptPlacement, ['prepend', 'append', 'replace'], workflowIndex, phaseIndex, 'sessionDefaults.starterPromptPlacement', ['Prepend To Base Prompt', 'Append To Base Prompt', 'Replace Base Prompt']) +
            renderSelect('Auto Submit', phase.sessionDefaults.autoSubmit, ['inherit', 'true', 'false'], workflowIndex, phaseIndex, 'sessionDefaults.autoSubmit', ['Inherit Workspace Default', 'Always Auto-Submit', 'Always Prefill Only']) +
            renderField('Preferred Chat Agent', phase.sessionDefaults.preferredChatAgent, 'phase', workflowIndex, phaseIndex, 'sessionDefaults.preferredChatAgent') +
            renderField('Agent Tag', phase.sessionDefaults.agentTag, 'phase', workflowIndex, phaseIndex, 'sessionDefaults.agentTag') +
          '</div>' +
          '<div class="section-title">Effective Run Preview</div>' +
          renderRunPreview(workflowIndex, phaseIndex) +
          autopilotNote +
        '</section>';
    }

    function renderRunPreview(workflowIndex, phaseIndex) {
      const key = previewKey(workflowIndex, phaseIndex);
      return '<div class="field full-span preview-card" data-preview-key="' + key + '">' +
        '<div class="hint">Support: Starter Prompt <strong>Active</strong> · Auto Submit <strong>Active</strong> · Preferred Chat Agent <strong>Best effort</strong> · Execution Policy <strong>Preview / Guardrail</strong></div>' +
        '<div class="field-grid" style="margin-top: 8px;">' +
          '<div class="workflow-actions">' +
            previewSurfaceButton('Built-in Chat', 'scopedChat', workflowIndex, phaseIndex) +
            previewSurfaceButton('Attached Agent', 'agent', workflowIndex, phaseIndex) +
            previewSurfaceButton('CLI Handoff', 'cli', workflowIndex, phaseIndex) +
          '</div>' +
        '</div>' +
        '<div class="hero-note" style="min-width: 0; margin-top: 8px;">' +
          '<strong>Effective Runtime</strong>' +
          '<div>Provider: <code data-preview-field="provider"></code></div>' +
          '<div>Role: <code data-preview-field="roleLabel"></code></div>' +
          '<div>Auto submit: <code data-preview-field="autoSubmitLabel"></code></div>' +
          '<div>Agent hint: <code data-preview-field="preferredChatAgent"></code></div>' +
          '<div>Agent tag: <code data-preview-field="agentTag"></code></div>' +
          '<div>Starter prompt placement: <code data-preview-field="starterPromptPlacement"></code></div>' +
          '<div>Resolved from: <code data-preview-field="sourceSummary"></code></div>' +
        '</div>' +
        '<textarea readonly style="margin-top: 10px; min-height: 220px;" data-preview-field="promptPreview"></textarea>' +
      '</div>';
    }

    function renderTemplateControl(workflowIndex, phaseIndex, phase) {
      if (phase.templateMode === 'artifact') {
        return '<div class="hint">This phase will seed from the bundled template matching the artifact filename.</div>';
      }

      if (phase.templateMode === 'bundled') {
        return '<div class="field-grid">' +
          renderSelect('Bundled Template', phase.templateRef || (bundledTemplates[0] || ''), bundledTemplates, workflowIndex, phaseIndex, 'templateRef') +
        '</div>' +
        '<div class="hint">Bundled templates come from the extension template pack. Use this when the artifact filename and the starter template should differ.</div>';
      }

      return '<div class="field-grid">' +
        '<div class="field full-span">' +
          '<label>Workspace Template Path</label>' +
          '<div class="template-row">' +
            '<input data-scope="phase" data-workflow-index="' + workflowIndex + '" data-phase-index="' + phaseIndex + '" data-field="templateRef" value="' + escapeHtml(phase.templateRef) + '" placeholder="docs/templates/custom/design.md">' +
            actionButton('Browse...', 'pick-template', workflowIndex, phaseIndex, 'secondary') +
          '</div>' +
          '<div class="hint">Use a workspace-relative markdown path. This file must already exist inside the workspace.</div>' +
          '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, 'templateRef') + '"></div>' +
        '</div>' +
      '</div>';
    }

    function renderField(label, value, scope, workflowIndex, phaseIndex, field) {
      return '<div class="field">' +
        '<label>' + escapeHtml(label) + '</label>' +
        '<input data-scope="' + scope + '" data-workflow-index="' + workflowIndex + '"' + attributePhaseIndex(phaseIndex) + ' data-field="' + field + '" value="' + escapeHtml(value || '') + '">' +
        '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, field) + '"></div>' +
      '</div>';
    }

    function renderOwnerField(label, value, workflowIndex, phaseIndex, field) {
      return '<div class="field">' +
        '<label>' + escapeHtml(label) + '</label>' +
        '<input list="rolePresetList" data-scope="phase" data-workflow-index="' + workflowIndex + '" data-phase-index="' + phaseIndex + '" data-field="' + field + '" value="' + escapeHtml(value || '') + '">' +
        '<div class="hint">Suggested role presets: ' + escapeHtml(initial.rolePresets.join(', ')) + '</div>' +
        '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, field) + '"></div>' +
      '</div>';
    }

    function renderCheckbox(label, checked, workflowIndex, phaseIndex, field, hint) {
      return '<div class="field full-span">' +
        '<label>' + escapeHtml(label) + '</label>' +
        '<label class="toggle">' +
          '<input type="checkbox" data-scope="phase" data-workflow-index="' + workflowIndex + '" data-phase-index="' + phaseIndex + '" data-field="' + field + '"' + (checked ? ' checked' : '') + '>' +
          escapeHtml(hint) +
        '</label>' +
        '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, field) + '"></div>' +
      '</div>';
    }

    function renderTextArea(label, value, workflowIndex, phaseIndex, field) {
      return '<div class="field full-span">' +
        '<label>' + escapeHtml(label) + '</label>' +
        '<textarea data-scope="phase" data-workflow-index="' + workflowIndex + '" data-phase-index="' + phaseIndex + '" data-field="' + field + '">' + escapeHtml(value || '') + '</textarea>' +
        '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, field) + '"></div>' +
      '</div>';
    }

    function renderTextSourceEditor(label, mode, value, textRef, workflowIndex, phaseIndex, valueField, modeField, refField, required) {
      const placeholder = refField.indexOf('starterPrompt') >= 0
        ? 'docs/ai-delivery/prompts/starter-prompt.md'
        : 'docs/ai-delivery/prompts/output-summary.md';
      const modeControl = '<div class="field-grid">' +
        renderSelect(label + ' Source', mode, ['inline', 'file'], workflowIndex, phaseIndex, modeField, ['Inline Text', 'File Reference']) +
      '</div>';

      if (mode === 'inline') {
        return modeControl + renderTextArea(label, value, workflowIndex, phaseIndex, valueField);
      }

      return modeControl + '<div class="field full-span">' +
        '<label>' + escapeHtml(label + ' File') + '</label>' +
        '<input data-scope="phase" data-workflow-index="' + workflowIndex + '" data-phase-index="' + phaseIndex + '" data-field="' + refField + '" value="' + escapeHtml(textRef || '') + '" placeholder="' + placeholder + '">' +
        '<div class="hint">Use a workspace-relative file path. Saving creates the file when it does not exist yet' + (required ? ' and uses that file as the required phase text.' : '.') + '</div>' +
        '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, refField) + '"></div>' +
      '</div>';
    }

    function renderSelect(label, value, options, workflowIndex, phaseIndex, field, optionLabels) {
      const renderedOptions = options.map((option, index) => {
        const optionLabel = Array.isArray(optionLabels) ? optionLabels[index] : option;
        return '<option value="' + escapeHtml(option) + '"' + (option === value ? ' selected' : '') + '>' + escapeHtml(optionLabel) + '</option>';
      }).join('');

      return '<div class="field">' +
        '<label>' + escapeHtml(label) + '</label>' +
        '<select data-scope="' + (phaseIndex === undefined ? 'workflow' : 'phase') + '" data-workflow-index="' + workflowIndex + '"' + attributePhaseIndex(phaseIndex) + ' data-field="' + field + '">' + renderedOptions + '</select>' +
        '<div class="error" data-error-for="' + fieldPath(workflowIndex, phaseIndex, field) + '"></div>' +
      '</div>';
    }

    function actionButton(label, action, workflowIndex, phaseIndex, kind) {
      return '<button type="button" class="' + kind + '" data-action="' + action + '" data-workflow-index="' + workflowIndex + '"' + attributePhaseIndex(phaseIndex) + '>' + escapeHtml(label) + '</button>';
    }

    function paintValidation() {
      const issues = [...validateDraft(draft), ...hostIssues];
      const issueMap = new Map();
      for (const issue of issues) {
        if (!issue || typeof issue.path !== 'string' || typeof issue.message !== 'string') {
          continue;
        }
        const existing = issueMap.get(issue.path);
        issueMap.set(issue.path, existing ? existing + ' ' + issue.message : issue.message);
      }

      document.querySelectorAll('[data-error-for]').forEach((node) => {
        const key = node.getAttribute('data-error-for');
        const message = key ? (issueMap.get(key) || '') : '';
        node.textContent = message;
      });

      document.querySelectorAll('input, select, textarea').forEach((node) => {
        const workflowIndex = node.getAttribute('data-workflow-index');
        const phaseIndex = node.getAttribute('data-phase-index');
        const field = node.getAttribute('data-field');
        if (workflowIndex === null || !field) {
          return;
        }
        const key = phaseIndex === null
          ? 'workflow.' + workflowIndex + '.' + field
          : 'workflow.' + workflowIndex + '.phase.' + phaseIndex + '.' + field;
        node.classList.toggle('invalid', issueMap.has(key));
      });

      const saveButton = document.getElementById('saveButton');
      if (saveButton) {
        saveButton.disabled = issues.length > 0;
      }
      updateSummary(issues.length);
    }

    function updateSummary(issueCount) {
      const issues = typeof issueCount === 'number' ? issueCount : validateDraft(draft).length + hostIssues.length;
      const summary = document.getElementById('summary');
      if (!summary) {
        return;
      }
      summary.textContent = issues === 0
        ? draft.workflows.length + ' workflows ready to save'
        : issues + ' validation issues';
    }

    function setStatus(message, kind) {
      const status = document.getElementById('status');
      if (!status) {
        return;
      }
      status.textContent = message || '';
      status.className = 'status';
      if (message) {
        status.classList.add('visible');
        if (kind) {
          status.classList.add(kind);
        }
      }
    }

    function validateDraft(nextDraft) {
      const issues = [];
      const workflowIds = new Set();
      nextDraft.workflows.forEach((workflow, workflowIndex) => {
        const workflowId = normalize(workflow.id);
        if (!workflowId) {
          issues.push({ path: 'workflow.' + workflowIndex + '.id', message: 'Workflow id is required.' });
        } else if (workflowId === 'default') {
          issues.push({ path: 'workflow.' + workflowIndex + '.id', message: 'Workflow id "default" is reserved.' });
        } else if (workflowIds.has(workflowId)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.id', message: 'Workflow id must be unique within workspace workflows.' });
        } else {
          workflowIds.add(workflowId);
        }

        if (!normalize(workflow.name)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.name', message: 'Workflow name is required.' });
        }

        if (!isValidExecutionMode(workflow.execution?.mode)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.execution.mode', message: 'Default execution must be control, pooled, or pinned.' });
        }
        if (!isValidExecutionMode(workflow.execution?.commands?.runPhase)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.execution.commands.runPhase', message: 'Run Phase execution must be control, pooled, or pinned.' });
        }
        if (!isValidExecutionMode(workflow.execution?.commands?.reviewPullRequest)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.execution.commands.reviewPullRequest', message: 'Review Pull Request execution must be control, pooled, or pinned.' });
        }
        if (!isValidExecutionMode(workflow.execution?.commands?.openWorkspace)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.execution.commands.openWorkspace', message: 'Open Workspace execution must be control, pooled, or pinned.' });
        }

        if (!Array.isArray(workflow.phases) || workflow.phases.length === 0) {
          issues.push({ path: 'workflow.' + workflowIndex + '.phases', message: 'At least one phase is required.' });
          return;
        }
        if (!workflow.phases.some((phase) => phase.enabled !== false)) {
          issues.push({ path: 'workflow.' + workflowIndex + '.phases', message: 'At least one enabled phase is required.' });
        }

        const phaseIds = new Set();
        workflow.phases.forEach((phase, phaseIndex) => {
          const prefix = 'workflow.' + workflowIndex + '.phase.' + phaseIndex;
          const phaseId = normalize(phase.id);
          if (!phaseId) {
            issues.push({ path: prefix + '.id', message: 'Phase id is required.' });
          } else if (phaseIds.has(phaseId)) {
            issues.push({ path: prefix + '.id', message: 'Phase id must be unique within the workflow.' });
          } else {
            phaseIds.add(phaseId);
          }

          if (!normalize(phase.name)) {
            issues.push({ path: prefix + '.name', message: 'Phase name is required.' });
          }
          if (phase.enabled === false) {
            return;
          }
          if (!normalize(phase.owner)) {
            issues.push({ path: prefix + '.owner', message: 'Owner is required.' });
          }
          const normalizedArtifact = normalize(phase.artifact);
          if (!normalizedArtifact.toLowerCase().endsWith('.md') || normalizedArtifact.includes('/') || normalizedArtifact.includes(String.fromCharCode(92))) {
            issues.push({ path: prefix + '.artifact', message: 'Artifact filename must be a markdown filename like REVIEW.md.' });
          }
          if (phase.outputMode === 'inline') {
            if (!normalize(phase.output)) {
              issues.push({ path: prefix + '.output', message: 'Output summary is required.' });
            }
          } else {
            const outputRef = normalizeRelativePath(phase.outputRef);
            if (!outputRef) {
              issues.push({ path: prefix + '.outputRef', message: 'Output summary file reference is required.' });
            } else if (!isValidWorkspaceRelativePath(outputRef)) {
              issues.push({ path: prefix + '.outputRef', message: 'Output summary file reference must stay inside the workspace.' });
            }
          }

          if (phase.sessionDefaults.starterPromptMode === 'file') {
            const starterPromptRef = normalizeRelativePath(phase.sessionDefaults.starterPromptRef);
            if (!starterPromptRef) {
              issues.push({ path: prefix + '.sessionDefaults.starterPromptRef', message: 'Starter prompt file reference is required.' });
            } else if (!isValidWorkspaceRelativePath(starterPromptRef)) {
              issues.push({ path: prefix + '.sessionDefaults.starterPromptRef', message: 'Starter prompt file reference must stay inside the workspace.' });
            }
          }

          if (phase.templateMode !== 'artifact') {
            const templateRef = normalizeTemplateRef(phase.templateRef);
            if (!templateRef) {
              issues.push({ path: prefix + '.templateRef', message: 'Template reference is required for the selected template source.' });
            } else if (!templateRef.toLowerCase().endsWith('.md') || templateRef.startsWith('/') || templateRef.includes('..')) {
              issues.push({ path: prefix + '.templateRef', message: 'Template reference must point to a valid markdown file inside the workspace or bundled template pack.' });
            } else if (phase.templateMode === 'bundled' && templateRef.includes('/')) {
              issues.push({ path: prefix + '.templateRef', message: 'Bundled templates must use a filename like DESIGN.md.' });
            } else if (phase.templateMode === 'bundled' && bundledTemplates.length > 0 && !bundledTemplates.includes(templateRef)) {
              issues.push({ path: prefix + '.templateRef', message: 'Choose one of the bundled template filenames.' });
            } else if (phase.templateMode === 'workspace' && !templateRef.includes('/')) {
              issues.push({ path: prefix + '.templateRef', message: 'Workspace templates must use a relative path like docs/templates/design.md.' });
            }
          }
        });
      });
      return issues;
    }

    function fieldPath(workflowIndex, phaseIndex, field) {
      return phaseIndex === undefined
        ? 'workflow.' + workflowIndex + '.' + field
        : 'workflow.' + workflowIndex + '.phase.' + phaseIndex + '.' + field;
    }

    function attributePhaseIndex(phaseIndex) {
      return phaseIndex === undefined ? '' : ' data-phase-index="' + phaseIndex + '"';
    }

    function createWorkflowDraft(index) {
      const next = deepClone(initial.factory.createEmptyWorkflowDraft);
      next.id = 'workflow-' + (index + 1);
      next.name = 'New Workflow';
      next.phases = [createPhaseDraft(0)];
      return next;
    }

    function previewSurfaceButton(label, surface, workflowIndex, phaseIndex) {
      return '<button type="button" class="action secondary preview-surface" data-action="set-preview-surface" data-surface="' + surface + '" data-workflow-index="' + workflowIndex + '" data-phase-index="' + phaseIndex + '">' + label + '</button>';
    }

    function duplicateWorkflow(workflow, workflowIndex) {
      const next = deepClone(workflow);
      next.id = uniqueWorkflowId(workflow.id + '-copy-' + (workflowIndex + 1));
      next.name = uniqueWorkflowName(workflow.name + ' Copy');
      return next;
    }

    function createPhaseDraft(index) {
      const next = deepClone(initial.factory.createEmptyPhaseDraft);
      next.id = 'phase-' + (index + 1);
      next.name = 'New Phase';
      next.artifact = 'PHASE-' + (index + 1) + '.md';
      next.output = '';
      return next;
    }

    function uniqueWorkflowId(baseId) {
      const normalizedBase = normalize(baseId) || 'workflow';
      let candidate = normalizedBase;
      let suffix = 2;
      const existingIds = new Set(draft.workflows.map((workflow) => normalize(workflow.id)));
      while (existingIds.has(candidate)) {
        candidate = normalizedBase + '-' + suffix;
        suffix += 1;
      }
      return candidate;
    }

    function uniqueWorkflowName(baseName) {
      const normalizedBase = normalize(baseName) || 'Workflow';
      let candidate = normalizedBase;
      let suffix = 2;
      const existingNames = new Set(draft.workflows.map((workflow) => normalize(workflow.name).toLowerCase()));
      while (existingNames.has(candidate.toLowerCase())) {
        candidate = normalizedBase + ' ' + suffix;
        suffix += 1;
      }
      return candidate;
    }

    function normalizeRelativePath(value) {
      const normalizedValue = normalize(value).split(String.fromCharCode(92)).join('/');
      return normalizedValue.startsWith('./') ? normalizedValue.slice(2) : normalizedValue;
    }

    function normalizeTemplateRef(value) {
      return normalizeRelativePath(value);
    }

    function setNestedValue(target, fieldPath, value) {
      const segments = fieldPath.split('.');
      let current = target;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!current[segment] || typeof current[segment] !== 'object') {
          current[segment] = {};
        }
        current = current[segment];
      }

      current[segments[segments.length - 1]] = value;
    }

    function isValidExecutionMode(value) {
      return value === 'control' || value === 'pooled' || value === 'pinned';
    }

    function isValidWorkspaceRelativePath(value) {
      if (!value || value.startsWith('/') || /^[a-zA-Z]:\\//.test(value)) {
        return false;
      }

      return !value.split('/').some((segment) => segment === '.' || segment === '..');
    }

    function normalize(value) {
      return typeof value === 'string' ? value.trim() : '';
    }

    function deepClone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function swap(items, left, right) {
      const current = items[left];
      items[left] = items[right];
      items[right] = current;
    }

    function toNumber(value) {
      if (value === undefined) {
        return undefined;
      }

      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }
  </script>
</body>
</html>`;
}

function materializeFileBackedDraft(
  draft: WorkflowEditorDraft,
  workspaceRoot: string,
): { draft: WorkflowEditorDraft; issues: readonly WorkflowEditorValidationIssue[] } {
  const nextDraft = JSON.parse(JSON.stringify(draft)) as WorkflowEditorDraft;
  const issues: WorkflowEditorValidationIssue[] = [];

  nextDraft.workflows.forEach((workflow, workflowIndex) => {
    workflow.phases.forEach((phase, phaseIndex) => {
      if (phase.outputMode === 'file') {
        const result = ensureWorkspaceTextRefFile(workspaceRoot, phase.outputRef, phase.output);
        if (result.content === undefined || !result.normalized) {
          issues.push({
            path: `workflow.${workflowIndex}.phase.${phaseIndex}.outputRef`,
            message: `Output summary file reference ${result.error ?? 'could not be created or read.'}`,
          });
        } else {
          phase.outputRef = result.normalized;
          phase.output = result.content;
        }
      }

      if (phase.sessionDefaults.starterPromptMode === 'file') {
        const result = ensureWorkspaceTextRefFile(workspaceRoot, phase.sessionDefaults.starterPromptRef, phase.sessionDefaults.starterPrompt);
        if (!result.normalized) {
          issues.push({
            path: `workflow.${workflowIndex}.phase.${phaseIndex}.sessionDefaults.starterPromptRef`,
            message: `Starter prompt file reference ${result.error ?? 'could not be created or read.'}`,
          });
        } else {
          phase.sessionDefaults.starterPromptRef = result.normalized;
          phase.sessionDefaults.starterPrompt = result.content ?? '';
        }
      }
    });
  });

  return { draft: nextDraft, issues };
}

function buildWorkflowRuntimePreviews(
  draft: WorkflowEditorDraft,
  workspaceRoot: string,
): Record<string, WorkflowRuntimePreview> {
  const configuration = vscode.workspace.getConfiguration('apexDelivery');
  const provider = configuration.get<string>('copilot.provider', 'vscodeBuiltIn');
  const userRole = configuration.get<string>('userRole', '');
  const workspaceDefaults: PhaseRunPreferences = {
    autoSubmit: configuration.get<boolean>('runPhase.autoSubmit', true),
    agentTag: normalizePreviewString(configuration.get<string>('runPhase.agentTag', '')),
    preferredChatAgent: normalizePreviewString(configuration.get<string>('runPhase.preferredChatAgent', '')),
    starterPrompt: normalizePreviewString(configuration.get<string>('runPhase.starterPrompt', '')),
    starterPromptPlacement: normalizeStarterPromptPlacement(configuration.get<string>('runPhase.starterPromptPlacement', 'prepend')) ?? 'prepend',
  };
  const rawRolePolicies = configuration.get<Record<string, unknown>>('runPhase.rolePolicies', {});
  const rawPhaseProfiles = configuration.get<Record<string, unknown>>('runPhase.phaseProfiles', {});
  const previews: Record<string, WorkflowRuntimePreview> = {};
  const sampleEpicKey = 'APEX-1234';
  const sampleEpicTitle = 'Preview Epic';
  const sampleRoot = path.join('docs', 'ai-delivery', 'epics', sampleEpicKey);

  draft.workflows.forEach((workflow, workflowIndex) => {
    workflow.phases.forEach((phase, phaseIndex) => {
      const workflowDefaults = {
        autoSubmit: phase.sessionDefaults.autoSubmit === 'true'
          ? true
          : phase.sessionDefaults.autoSubmit === 'false'
            ? false
            : undefined,
        agentTag: normalizePreviewString(phase.sessionDefaults.agentTag),
        preferredChatAgent: normalizePreviewString(phase.sessionDefaults.preferredChatAgent),
        starterPrompt: phase.sessionDefaults.starterPrompt,
        starterPromptPlacement: normalizeStarterPromptPlacement(phase.sessionDefaults.starterPromptPlacement) ?? 'prepend',
      };
      const runPlan = resolvePhaseRunPlan({
        userRole: normalizePreviewString(userRole),
        workflowId: workflow.id,
        phaseId: phase.id,
        phaseOwner: normalizePreviewString(phase.owner),
        workflowDefaults,
        workspaceDefaults,
        rawRolePolicies,
        rawPhaseProfiles,
      });
      const promptSurfaces = buildPhasePromptSurfaces({
        sessionMarker: 'APEX_SESSION=preview-session',
        workspaceRootDisplayPath: workspaceRoot || '<workspace>',
        epicDisplayPath: path.join(sampleRoot, 'EPIC.md'),
        artifactDisplayPath: path.join(sampleRoot, phase.artifact || 'PHASE.md'),
        artifactBasename: phase.artifact || 'PHASE.md',
        statusDisplayPath: path.join(sampleRoot, '.apex', `${phase.id || 'phase'}.status.json`),
        epicKey: sampleEpicKey,
        epicTitle: sampleEpicTitle,
        workflowId: workflow.id,
        phaseId: phase.id,
        phaseName: phase.name || 'Phase',
        phaseStatus: 'pending',
        phaseOutput: phase.output || '',
        referenceText: [
          '[EPIC.md]',
          'Preview source text is rendered from the selected epic at runtime.',
          '',
          `[${phase.artifact || 'PHASE.md'}]`,
          phase.output || 'Phase artifact content preview is not available in configuration.',
          '',
          '[status.json]',
          `Phase: ${phase.name || 'Phase'}`,
          `Expected output: ${phase.output || 'n/a'}`,
        ].join('\n'),
        branchNames: [],
        pullRequestCount: 0,
      }, runPlan.runPreferences);

      previews[`${workflowIndex}:${phaseIndex}`] = {
        provider,
        roleLabel: formatPreviewRoleLabel(runPlan.rolePolicyResolution, phase.owner),
        autoSubmitLabel: runPlan.runPreferences.autoSubmit ? 'true' : 'false',
        preferredChatAgent: runPlan.runPreferences.preferredChatAgent,
        agentTag: runPlan.runPreferences.agentTag,
        starterPromptPlacement: runPlan.runPreferences.starterPromptPlacement,
        promptSurfaces: {
          scopedChat: promptSurfaces.scopedChat,
          agent: promptSurfaces.agent,
          cli: promptSurfaces.cli,
        },
        defaultSurface: provider === 'copilotCliPrompt' ? 'cli' : 'scopedChat',
        sources: runPlan.sources,
      };
    });
  });

  return previews;
}

function formatPreviewRoleLabel(resolution: { userRole?: string; preferredRole?: string; status?: string }, phaseOwner: string): string {
  if (!resolution.userRole) {
    return normalizePreviewString(phaseOwner) || 'not configured';
  }
  if (resolution.status === 'mismatched' && resolution.preferredRole) {
    return `${resolution.userRole} (phase prefers ${resolution.preferredRole})`;
  }
  return resolution.userRole;
}

function normalizePreviewString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 24; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

function buildRuntimePreviewContext(): {
  provider: string;
  userRole: string;
  workspaceDefaults: Record<string, unknown>;
  rolePolicies: Record<string, unknown>;
} {
  const configuration = vscode.workspace.getConfiguration('apexDelivery');
  return {
    provider: configuration.get<string>('copilot.provider', 'vscodeBuiltIn'),
    userRole: configuration.get<string>('userRole', ''),
    workspaceDefaults: {
      autoSubmit: configuration.get<boolean>('runPhase.autoSubmit', true),
      agentTag: configuration.get<string>('runPhase.agentTag', ''),
      preferredChatAgent: configuration.get<string>('runPhase.preferredChatAgent', ''),
      starterPrompt: configuration.get<string>('runPhase.starterPrompt', ''),
      starterPromptPlacement: configuration.get<string>('runPhase.starterPromptPlacement', 'prepend'),
    },
    rolePolicies: configuration.get<Record<string, unknown>>('runPhase.rolePolicies', {}),
  };
}
