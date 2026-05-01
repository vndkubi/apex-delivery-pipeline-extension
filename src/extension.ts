import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createCopilotBootstrapPack } from './copilotPack';
import { DashboardPanel } from './dashboardPanel';
import { createSampleEpic } from './epicBootstrapper';
import {
  buildAtlassianRemoteServer,
  buildCustomStdioServer,
  ensureMcpConfigFile,
  parseArgsInput,
  sanitizeServerName,
  upsertMcpServer,
} from './mcpConfigurator';
import { DEFAULT_PHASES, EpicStatus, PhaseStatus, phaseDefinitionById } from './pipelineModel';
import { PipelineProvider } from './pipelineProvider';
import { PipelineScanner, writePhaseStatus } from './pipelineScanner';
import { createSpecKitWorkspace } from './specKitWorkspace';
import type { SpecKitWorkspaceResult } from './specKitWorkspace';
import { TemplateContext, writeFromTemplate } from './templateRenderer';

interface PhaseCommandArgs {
  phase: PhaseStatus | undefined;
  epic: EpicStatus | undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('APEX Delivery Pipeline');
  context.subscriptions.push(output);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    output.appendLine('No workspace folder found. APEX Delivery commands require an open folder.');
    void vscode.window.showWarningMessage('APEX Delivery Pipeline requires an open workspace folder.');
    return;
  }

  output.appendLine(`Workspace root: ${workspaceRoot}`);
  const getEpicsPath = (): string => vscode.workspace.getConfiguration('apexDelivery').get<string>('epicsPath', 'docs/ai-delivery/epics');
  const getSpecsPath = (): string => vscode.workspace.getConfiguration('apexDelivery').get<string>('specsPath', 'specs');
  const getOwner = (): string => vscode.workspace.getConfiguration('apexDelivery').get<string>('ownerName', 'APEX Owner');
  const getMcpConfigPath = (): string => vscode.workspace.getConfiguration('apexDelivery').get<string>('mcpConfigPath', '.vscode/mcp.json');
  const templateRoot = path.join(context.extensionPath, 'templates', 'generic');
  const scanner = new PipelineScanner(workspaceRoot, getEpicsPath());
  const provider = new PipelineProvider(scanner);

  const treeRegistration = vscode.window.registerTreeDataProvider('apexDeliveryView', provider);
  context.subscriptions.push(treeRegistration);

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.refresh', () => {
    scanner.setEpicsPath(getEpicsPath());
    provider.refresh();
    void vscode.window.showInformationMessage('APEX delivery pipeline refreshed.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.openDashboard', () => {
    provider.refresh();
    DashboardPanel.show(provider.getEpics());
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.createSampleEpic', async () => {
    const result = createSampleEpic(workspaceRoot, getEpicsPath(), templateRoot, getOwner());
    output.appendLine(`Created sample epic: ${result.epicKey}`);
    provider.refresh();
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(result.folderPath, 'EPIC.md')));
    void vscode.window.showInformationMessage(`Created sample epic ${result.epicKey}.`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.openOrCreateArtifact', async (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = unwrapPhaseArgs(first, second);
    if (!phase || !epic) {
      void vscode.window.showWarningMessage('Select a delivery phase first.');
      return;
    }

    if (!fs.existsSync(phase.artifactPath)) {
      const templateContext = buildTemplateContext(epic, getOwner());
      writeFromTemplate(templateRoot, phase.artifact, phase.artifactPath, templateContext);
      output.appendLine(`Seeded artifact: ${phase.artifactPath}`);
      provider.refresh();
    }

    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(phase.artifactPath));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.advancePhase', (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = unwrapPhaseArgs(first, second);
    if (!phase || !epic) {
      void vscode.window.showWarningMessage('Select a delivery phase first.');
      return;
    }

    writePhaseStatus(
      phase.statusPath,
      phase.id,
      'passed',
      getOwner(),
      `${phase.name} passed through ${phase.gate}.`,
    );

    const nextPhase = nextPhaseFor(epic, phase);
    if (nextPhase) {
      writePhaseStatus(
        nextPhase.statusPath,
        nextPhase.id,
        'in_progress',
        getOwner(),
        `Ready after ${phase.name} passed.`,
      );
    }

    provider.refresh();
    const message = nextPhase
      ? `${phase.name} passed. ${nextPhase.name} is now in progress.`
      : `${phase.name} passed. Epic is complete.`;
    void vscode.window.showInformationMessage(message);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.configureMcp', async () => {
    await configureMcp(workspaceRoot, getMcpConfigPath(), output);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.createSpecKitWorkspace', async () => {
    const result = await createSpecKitWorkspaceFromInput(workspaceRoot, getSpecsPath(), getOwner(), output);
    if (result) {
      await openPrimaryFileResult('Spec kit workspace', result.folderPath, path.join(result.folderPath, 'spec.md'), result.createdFiles.length, result.skippedFiles.length);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.createCopilotBootstrapPack', async () => {
    const result = createCopilotBootstrapPack(workspaceRoot, getOwner());
    output.appendLine(`[Copilot Pack] Created ${result.createdFiles.length}, skipped ${result.skippedFiles.length} in ${result.rootPath}`);
    await openPrimaryFileResult('Copilot bootstrap pack', result.rootPath, path.join(result.rootPath, 'copilot-instructions.md'), result.createdFiles.length, result.skippedFiles.length);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.startIntegratedFlow', async () => {
    const result = await createSpecKitWorkspaceFromInput(workspaceRoot, getSpecsPath(), getOwner(), output);
    if (!result) {
      return;
    }

    const packResult = createCopilotBootstrapPack(workspaceRoot, getOwner());
    output.appendLine(`[Integrated Flow] Spec workspace ${result.featureId}; Copilot pack created ${packResult.createdFiles.length}, skipped ${packResult.skippedFiles.length}`);

    const choice = await vscode.window.showInformationMessage(
      `Integrated flow ready: ${result.featureId}.`,
      'Open Spec',
      'Configure MCP',
    );
    if (choice === 'Open Spec') {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(result.folderPath, 'spec.md')));
      return;
    }
    if (choice === 'Configure MCP') {
      await configureMcp(workspaceRoot, getMcpConfigPath(), output);
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
    if (event.affectsConfiguration('apexDelivery.epicsPath')) {
      scanner.setEpicsPath(getEpicsPath());
      provider.refresh();
    }
  }));
}

async function createSpecKitWorkspaceFromInput(
  workspaceRoot: string,
  specsPath: string,
  owner: string,
  output: vscode.OutputChannel,
): Promise<SpecKitWorkspaceResult | undefined> {
  const title = await vscode.window.showInputBox({
    title: 'Spec kit feature title',
    prompt: 'Name the feature, ticket, or business problem to turn into a spec-kit workspace.',
    placeHolder: 'Improve AI delivery traceability',
    ignoreFocusOut: true,
    validateInput: (value: string) => value.trim().length === 0 ? 'Feature title is required.' : null,
  });
  if (!title) {
    return undefined;
  }

  const source = await vscode.window.showInputBox({
    title: 'Source context',
    prompt: 'Optional source such as Jira key, Confluence page, custom MCP source, or manual note.',
    placeHolder: 'Jira APEX-123, Confluence delivery SOP, or manual intake',
    ignoreFocusOut: true,
  });

  const result = createSpecKitWorkspace({
    workspaceRoot,
    specsRelativePath: specsPath,
    title,
    source: source ?? '',
    owner,
  });
  output.appendLine(`[Spec Kit] ${result.featureId}: created ${result.createdFiles.length}, skipped ${result.skippedFiles.length}`);
  return result;
}

async function openPrimaryFileResult(
  label: string,
  folderPath: string,
  primaryFilePath: string,
  createdCount: number,
  skippedCount: number,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${label} ready. Created ${createdCount}, skipped ${skippedCount}.`,
    'Open',
  );
  if (choice === 'Open') {
    const fileToOpen = fs.existsSync(primaryFilePath) ? primaryFilePath : folderPath;
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fileToOpen));
  }
}

export function deactivate(): void {
  return;
}

function unwrapPhaseArgs(first: unknown, second?: EpicStatus): PhaseCommandArgs {
  if (isPhaseItemLike(first)) {
    return { phase: first.phase, epic: first.epic };
  }
  return {
    phase: isPhaseStatusLike(first) ? first : undefined,
    epic: second,
  };
}

function isPhaseItemLike(value: unknown): value is { phase: PhaseStatus; epic: EpicStatus } {
  return typeof value === 'object'
    && value !== null
    && 'phase' in value
    && 'epic' in value
    && isPhaseStatusLike((value as { phase?: unknown }).phase);
}

function isPhaseStatusLike(value: unknown): value is PhaseStatus {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'statusPath' in value
    && 'artifactPath' in value;
}

function nextPhaseFor(epic: EpicStatus, phase: PhaseStatus): PhaseStatus | undefined {
  const index = epic.phases.findIndex((candidate) => candidate.id === phase.id);
  if (index < 0) {
    return undefined;
  }
  return epic.phases[index + 1];
}

function buildTemplateContext(epic: EpicStatus, owner: string): TemplateContext {
  return {
    epicKey: epic.key,
    title: epic.title,
    owner,
    date: new Date().toISOString().slice(0, 10),
  };
}

export function phaseArtifactName(phaseId: PhaseStatus['id']): string {
  return phaseDefinitionById(phaseId).artifact;
}

export function defaultPhaseCount(): number {
  return DEFAULT_PHASES.length;
}

async function configureMcp(
  workspaceRoot: string,
  mcpConfigPath: string,
  output: vscode.OutputChannel,
): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      {
        label: 'Atlassian remote MCP',
        description: 'Jira and Confluence through a remote MCP URL',
        value: 'atlassian',
      },
      {
        label: 'Custom stdio MCP',
        description: 'Any local or package-based MCP command',
        value: 'custom',
      },
      {
        label: 'Open MCP config',
        description: 'Open or create the workspace MCP file',
        value: 'open',
      },
    ],
    { title: 'Configure MCP Server' },
  );

  if (!action) {
    return;
  }

  if (action.value === 'open') {
    const configPath = ensureMcpConfigFile(workspaceRoot, mcpConfigPath);
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
    return;
  }

  if (action.value === 'atlassian') {
    await configureAtlassianMcp(workspaceRoot, mcpConfigPath, output);
    return;
  }

  await configureCustomMcp(workspaceRoot, mcpConfigPath, output);
}

async function configureAtlassianMcp(
  workspaceRoot: string,
  mcpConfigPath: string,
  output: vscode.OutputChannel,
): Promise<void> {
  const remoteUrl = await vscode.window.showInputBox({
    title: 'Atlassian remote MCP URL',
    prompt: 'Paste the Jira/Confluence MCP URL from your Atlassian admin or MCP provider.',
    placeHolder: 'https://your-atlassian-mcp.example.com/mcp',
    ignoreFocusOut: true,
    validateInput: (value: string) => value.trim().length === 0 ? 'MCP URL is required.' : null,
  });
  if (!remoteUrl) {
    return;
  }

  const rawName = await vscode.window.showInputBox({
    title: 'MCP server name',
    value: 'atlassian',
    ignoreFocusOut: true,
  });
  const serverName = sanitizeServerName(rawName ?? 'atlassian') || 'atlassian';
  const result = upsertMcpServer(
    workspaceRoot,
    mcpConfigPath,
    serverName,
    buildAtlassianRemoteServer(remoteUrl.trim()),
  );
  output.appendLine(`[MCP] ${result.status}: ${result.serverName} in ${result.configPath}`);
  await showMcpResult(result.status, result.serverName, result.configPath);
}

async function configureCustomMcp(
  workspaceRoot: string,
  mcpConfigPath: string,
  output: vscode.OutputChannel,
): Promise<void> {
  const rawName = await vscode.window.showInputBox({
    title: 'Custom MCP server name',
    value: 'custom-workflow',
    ignoreFocusOut: true,
    validateInput: (value: string) => sanitizeServerName(value).length === 0 ? 'Server name is required.' : null,
  });
  if (!rawName) {
    return;
  }

  const command = await vscode.window.showInputBox({
    title: 'Custom MCP command',
    value: 'npx',
    prompt: 'Command used to start your MCP server.',
    ignoreFocusOut: true,
    validateInput: (value: string) => value.trim().length === 0 ? 'Command is required.' : null,
  });
  if (!command) {
    return;
  }

  const argsInput = await vscode.window.showInputBox({
    title: 'Custom MCP args',
    value: '-y your-mcp-package',
    prompt: 'Use shell-style args or a JSON string array.',
    ignoreFocusOut: true,
  });

  const serverName = sanitizeServerName(rawName);
  const result = upsertMcpServer(
    workspaceRoot,
    mcpConfigPath,
    serverName,
    buildCustomStdioServer(command.trim(), parseArgsInput(argsInput ?? '')),
  );
  output.appendLine(`[MCP] ${result.status}: ${result.serverName} in ${result.configPath}`);
  await showMcpResult(result.status, result.serverName, result.configPath);
}

async function showMcpResult(
  status: 'written' | 'already-exists',
  serverName: string,
  configPath: string,
): Promise<void> {
  const message = status === 'written'
    ? `MCP server "${serverName}" added to ${configPath}.`
    : `MCP server "${serverName}" already exists in ${configPath}.`;
  const choice = await vscode.window.showInformationMessage(message, 'Open Config');
  if (choice === 'Open Config') {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
  }
}
