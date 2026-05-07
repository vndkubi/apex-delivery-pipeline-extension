import { exec as execCallback } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  PersistentApexSessionProvider,
  type ApexChatLaunchResult,
  type ApexChatSessionTransport,
  type ApexDirectModelTransport,
  type ApexSessionProvider,
  type ApexSessionRecord,
  type ApexTransportStability,
  WorkspaceApexSessionStore,
} from './apexSessionProvider';
import { createCopilotBootstrapPack } from './copilotPack';
import {
  clearGuidedAutopilotState,
  readGuidedAutopilotState,
  writeGuidedAutopilotState,
  type GuidedAutopilotState,
} from './autopilotStateStore';
import {
  buildPullRequestFolderName,
  formatPullRequestDisplay,
  getBindBranchToEpicCommandOptions,
  getCreateSampleEpicCommandOptions,
  getIntegratedFlowCommandOptions,
  getLinkBranchToEpicCommandOptions,
  getOpenLinkedBranchWorktreeCommandOptions,
  getPhaseCommandOptions as parsePhaseCommandOptions,
  getReviewPullRequestCommandOptions,
  normalizePullRequestInput,
  parseGuidedAutopilotExecutionMode,
  sanitizePathSegment,
  type GuidedAutopilotExecutionMode,
  type IntegratedFlowCommandOptions,
  type NormalizedPullRequestInput,
  type PhaseCommandOptions,
  type ReviewPullRequestCommandOptions,
} from './commandOptions';
import {
  type CoordinationPullRequestBinding,
  createDefaultCoordinationMetadata,
  readCoordinationMetadata,
  withoutBranchBinding,
  withBranchBinding,
  writeCoordinationMetadata,
} from './coordinationModel';
import { DashboardPanel } from './dashboardPanel';
import { createSampleEpic } from './epicBootstrapper';
import { GitService, type GitCurrentBranchResult } from './gitService';
import {
  buildAtlassianRemoteServer,
  buildCustomStdioServer,
  ensureMcpConfigFile,
  parseArgsInput,
  sanitizeServerName,
  upsertMcpServer,
} from './mcpConfigurator';
import { DEFAULT_PHASES, EpicStatus, PhaseStatus, phaseDefinitionById, resolvePhaseTemplateRef } from './pipelineModel';
import { EpicItem, PhaseItem, PipelineProvider } from './pipelineProvider';
import { PipelineScanner, writePhaseStatus } from './pipelineScanner';
import { registerPbiCommands, type PbiPhaseCommandResult } from './pbiCommands';
import { buildPortfolioSnapshot, type PortfolioSnapshot } from './portfolioModel';
import {
  buildPullRequestReviewContextJson,
  buildPullRequestReviewMarkdown,
  buildPullRequestReviewSection,
  upsertPullRequestReviewSection,
  type PullRequestReviewArtifactContext,
} from './prReviewArtifacts';
import {
  buildCopilotCliHandoff,
  isPbiDeliveryWorkflow,
  listPbiReferencePaths,
} from './pbiWorkflow';
import {
  buildCopilotAgentStarter as renderCopilotAgentStarter,
  buildCopilotCliPrompt as renderCopilotCliPrompt,
  buildDirectModelPrompt as renderDirectModelPrompt,
  buildScopedChatStarter as renderScopedChatStarter,
  normalizeStarterPromptPlacement,
  type PhaseRunProfileOverride,
  resolvePhaseRunPlan,
  resolvePhaseRunProfileOverride,
  type PhasePromptRenderContext,
  type PhaseRunPreferences as SharedPhaseRunPreferences,
} from './phaseRunPlan';
import type { RolePolicyResolution } from './rolePolicy';
import { createSpecKitWorkspace } from './specKitWorkspace';
import type { SpecKitWorkspaceResult } from './specKitWorkspace';
import { TemplateContext, writeFromTemplate } from './templateRenderer';
import { TracePanel } from './tracePanel';
import type { PhaseRunTraceEntry, VerificationTraceRecord } from './tracePanel';
import { WorkflowConfigPanel } from './workflowConfigPanel';
import {
  getDefaultWorkflowDefinition,
  parseWorkflowDefinitions,
  type WorkflowDefinition,
} from './workflowModel';
import { resolveParticipantPromptContext } from './participantPromptContext';

interface PhaseCommandArgs {
  phase: PhaseStatus | undefined;
  epic: EpicStatus | undefined;
}

interface CurrentBranchEpicContext {
  branchName?: string;
  epic?: EpicStatus;
  phase?: PhaseStatus;
  error?: string;
}

interface OpenLinkedBranchWorktreeCommandResult {
  epicKey: string;
  branchName: string;
  worktreePath: string;
  created: boolean;
  openedInNewWindow: boolean;
}

interface ReviewPullRequestCommandResult {
  mode: 'linked-epic' | 'unlinked' | 'blocked';
  artifactPath?: string;
  reviewArtifactPath?: string;
  reviewContextPath?: string;
  linkedEpicKey?: string;
  changedFiles: string[];
  prNumber?: number;
  prUrl?: string;
  baseBranch?: string;
  headBranch?: string;
  executionWorkspacePath?: string;
  blockedReason?: string;
}

interface PhaseContextFile {
  label: string;
  filePath: string;
  content: string;
  truncated: boolean;
}

interface PhaseSessionContext {
  sessionId: string;
  sessionKey: string;
  transportId: string;
  transportStability: ApexTransportStability;
  transportResource?: string;
  sessionStatus: ApexSessionRecord['status'];
  lastLaunchMode?: ApexSessionRecord['lastLaunchMode'];
  phase: PhaseStatus;
  epic: EpicStatus;
  workspaceRoot: string;
  references: readonly PhaseContextFile[];
}

interface PhaseRunPreferences extends SharedPhaseRunPreferences {
  autoSubmit: boolean;
  agentTag?: string;
  modelFamily?: string;
  preferredChatAgent?: string;
  starterPrompt?: string;
}

type CopilotProviderMode = 'vscodeBuiltIn' | 'copilotCliPrompt';

interface PhaseExecutionResolution {
  runPreferences: PhaseRunPreferences;
  preferredAgentStatus: PreferredChatAgentStatus;
  rolePolicyResolution: RolePolicyResolution;
}

interface PhaseProfileTarget {
  id: PhaseStatus['id'];
  name: string;
  workflowId: string;
  workflowName: string;
}

type VerificationKind = VerificationTraceRecord['kind'];

interface VerificationCommandPlan {
  kind: VerificationKind;
  command: string;
  source: 'configuration' | 'package.json';
}

interface VerificationEvidence {
  capturedAt: string;
  records: readonly VerificationTraceRecord[];
}

interface PreferredChatAgentStatus {
  preferredAgent?: string;
  activeAgent?: string;
  status: 'not-configured' | 'unavailable' | 'matched' | 'mismatched';
  note?: string;
}

type CopilotChatLaunchResult = ApexChatLaunchResult;

const PHASE_CHAT_SESSION_PATTERN = /\bAPEX_SESSION=([A-Za-z0-9-]+)\b/;
const PHASE_CHAT_SESSION_URI_SCHEME = 'vscode-chat-session';

type DirectPhaseRunResult =
  | {
    kind: 'completed';
    model: vscode.LanguageModelChat;
    responseText: string;
  }
  | {
    kind: 'fallback';
    reason: string;
  };

interface PhaseCommandResult {
  mode: 'agent-chat' | 'direct' | 'chat-fallback' | 'cli-handoff' | 'blocked';
  artifactPath: string;
  sessionId?: string;
  transportId?: string;
  transportStability?: ApexTransportStability;
  modelLabel?: string;
  responseText?: string;
  fallbackReason?: string;
  chatStarter?: string;
  chatLaunchResult?: CopilotChatLaunchResult;
  verification?: readonly VerificationTraceRecord[];
  preferredAgentStatus?: PreferredChatAgentStatus;
  runPreferences?: PhaseRunPreferences;
  rolePolicyResolution?: RolePolicyResolution;
  handoffPath?: string;
  handoffCommand?: string;
}

interface IntegratedFlowCommandResult {
  featureId: string;
  folderPath: string;
  specFilePath: string;
  copilotInstructionsPath: string;
}

interface GuidedAutopilotResult {
  outcome: 'advanced' | 'completed' | 'paused' | 'not-enabled' | 'cancelled';
  epicKey: string;
  phaseId: string;
  attempts: number;
  nextPhaseId?: string;
  reason?: string;
  lastPhaseRun?: PhaseCommandResult;
}

interface ArtifactProposalResult {
  outcome: 'applied' | 'rejected' | 'unchanged' | 'unavailable';
  artifactPath: string;
  proposalPath?: string;
  modelLabel?: string;
  reason?: string;
}

const APEX_CHAT_PARTICIPANT_ID = 'apex-delivery.phase-assistant';
const CONTEXT_LIMITS = {
  artifact: 12_000,
  epic: 8_000,
  status: 4_000,
};
const PHASE_RUN_TRACE_STORAGE_KEY = 'apexDelivery.phaseRunTraces';
const MAX_PHASE_RUN_TRACE_ENTRIES = 30;
const VERIFICATION_SECTION_START = '<!-- APEX:VERIFICATION-START -->';
const VERIFICATION_SECTION_END = '<!-- APEX:VERIFICATION-END -->';
const VERIFICATION_COMMAND_TIMEOUT_MS = 120_000;
const VERIFICATION_OUTPUT_LIMIT_DEFAULT = 4_000;

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
  const gitService = new GitService();
  let lastAutopilotTreeTarget: PhaseCommandArgs | undefined;
  let currentBranchContext: CurrentBranchEpicContext = {};
  const phaseSessions = new Map<string, PhaseSessionContext>();
  let lastPhaseSessionKey: string | undefined;
  const phaseSessionStore = new WorkspaceApexSessionStore(context.workspaceState);
  const phaseSessionProvider = new PersistentApexSessionProvider(phaseSessionStore, buildPhaseChatSessionKey);
  const bestEffortChatTransport: ApexChatSessionTransport = {
    id: 'best-effort-native-chat',
    stability: 'best-effort-command',
    supportsExactSessionTargeting: false,
    openAsk: (record, payload) => tryStartCopilotChat(record, payload.prompt, payload.autoSubmit, payload.attachFiles),
    openAgent: (record, payload) => tryStartCopilotAgentChat(record, payload.prompt, payload.attachFiles, payload.autoSubmit),
  };
  const directModelTransport: ApexDirectModelTransport<
    DirectPhaseRunResult,
    { session: PhaseSessionContext; options: PhaseCommandOptions; runPreferences: PhaseRunPreferences; preferredModelFamily?: string }
  > = {
    id: 'copilot-language-model',
    stability: 'stable-public',
    supportsExactSessionTargeting: false,
    run: (_record, payload) => runPhaseWithCopilotModel(
      context,
      payload.session,
      output,
      payload.options,
      payload.runPreferences,
      payload.preferredModelFamily,
    ),
  };
  const copilotCliPromptTransport = {
    id: 'copilot-cli-prompt',
    stability: 'best-effort-command' as const,
    supportsExactSessionTargeting: false,
  };
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'apexDelivery.openDashboard';
  statusBar.tooltip = 'Open APEX Delivery Dashboard';
  context.subscriptions.push(statusBar);
  let runTraceHistory = readStoredRunTraceHistory(context);

  const rememberPhaseSession = (session: PhaseSessionContext): void => {
    phaseSessions.set(session.sessionKey, session);
    lastPhaseSessionKey = session.sessionKey;
  };

  const appendRunTrace = async (entry: PhaseRunTraceEntry): Promise<void> => {
    runTraceHistory = [entry, ...runTraceHistory].slice(0, MAX_PHASE_RUN_TRACE_ENTRIES);
    await context.workspaceState.update(PHASE_RUN_TRACE_STORAGE_KEY, runTraceHistory);
    TracePanel.updateIfVisible(runTraceHistory);
  };

  const buildDashboardSnapshot = (): PortfolioSnapshot => buildPortfolioSnapshot(
    workspaceRoot,
    getEpicsPath(),
    provider.getEpics(),
    gitService,
    currentBranchContext.branchName,
  );

  const refreshPipeline = (): void => {
    scanner.setEpicsPath(getEpicsPath());
    provider.refresh();
    currentBranchContext = resolveCurrentBranchEpicContext(provider.getEpics(), gitService.getCurrentBranch(workspaceRoot));
    updateStatusBar(statusBar, provider.getEpics(), currentBranchContext);
    DashboardPanel.updateIfVisible(buildDashboardSnapshot());
  };

  const resolveCommandTarget = (first: unknown, second?: EpicStatus): PhaseCommandArgs => {
    const directTarget = resolveAutopilotTarget(first, second);
    if (directTarget.phase && directTarget.epic) {
      const latestEpic = resolveLatestEpicState(provider.getEpics(), directTarget.epic);
      const latestPhase = latestEpic ? findPhaseById(latestEpic, directTarget.phase.id) ?? directTarget.phase : directTarget.phase;
      return latestEpic
        ? { phase: latestPhase, epic: latestEpic }
        : directTarget;
    }

    if (lastAutopilotTreeTarget?.phase && lastAutopilotTreeTarget.epic) {
      const latestEpic = resolveLatestEpicState(provider.getEpics(), lastAutopilotTreeTarget.epic);
      const latestPhase = latestEpic ? findPhaseById(latestEpic, lastAutopilotTreeTarget.phase.id) ?? lastAutopilotTreeTarget.phase : lastAutopilotTreeTarget.phase;
      return latestEpic
        ? { phase: latestPhase, epic: latestEpic }
        : lastAutopilotTreeTarget;
    }

    if (currentBranchContext.phase && currentBranchContext.epic) {
      return { phase: currentBranchContext.phase, epic: currentBranchContext.epic };
    }

    const epics = provider.getEpics();
    if (epics.length === 1) {
      const [epic] = epics;
      const phase = epic?.phases[epic.currentPhaseIndex];
      if (epic && phase) {
        return { phase, epic };
      }
    }

    return directTarget;
  };

  let artifactWatcher: vscode.FileSystemWatcher | undefined;
  let statusWatcher: vscode.FileSystemWatcher | undefined;
  let coordinationWatcher: vscode.FileSystemWatcher | undefined;
  let portfolioWatcher: vscode.FileSystemWatcher | undefined;

  const recreateWatchers = (): void => {
    artifactWatcher?.dispose();
    statusWatcher?.dispose();
    coordinationWatcher?.dispose();
    portfolioWatcher?.dispose();

    const epicsPath = getEpicsPath();
    const isAbsolute = path.isAbsolute(epicsPath);
    const normalizedEpicsPath = epicsPath.replace(/\\/g, '/');
    const markdownPattern = isAbsolute
      ? new vscode.RelativePattern(vscode.Uri.file(epicsPath), '**/*.md')
      : `**/${epicsPath}/**/*.md`;
    const statusPattern = isAbsolute
      ? new vscode.RelativePattern(vscode.Uri.file(epicsPath), '**/status.json')
      : `**/${epicsPath}/**/status.json`;
    const coordinationPattern = isAbsolute
      ? new vscode.RelativePattern(vscode.Uri.file(epicsPath), '**/.apex-coordination.json')
      : `**/${epicsPath}/**/.apex-coordination.json`;
    const portfolioPattern = isAbsolute
      ? new vscode.RelativePattern(vscode.Uri.file(path.resolve(epicsPath, '..')), 'portfolio.json')
      : `**/${path.posix.dirname(normalizedEpicsPath)}/portfolio.json`;

    artifactWatcher = vscode.workspace.createFileSystemWatcher(markdownPattern);
    statusWatcher = vscode.workspace.createFileSystemWatcher(statusPattern);
    coordinationWatcher = vscode.workspace.createFileSystemWatcher(coordinationPattern);
    portfolioWatcher = vscode.workspace.createFileSystemWatcher(portfolioPattern);

    for (const watcher of [artifactWatcher, statusWatcher, coordinationWatcher, portfolioWatcher]) {
      watcher.onDidChange(() => refreshPipeline());
      watcher.onDidCreate(() => refreshPipeline());
      watcher.onDidDelete(() => refreshPipeline());
    }
  };

  const treeView = vscode.window.createTreeView('apexDeliveryView', { treeDataProvider: provider });
  context.subscriptions.push(treeView);
  context.subscriptions.push(treeView.onDidChangeSelection(({ selection }) => {
    const selectedNode = selection[0];
    if (selectedNode instanceof PhaseItem) {
      lastAutopilotTreeTarget = { phase: selectedNode.phase, epic: selectedNode.epic };
      return;
    }

    if (selectedNode instanceof EpicItem) {
      lastAutopilotTreeTarget = {
        epic: selectedNode.epic,
        phase: selectedNode.epic.phases[selectedNode.epic.currentPhaseIndex],
      };
      return;
    }

    lastAutopilotTreeTarget = undefined;
  }));

  const participant = vscode.chat.createChatParticipant(APEX_CHAT_PARTICIPANT_ID, async (request, _chatContext, stream, token) => {
    const fallbackTarget = (() => {
      const target = resolveCommandTarget(undefined);
      return target.phase && target.epic
        ? { phase: target.phase, epic: target.epic }
        : undefined;
    })();

    const participantContext = resolveParticipantPromptContext(request.prompt, {
      extractSessionKey: extractPhaseChatSessionKey,
      getSessionByKey: (key) => phaseSessions.get(key),
      lastSessionKey: lastPhaseSessionKey,
      fallbackTarget,
    });

    let session: PhaseSessionContext | undefined;
    if (participantContext.kind === 'session') {
      session = participantContext.session;
    } else if (participantContext.kind === 'target') {
      session = await resolvePhaseSessionContext(
        phaseSessionProvider,
        participantContext.target.phase,
        participantContext.target.epic,
        workspaceRoot,
      );
      rememberPhaseSession(session);
    }

    if (!session) {
      stream.markdown('Select a phase in **APEX Delivery**, open an epic-linked branch, or run **APEX Delivery: Run Phase with Copilot** first, then continue here with `@apex`.');
      return;
    }

    rememberPhaseSession(session);

    stream.progress(`Using ${session.epic.key} / ${session.phase.name} context.`);
    stream.reference(vscode.Uri.file(path.join(session.epic.folderPath, 'EPIC.md')));
    stream.reference(vscode.Uri.file(session.phase.artifactPath));
    stream.reference(vscode.Uri.file(session.phase.statusPath));

    try {
      const response = await request.model.sendRequest(
        [vscode.LanguageModelChatMessage.User(buildParticipantPrompt(session, request.prompt))],
        {},
        token,
      );

      for await (const fragment of response.text) {
        stream.markdown(fragment);
      }
    } catch (error: unknown) {
      stream.markdown(`APEX chat follow-up failed: ${formatErrorMessage(error)}`);
    }
  });
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'pipeline-icon.svg');
  context.subscriptions.push(participant);

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.refresh', () => {
    refreshPipeline();
    void vscode.window.showInformationMessage('APEX delivery pipeline refreshed.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.openDashboard', () => {
    refreshPipeline();
    const snapshot = buildDashboardSnapshot();
    DashboardPanel.show(snapshot);
    return snapshot;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.openTracePanel', () => {
    TracePanel.show(runTraceHistory);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.createSampleEpic', async (value: unknown) => {
    const options = getCreateSampleEpicCommandOptions(value);
    const workflow = options.nonInteractive
      ? resolveWorkflowDefinition(options.workflowId, output)
      : await pickWorkflowDefinition(output, {
        title: 'Create epic',
        placeHolder: 'Choose the workflow snapshot stored in the new epic.',
      });

    if (!workflow) {
      return;
    }

    const title = normalizeNonEmptyString(options.title)
      ?? (options.nonInteractive
        ? 'AI Delivery Pipeline Pilot'
        : await vscode.window.showInputBox({
          title: 'Create epic',
          prompt: 'Enter the epic title.',
          placeHolder: 'Investigate review evidence workflow for delivery leads',
          ignoreFocusOut: true,
          validateInput: (input) => input.trim().length === 0 ? 'Epic title is required.' : null,
        }));
    if (!title) {
      return;
    }

    const result = createSampleEpic(workspaceRoot, getEpicsPath(), templateRoot, getOwner(), workflow, title);
    output.appendLine(`Created epic: ${result.epicKey} (${result.workflowName}/${result.workflowId})`);
    refreshPipeline();
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(result.folderPath, 'EPIC.md')));
    void vscode.window.showInformationMessage(`Created epic ${result.epicKey} with workflow ${result.workflowName}.`);
  }));
  registerPbiCommands({
    context,
    workspaceRoot,
    templateRoot,
    output,
    gitService,
    getEpicsPath,
    getOwner,
    refreshPipeline,
    getEpics: () => provider.getEpics(),
    getCurrentBranchContext: () => currentBranchContext,
    resolveEpicCommandTarget,
    resolveLatestEpicState,
    unwrapPhaseArgs,
    pickEpicForCommand,
    ensurePhaseArtifactExists,
    resolvePhaseSessionContext: (phase, epic, resolvedWorkspaceRoot) => resolvePhaseSessionContext(phaseSessionProvider, phase, epic, resolvedWorkspaceRoot),
    getPhaseExecutionResolution,
    createCopilotCliPhaseHandoff: (session, runPreferences, phaseOutput) => createCopilotCliPhaseHandoff(session as PhaseSessionContext, runPreferences, phaseOutput),
    runPhaseInCopilot: (request) => vscode.commands.executeCommand<PbiPhaseCommandResult | undefined>('apexDelivery.runPhaseInCopilot', request),
    normalizeNonEmptyString,
  });

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.bindBranchToEpic', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const epics = provider.getEpics();
    if (epics.length === 0) {
      void vscode.window.showWarningMessage('No delivery epics found. Create or add an epic before binding a branch.');
      return;
    }

    const result = await bindBranchToEpicCommand(epics, workspaceRoot, gitService, first, second, output);
    if (result) {
      refreshPipeline();
    }
    return result;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.manageCurrentBranchBinding', async () => {
    refreshPipeline();
    const epics = provider.getEpics();
    if (epics.length === 0) {
      void vscode.window.showWarningMessage('No delivery epics found. Create or add an epic before managing branch bindings.');
      return;
    }

    const result = await manageCurrentBranchBindingCommand(epics, workspaceRoot, gitService, output);
    if (result) {
      refreshPipeline();
    }
    return result;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.linkCurrentBranchToEpic', async (first: unknown, second?: EpicStatus) => {
    return vscode.commands.executeCommand('apexDelivery.bindBranchToEpic', {
      useCurrentBranch: true,
    }, resolveEpicCommandTarget(first, second));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.linkCurrentBranchAndOpenPinnedWorkspace', async (first: unknown, second?: EpicStatus) => {
    return vscode.commands.executeCommand('apexDelivery.bindBranchToEpic', {
      useCurrentBranch: true,
      openPinnedWorkspace: true,
    }, resolveEpicCommandTarget(first, second));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.linkBranchToEpic', async (first: unknown, second?: EpicStatus) => {
    const options = getLinkBranchToEpicCommandOptions(first);
    return vscode.commands.executeCommand('apexDelivery.bindBranchToEpic', {
      branchName: options.branchName,
      nonInteractive: options.nonInteractive,
    }, resolveEpicCommandTarget(first, second));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.unlinkBranchFromEpic', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const epics = provider.getEpics();
    const result = await unlinkBranchFromEpicCommand(epics, first, second, output);
    if (result) {
      refreshPipeline();
    }
    return result;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.moveBranchToEpic', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const epics = provider.getEpics();
    const result = await moveBranchToEpicCommand(epics, first, second, output);
    if (result) {
      refreshPipeline();
    }
    return result;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.inspectEpicBranchBindings', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    return inspectEpicBranchBindingsCommand(provider.getEpics(), first, second, output);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.openLinkedBranchWorktree', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const options = getOpenLinkedBranchWorktreeCommandOptions(first);
    const epics = provider.getEpics();
    if (epics.length === 0) {
      void vscode.window.showWarningMessage('No delivery epics found. Create or add an epic before opening a pinned branch workspace.');
      return;
    }

    const targetEpic = resolveEpicCommandTarget(first, second)
      ?? currentBranchContext.epic
      ?? await pickEpicForCommand(epics, 'Open Pinned Branch Workspace', 'Choose an epic whose pinned branch workspace should open.');
    const latestTargetEpic = resolveLatestEpicState(epics, targetEpic);
    if (!latestTargetEpic) {
      return;
    }

    const branchResolution = await resolveEpicExecutionBranch(
      latestTargetEpic,
      gitService.getCurrentBranch(workspaceRoot).branchName,
      {
        explicitBranchName: options.branchName,
        allowPrompt: !options.nonInteractive,
        preferCurrentBranch: false,
        promptTitle: 'Open Pinned Branch Workspace',
        promptPlaceHolder: `Choose a linked branch to open as a pinned workspace for ${latestTargetEpic.key}.`,
      },
    );
    if (branchResolution.status === 'cancelled') {
      return;
    }
    if (branchResolution.status !== 'resolved') {
      reportEpicExecutionIssue(output, latestTargetEpic, branchResolution, gitService.getCurrentBranch(workspaceRoot), 'Open Pinned Branch Workspace');
      return;
    }

    const resolvedBranchName = branchResolution.branchName;
    if (!resolvedBranchName) {
      return;
    }

    const desiredWorktreePath = buildSuggestedWorktreePath(workspaceRoot, resolvedBranchName);
    const worktreeResult = gitService.ensureWorktreeForBranch(workspaceRoot, resolvedBranchName, desiredWorktreePath);
    if (!worktreeResult.worktreePath) {
      const message = `APEX could not open the pinned branch workspace for ${latestTargetEpic.key}. Expected branch "${resolvedBranchName}". Next action: recreate the branch locally or resolve the workspace path issue. ${worktreeResult.error ?? ''}`.trim();
      output.appendLine(`[Worktree] ${message}`);
      void vscode.window.showWarningMessage(message);
      return;
    }

    const openInNewWindow = options.openInNewWindow !== false;
    output.appendLine(`[Worktree] ${worktreeResult.created ? 'Created' : 'Reusing'} pinned branch workspace for ${latestTargetEpic.key}. Branch: ${resolvedBranchName}. Path: ${worktreeResult.worktreePath}`);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreeResult.worktreePath), openInNewWindow);
    return {
      epicKey: latestTargetEpic.key,
      branchName: resolvedBranchName,
      worktreePath: worktreeResult.worktreePath,
      created: worktreeResult.created,
      openedInNewWindow: openInNewWindow,
    } satisfies OpenLinkedBranchWorktreeCommandResult;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.reviewPullRequest', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    return reviewPullRequestCommand(
      first,
      second,
      provider.getEpics(),
      currentBranchContext,
      gitService,
      workspaceRoot,
      getEpicsPath(),
      getOwner(),
      output,
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.generatePrReviewArtifact', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    return reviewPullRequestCommand(
      first,
      second,
      provider.getEpics(),
      currentBranchContext,
      gitService,
      workspaceRoot,
      getEpicsPath(),
      getOwner(),
      output,
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.openOrCreateArtifact', async (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = resolveCommandTarget(first, second);
    if (!phase || !epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase', currentBranchContext));
      return;
    }

    const executionGuard = await ensureEpicExecutionBranchMatch(epic, workspaceRoot, gitService, output, 'Open or Create Artifact');
    if (!executionGuard.allowed) {
      return;
    }

    if (!fs.existsSync(phase.artifactPath)) {
      const templateContext = buildTemplateContext(epic, getOwner());
      writeFromTemplate(workspaceRoot, templateRoot, resolvePhaseTemplateRef(phase), phase.artifactPath, templateContext);
      output.appendLine(`Seeded artifact: ${phase.artifactPath}`);
      refreshPipeline();
    }

    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(phase.artifactPath));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.configurePhaseProfile', async (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = resolveCommandTarget(first, second);
    await configurePhaseProfile(phase, epic, output);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.configureWorkflows', () => {
    WorkflowConfigPanel.show({
      workspaceRoot,
      templateRoot,
      output,
      onDidSave: refreshPipeline,
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.runPhaseInCopilot', async (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = resolveCommandTarget(first, second);
    const options = getPhaseCommandOptions(first);
    if (!phase || !epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase', currentBranchContext));
      return;
    }

    const executionGuard = await ensureEpicExecutionBranchMatch(epic, workspaceRoot, gitService, output, 'Run Phase with Copilot');
    if (!executionGuard.allowed) {
      if (options.nonInteractive) {
        return {
          mode: 'blocked',
          artifactPath: phase.artifactPath,
          fallbackReason: executionGuard.blockedReason,
        } satisfies PhaseCommandResult;
      }
      return;
    }

    ensurePhaseArtifactExists(phase, epic, workspaceRoot, templateRoot, getOwner(), output, refreshPipeline);

    let session = await resolvePhaseSessionContext(phaseSessionProvider, phase, epic, workspaceRoot);
    const verificationEvidence = await attachVerificationEvidence(session, output, options.nonInteractive);
    session = await resolvePhaseSessionContext(phaseSessionProvider, phase, epic, workspaceRoot);
    const executionResolution = getPhaseExecutionResolution(epic, phase);
    const { runPreferences, preferredAgentStatus } = executionResolution;
    rememberPhaseSession(session);
    const contextFiles = buildTraceContextFiles(session);
    reportPreferredChatAgentStatus(session, preferredAgentStatus, output, options.nonInteractive);
    if (!await confirmRoleRouting(executionResolution.rolePolicyResolution, options.nonInteractive)) {
      return;
    }

    if (resolveCopilotProvider() === 'copilotCliPrompt') {
      if (options.nonInteractive && options.autopilotExecutionMode === 'fully-automatic') {
        const reason = 'Copilot CLI prompt handoff does not support fully automatic execution. Switch apexDelivery.copilot.provider to vscodeBuiltIn for automatic phase runs.';
        output.appendLine(`[Copilot] ${reason}`);
        return {
          mode: 'blocked',
          artifactPath: phase.artifactPath,
          ...buildPhaseSessionResultMetadata(session),
          fallbackReason: reason,
          verification: verificationEvidence.records,
          preferredAgentStatus,
          runPreferences,
          rolePolicyResolution: executionResolution.rolePolicyResolution,
        } satisfies PhaseCommandResult;
      }

      session = await bindPhaseSessionTransport(
        phaseSessionProvider,
        session,
        copilotCliPromptTransport,
        {
          launchMode: 'ask',
        },
      );
      const handoff = await createCopilotCliPhaseHandoff(session, runPreferences, output);
      session = await markPhaseSessionStatus(
        phaseSessionProvider,
        session,
        'opened',
        `Generated Copilot CLI handoff at ${handoff.promptPath}.`,
      );
      await appendRunTrace(buildPhaseRunTraceEntry(
        session,
        'cli-handoff',
        'Generated Copilot CLI prompt handoff.',
        handoff.content,
        contextFiles,
        verificationEvidence.records,
        preferredAgentStatus,
        executionResolution.rolePolicyResolution,
        undefined,
        handoff.command,
      ));

      if (!options.nonInteractive) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(handoff.promptPath));
        void vscode.window.showInformationMessage(`Copilot CLI handoff ready for ${epic.key}. Command copied to clipboard.`);
        return;
      }

      return {
        mode: 'cli-handoff',
        artifactPath: phase.artifactPath,
        ...buildPhaseSessionResultMetadata(session),
        verification: verificationEvidence.records,
        preferredAgentStatus,
        runPreferences,
        rolePolicyResolution: executionResolution.rolePolicyResolution,
        handoffPath: handoff.promptPath,
        handoffCommand: handoff.command,
      } satisfies PhaseCommandResult;
    }

    const shouldAttemptAgentLaunch = !options.forceChatFallback
      && (!options.nonInteractive || options.autopilotExecutionMode === 'agent-pause');

    if (shouldAttemptAgentLaunch) {
      session = await bindPhaseSessionTransport(
        phaseSessionProvider,
        session,
        bestEffortChatTransport,
        {
          resource: buildPhaseChatSessionUri(session).toString(),
          launchMode: 'agent',
        },
      );
      const agentPrompt = buildCopilotAgentStarter(session, runPreferences);
      const chatLaunchResult = await launchPhaseInCopilotAgent(session, output, bestEffortChatTransport, runPreferences, options.nonInteractive);
      session = await markPhaseSessionStatus(
        phaseSessionProvider,
        session,
        chatLaunchResult === 'submitted' ? 'submitted' : chatLaunchResult === 'prefilled' || chatLaunchResult === 'opened' ? 'opened' : 'failed',
        chatLaunchResult === 'unavailable' ? 'Agent-mode chat launch was unavailable.' : undefined,
      );
      if (chatLaunchResult !== 'unavailable') {
        await appendRunTrace(buildPhaseRunTraceEntry(
          session,
          'agent-chat',
          describeChatLaunchTraceResult(chatLaunchResult, 'agent mode'),
          agentPrompt,
          contextFiles,
          verificationEvidence.records,
          preferredAgentStatus,
          executionResolution.rolePolicyResolution,
        ));
        if (options.nonInteractive) {
          return {
            mode: 'agent-chat',
            artifactPath: phase.artifactPath,
            ...buildPhaseSessionResultMetadata(session),
            chatStarter: agentPrompt,
            chatLaunchResult,
            verification: verificationEvidence.records,
            preferredAgentStatus,
            runPreferences,
            rolePolicyResolution: executionResolution.rolePolicyResolution,
          } satisfies PhaseCommandResult;
        }
        return;
      }

      output.appendLine(`[Copilot] Agent-mode chat launch was unavailable for ${epic.key} / ${phase.id}; falling back to direct model execution.`);
    } else if (!options.forceChatFallback && options.nonInteractive && options.autopilotExecutionMode === 'fully-automatic') {
      output.appendLine(`[Copilot] Fully automatic mode enabled for ${epic.key} / ${phase.id}; skipping Copilot agent mode and requiring direct completion.`);
    }

    if (options.forceChatFallback) {
      output.appendLine(`[Copilot] Forcing GitHub Copilot Chat fallback for ${epic.key} / ${phase.id}.`);
      session = await bindPhaseSessionTransport(
        phaseSessionProvider,
        session,
        bestEffortChatTransport,
        {
          resource: buildPhaseChatSessionUri(session).toString(),
          launchMode: 'ask',
        },
      );
      const fallbackResult = await handoffPhaseToCopilotChat(
        session,
        output,
        bestEffortChatTransport,
        options,
        buildDraftPhaseRunPreferences(runPreferences),
      );
      session = await markPhaseSessionStatus(
        phaseSessionProvider,
        session,
        fallbackResult.chatLaunchResult === 'submitted' ? 'submitted' : fallbackResult.chatLaunchResult === 'prefilled' || fallbackResult.chatLaunchResult === 'opened' ? 'opened' : 'failed',
        fallbackResult.fallbackReason,
      );
      fallbackResult.sessionId = session.sessionId;
      fallbackResult.transportId = session.transportId;
      fallbackResult.transportStability = session.transportStability;
      await appendRunTrace(buildPhaseRunTraceEntry(
        session,
        'chat-fallback',
        describeChatLaunchTraceResult(fallbackResult.chatLaunchResult ?? 'unavailable', 'fallback chat'),
        fallbackResult.chatStarter ?? buildScopedChatStarter(session),
        contextFiles,
        verificationEvidence.records,
        preferredAgentStatus,
        executionResolution.rolePolicyResolution,
        undefined,
        'Forced GitHub Copilot Chat fallback requested by command options.',
      ));
      fallbackResult.verification = verificationEvidence.records;
      fallbackResult.preferredAgentStatus = preferredAgentStatus;
      fallbackResult.runPreferences = runPreferences;
      fallbackResult.rolePolicyResolution = executionResolution.rolePolicyResolution;
      return fallbackResult;
    }

    session = await bindPhaseSessionTransport(phaseSessionProvider, session, directModelTransport, {
      launchMode: 'direct-model',
    });
    const directPrompt = buildDirectModelPrompt(session, runPreferences);
    const directRun = await directModelTransport.run(sessionToSessionRecord(session), {
      session,
      options,
      runPreferences,
      preferredModelFamily: runPreferences.modelFamily,
    });
    session = await markPhaseSessionStatus(
      phaseSessionProvider,
      session,
      directRun.kind === 'completed' ? 'completed' : 'failed',
      directRun.kind === 'fallback' ? directRun.reason : undefined,
    );
    if (directRun.kind === 'completed') {
      output.appendLine(`[Copilot] Direct run complete for ${epic.key} / ${phase.id} using ${formatModelLabel(directRun.model)}.`);
      await appendRunTrace(buildPhaseRunTraceEntry(
        session,
        'direct-model',
        options.nonInteractive ? 'Completed direct model phase run.' : 'Displayed direct model response in a scratch document.',
        directPrompt,
        contextFiles,
        verificationEvidence.records,
        preferredAgentStatus,
        executionResolution.rolePolicyResolution,
        formatModelLabel(directRun.model),
      ));
      if (options.nonInteractive) {
        return {
          mode: 'direct',
          artifactPath: phase.artifactPath,
          ...buildPhaseSessionResultMetadata(session),
          modelLabel: formatModelLabel(directRun.model),
          responseText: directRun.responseText,
          verification: verificationEvidence.records,
          preferredAgentStatus,
          runPreferences,
          rolePolicyResolution: executionResolution.rolePolicyResolution,
        } satisfies PhaseCommandResult;
      }

      const choice = await vscode.window.showInformationMessage(
        `Direct Copilot response ready for ${epic.key} / ${phase.name}.`,
        'Open Artifact',
        'Continue in Chat',
      );

      if (choice === 'Open Artifact') {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(phase.artifactPath));
      }

      if (choice === 'Continue in Chat') {
        await continuePhaseInChat(session, bestEffortChatTransport, runPreferences);
      }
      return;
    }

    if (options.nonInteractive && options.autopilotExecutionMode === 'fully-automatic' && !options.forceChatFallback) {
      const reason = `Fully automatic mode could not continue because direct model execution is unavailable: ${directRun.reason}`;
      output.appendLine(`[Copilot] ${reason}`);
      await appendRunTrace(buildPhaseRunTraceEntry(
        session,
        'direct-model',
        'Direct model execution was unavailable in fully automatic mode.',
        directPrompt,
        contextFiles,
        verificationEvidence.records,
        preferredAgentStatus,
        executionResolution.rolePolicyResolution,
        undefined,
        reason,
      ));
      return {
        mode: 'blocked',
        artifactPath: phase.artifactPath,
        ...buildPhaseSessionResultMetadata(session),
        fallbackReason: reason,
        verification: verificationEvidence.records,
        preferredAgentStatus,
        runPreferences,
        rolePolicyResolution: executionResolution.rolePolicyResolution,
      } satisfies PhaseCommandResult;
    }

    output.appendLine(`[Copilot] Falling back to GitHub Copilot Chat for ${epic.key} / ${phase.id}: ${directRun.reason}`);
    session = await bindPhaseSessionTransport(
      phaseSessionProvider,
      session,
      bestEffortChatTransport,
      {
        resource: buildPhaseChatSessionUri(session).toString(),
        launchMode: 'ask',
        fallbackReason: directRun.reason,
      },
    );
    const fallbackResult = await handoffPhaseToCopilotChat(
      session,
      output,
      bestEffortChatTransport,
      options,
      options.nonInteractive ? buildDraftPhaseRunPreferences(runPreferences) : runPreferences,
    );
    session = await markPhaseSessionStatus(
      phaseSessionProvider,
      session,
      fallbackResult.chatLaunchResult === 'submitted' ? 'submitted' : fallbackResult.chatLaunchResult === 'prefilled' || fallbackResult.chatLaunchResult === 'opened' ? 'opened' : 'failed',
      directRun.reason,
    );
    fallbackResult.sessionId = session.sessionId;
    fallbackResult.transportId = session.transportId;
    fallbackResult.transportStability = session.transportStability;
    await appendRunTrace(buildPhaseRunTraceEntry(
      session,
      'chat-fallback',
      describeChatLaunchTraceResult(fallbackResult.chatLaunchResult ?? 'unavailable', 'fallback chat'),
      fallbackResult.chatStarter ?? buildScopedChatStarter(session),
      contextFiles,
      verificationEvidence.records,
      preferredAgentStatus,
      executionResolution.rolePolicyResolution,
      undefined,
      directRun.reason,
    ));
    fallbackResult.verification = verificationEvidence.records;
    fallbackResult.preferredAgentStatus = preferredAgentStatus;
    fallbackResult.runPreferences = runPreferences;
    fallbackResult.rolePolicyResolution = executionResolution.rolePolicyResolution;
    return fallbackResult;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.proposeArtifactUpdate', async (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = resolveCommandTarget(first, second);
    if (!phase || !epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase', currentBranchContext));
      return;
    }

    const executionGuard = await ensureEpicExecutionBranchMatch(epic, workspaceRoot, gitService, output, 'Propose Artifact Update');
    if (!executionGuard.allowed) {
      return;
    }

    ensurePhaseArtifactExists(phase, epic, workspaceRoot, templateRoot, getOwner(), output, refreshPipeline);
    let session = buildPhaseSessionContext(phase, epic, workspaceRoot);
    const verificationEvidence = await attachVerificationEvidence(session, output, false);
    session = buildPhaseSessionContext(phase, epic, workspaceRoot);
    const executionResolution = getPhaseExecutionResolution(epic, phase);
    const { runPreferences, preferredAgentStatus } = executionResolution;
    rememberPhaseSession(session);
    const artifactProposalPrompt = buildArtifactProposalPrompt(session);
    const contextFiles = buildTraceContextFiles(session);
    reportPreferredChatAgentStatus(session, preferredAgentStatus, output, false);
    if (!await confirmRoleRouting(executionResolution.rolePolicyResolution, false)) {
      return;
    }
    const proposal = await proposeArtifactUpdateWithCopilot(context, session, output, runPreferences.modelFamily);

    await appendRunTrace(buildPhaseRunTraceEntry(
      session,
      'artifact-proposal',
      describeArtifactProposalTraceResult(proposal.outcome),
      artifactProposalPrompt,
      contextFiles,
      verificationEvidence.records,
      preferredAgentStatus,
      executionResolution.rolePolicyResolution,
      proposal.modelLabel,
      proposal.reason,
    ));

    if (proposal.outcome === 'unavailable') {
      void vscode.window.showWarningMessage(
        proposal.reason ?? 'Direct Copilot model access is unavailable for artifact proposal mode.',
      );
      return;
    }

    if (proposal.outcome === 'applied') {
      refreshPipeline();
      return;
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.runGuidedAutopilot', async (first: unknown, second?: EpicStatus) => {
    const target = resolveCommandTarget(first, second);
    if (!target.phase || !target.epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase-or-epic', currentBranchContext));
      return;
    }

    const executionGuard = await ensureEpicExecutionBranchMatch(target.epic, workspaceRoot, gitService, output, 'Run Guided Autopilot');
    if (!executionGuard.allowed) {
      return;
    }

    return runGuidedAutopilot(
      context,
      target.phase,
      target.epic,
      output,
      refreshPipeline,
      getPhaseCommandOptions(first),
      workspaceRoot,
      getEpicsPath(),
      getOwner(),
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.runFullyAutomaticAutopilot', async (first: unknown, second?: EpicStatus) => {
    const target = resolveCommandTarget(first, second);
    if (!target.phase || !target.epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase-or-epic', currentBranchContext));
      return;
    }

    const executionGuard = await ensureEpicExecutionBranchMatch(target.epic, workspaceRoot, gitService, output, 'Run Fully Automatic Autopilot');
    if (!executionGuard.allowed) {
      return;
    }

    return runGuidedAutopilot(
      context,
      target.phase,
      target.epic,
      output,
      refreshPipeline,
      {
        ...getPhaseCommandOptions(first),
        forceChatFallback: false,
        autopilotExecutionMode: 'fully-automatic',
      },
      workspaceRoot,
      getEpicsPath(),
      getOwner(),
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.pauseGuidedAutopilot', async (first: unknown, second?: EpicStatus) => {
    const target = resolveCommandTarget(first, second);
    if (!target.phase || !target.epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase-or-epic', currentBranchContext));
      return;
    }

    const sessionRecord = await phaseSessionProvider.getByEpic(target.epic.key);
    const state: GuidedAutopilotState = {
      epicKey: target.epic.key,
      workflowId: target.epic.workflowId,
      phaseId: target.phase.id,
      sessionId: sessionRecord?.sessionId,
      attempts: readGuidedAutopilotState(context.workspaceState, target.epic.key)?.attempts ?? 0,
      status: 'paused',
      updatedAt: new Date().toISOString(),
      reason: 'Paused by user command.',
    };
    await writeGuidedAutopilotState(context.workspaceState, state);
    output.appendLine(`[Autopilot] Paused ${target.epic.key} at ${target.phase.id}.`);
    void vscode.window.showInformationMessage(`Guided Autopilot paused for ${target.epic.key} / ${target.phase.name}.`);
    return state;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.resumeGuidedAutopilot', async (first: unknown, second?: EpicStatus) => {
    const target = resolveCommandTarget(first, second);
    if (!target.epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase-or-epic', currentBranchContext));
      return;
    }

    const executionGuard = await ensureEpicExecutionBranchMatch(target.epic, workspaceRoot, gitService, output, 'Resume Guided Autopilot');
    if (!executionGuard.allowed) {
      return;
    }

    const storedState = readGuidedAutopilotState(context.workspaceState, target.epic.key);
    const resumePhase = storedState
      ? findPhaseById(target.epic, storedState.phaseId)
      : target.phase;
    if (!resumePhase) {
      void vscode.window.showWarningMessage(`No resumable phase found for ${target.epic.key}.`);
      return;
    }

    return runGuidedAutopilot(
      context,
      resumePhase,
      target.epic,
      output,
      refreshPipeline,
      getPhaseCommandOptions(first),
      workspaceRoot,
      getEpicsPath(),
      getOwner(),
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.advancePhase', (first: unknown, second?: EpicStatus) => {
    const { phase, epic } = resolveCommandTarget(first, second);
    if (!phase || !epic) {
      void vscode.window.showWarningMessage(buildMissingCommandTargetMessage('phase', currentBranchContext));
      return;
    }

    void ensureEpicExecutionBranchMatch(epic, workspaceRoot, gitService, output, 'Advance Phase').then((executionGuard) => {
      if (!executionGuard.allowed) {
        return;
      }

      const nextPhase = advancePhaseState(epic, phase, getOwner(), refreshPipeline);
      const message = nextPhase
        ? `${phase.name} passed. ${nextPhase.name} is now in progress.`
        : `${phase.name} passed. Epic is complete.`;
      void vscode.window.showInformationMessage(message);
    });
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

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.startIntegratedFlow', async (options?: unknown) => {
    const flowOptions = getIntegratedFlowCommandOptions(options);
    const result = await createSpecKitWorkspaceFromInput(workspaceRoot, getSpecsPath(), getOwner(), output, flowOptions);
    if (!result) {
      return;
    }

    const packResult = createCopilotBootstrapPack(workspaceRoot, getOwner());
    const specFilePath = path.join(result.folderPath, 'spec.md');
    const copilotInstructionsPath = path.join(packResult.rootPath, 'copilot-instructions.md');
    output.appendLine(`[Integrated Flow] Spec workspace ${result.featureId}; Copilot pack created ${packResult.createdFiles.length}, skipped ${packResult.skippedFiles.length}`);

    if (flowOptions.nonInteractive) {
      if (flowOptions.openSpec) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(specFilePath));
      }
      void vscode.window.showInformationMessage(`Integrated flow ready: ${result.featureId}.`);
      return {
        featureId: result.featureId,
        folderPath: result.folderPath,
        specFilePath,
        copilotInstructionsPath,
      } satisfies IntegratedFlowCommandResult;
    }

    const choice = await vscode.window.showInformationMessage(
      `Integrated flow ready: ${result.featureId}.`,
      'Open Spec',
      'Configure MCP',
    );
    if (choice === 'Open Spec') {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(specFilePath));
      return {
        featureId: result.featureId,
        folderPath: result.folderPath,
        specFilePath,
        copilotInstructionsPath,
      } satisfies IntegratedFlowCommandResult;
    }
    if (choice === 'Configure MCP') {
      await configureMcp(workspaceRoot, getMcpConfigPath(), output);
    }
    return {
      featureId: result.featureId,
      folderPath: result.folderPath,
      specFilePath,
      copilotInstructionsPath,
    } satisfies IntegratedFlowCommandResult;
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
    if (event.affectsConfiguration('apexDelivery.epicsPath')) {
      recreateWatchers();
      refreshPipeline();
    }
  }));

  context.subscriptions.push({
    dispose: () => {
      artifactWatcher?.dispose();
      statusWatcher?.dispose();
      coordinationWatcher?.dispose();
      portfolioWatcher?.dispose();
    },
  });

  recreateWatchers();
  refreshPipeline();
  output.appendLine(`Activation complete: loaded ${provider.getEpics().length} epic(s).`);
}

async function createSpecKitWorkspaceFromInput(
  workspaceRoot: string,
  specsPath: string,
  owner: string,
  output: vscode.OutputChannel,
  options?: IntegratedFlowCommandOptions,
): Promise<SpecKitWorkspaceResult | undefined> {
  if (options?.nonInteractive) {
    const result = createSpecKitWorkspace({
      workspaceRoot,
      specsRelativePath: specsPath,
      title: options.title?.trim() || buildDefaultIntegratedFlowTitle(workspaceRoot),
      source: options.source?.trim() || 'Welcome view quick start',
      owner,
    });
    output.appendLine(`[Spec Kit] ${result.featureId}: created ${result.createdFiles.length}, skipped ${result.skippedFiles.length}`);
    return result;
  }

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

function isEpicStatusLike(value: unknown): value is EpicStatus {
  return typeof value === 'object'
    && value !== null
    && 'key' in value
    && 'workflowId' in value
    && 'phases' in value;
}

function resolveAutopilotTarget(first: unknown, second?: EpicStatus): PhaseCommandArgs {
  const directTarget = unwrapPhaseArgs(first, second);
  if (directTarget.phase && directTarget.epic) {
    return directTarget;
  }

  const epic = isEpicStatusLike(first) ? first : second;
  if (!epic) {
    return { phase: undefined, epic: undefined };
  }

  return {
    epic,
    phase: epic.phases[epic.currentPhaseIndex],
  };
}

function getPhaseCommandOptions(value: unknown): PhaseCommandOptions {
  return parsePhaseCommandOptions(value, resolveConfiguredGuidedAutopilotExecutionMode());
}

function resolveCopilotProvider(): CopilotProviderMode {
  const value = vscode.workspace.getConfiguration('apexDelivery').get<unknown>('copilot.provider');
  return value === 'copilotCliPrompt' ? 'copilotCliPrompt' : 'vscodeBuiltIn';
}

function resolveConfiguredGuidedAutopilotExecutionMode(): GuidedAutopilotExecutionMode {
  return parseGuidedAutopilotExecutionMode(vscode.workspace.getConfiguration('apexDelivery').get<unknown>('autopilot.executionMode'))
    ?? 'agent-pause';
}

function getPhaseRunPreferences(
  workflowId: string,
  phaseId: PhaseStatus['id'],
  phaseOwner?: string,
  workflowDefaults?: PhaseStatus['sessionDefaults'],
): PhaseRunPreferences {
  const defaults = getWorkspacePhaseRunDefaults();
  return {
    ...resolvePhaseRunPlan({
      userRole: getCurrentUserRole(),
      workflowId,
      phaseId,
      phaseOwner,
      workflowDefaults,
      workspaceDefaults: defaults,
      rawRolePolicies: vscode.workspace.getConfiguration('apexDelivery').get<unknown>('runPhase.rolePolicies', {}),
      rawPhaseProfiles: vscode.workspace.getConfiguration('apexDelivery').get<Record<string, unknown>>('runPhase.phaseProfiles', {}),
    }).runPreferences,
    modelFamily: undefined,
  };
}

function getPhaseExecutionResolution(epic: EpicStatus, phase: PhaseStatus): PhaseExecutionResolution {
  const runPlan = resolvePhaseRunPlan({
    userRole: getCurrentUserRole(),
    workflowId: epic.workflowId,
    phaseId: phase.id,
    phaseOwner: phase.owner,
    workflowDefaults: phase.sessionDefaults,
    workspaceDefaults: getWorkspacePhaseRunDefaults(),
    rawRolePolicies: vscode.workspace.getConfiguration('apexDelivery').get<unknown>('runPhase.rolePolicies', {}),
    rawPhaseProfiles: vscode.workspace.getConfiguration('apexDelivery').get<Record<string, unknown>>('runPhase.phaseProfiles', {}),
  });
  const runPreferences: PhaseRunPreferences = {
    ...runPlan.runPreferences,
    modelFamily: undefined,
  };
  return {
    runPreferences,
    preferredAgentStatus: resolvePreferredChatAgentStatus(runPreferences),
    rolePolicyResolution: runPlan.rolePolicyResolution,
  };
}

function getWorkspacePhaseRunDefaults(): PhaseRunPreferences {
  const config = vscode.workspace.getConfiguration('apexDelivery');
  return {
    autoSubmit: config.get<boolean>('runPhase.autoSubmit', true),
    agentTag: normalizeNonEmptyString(config.get<unknown>('runPhase.agentTag')),
    preferredChatAgent: normalizeNonEmptyString(config.get<unknown>('runPhase.preferredChatAgent')),
    starterPrompt: normalizeNonEmptyString(config.get<unknown>('runPhase.starterPrompt')),
    starterPromptPlacement: normalizeStarterPromptPlacement(config.get<unknown>('runPhase.starterPromptPlacement')) ?? 'prepend',
    modelFamily: undefined,
  };
}

function getCurrentUserRole(): string | undefined {
  return normalizeNonEmptyString(vscode.workspace.getConfiguration('apexDelivery').get<unknown>('userRole'));
}

async function configurePhaseProfile(
  phase: PhaseStatus | undefined,
  epic: EpicStatus | undefined,
  output: vscode.OutputChannel,
): Promise<void> {
  const target = phase && epic
    ? {
      id: phase.id,
      name: phase.name,
      workflowId: epic.workflowId,
      workflowName: epic.workflowName,
    } satisfies PhaseProfileTarget
    : await pickPhaseProfileTarget(output);
  if (!target) {
    return;
  }

  const defaults = getWorkspacePhaseRunDefaults();
  const existingOverride = resolvePhaseRunProfileOverride(
    vscode.workspace.getConfiguration('apexDelivery').get<Record<string, unknown>>('runPhase.phaseProfiles', {}),
    target.workflowId,
    target.id,
  );
  const nextOverride = await promptForPhaseRunProfile(target, defaults, existingOverride);
  if (!nextOverride) {
    return;
  }

  try {
    const configuration = vscode.workspace.getConfiguration('apexDelivery');
    const nextProfiles = {
      ...configuration.get<Record<string, unknown>>('runPhase.phaseProfiles', {}),
    };
    const nextWorkflowProfiles = isRecord(nextProfiles[target.workflowId])
      ? { ...(nextProfiles[target.workflowId] as Record<string, unknown>) }
      : {};

    if (Object.keys(nextOverride).length === 0) {
      delete nextWorkflowProfiles[target.id];
    } else {
      nextWorkflowProfiles[target.id] = nextOverride;
    }

    if (Object.keys(nextWorkflowProfiles).length === 0) {
      delete nextProfiles[target.workflowId];
    } else {
      nextProfiles[target.workflowId] = nextWorkflowProfiles;
    }

    await configuration.update('runPhase.phaseProfiles', nextProfiles, vscode.ConfigurationTarget.Workspace);
    output.appendLine(`[Config] Saved run-phase profile for ${target.workflowId}/${target.id}: ${formatPhaseProfileLogValue(nextOverride)}`);
    const resolved = getPhaseRunPreferences(target.workflowId, target.id);
    void vscode.window.showInformationMessage(
      `Saved ${target.workflowName} / ${target.name} profile. Preferred agent: ${resolved.preferredChatAgent ?? 'none'}; auto-submit: ${formatAutoSubmitLabel(resolved.autoSubmit)}; agent tag: ${resolved.agentTag ?? 'none'}.`,
    );
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    output.appendLine(`[Config] Failed to save run-phase profile for ${target.workflowId}/${target.id}: ${message}`);
    void vscode.window.showErrorMessage(`Unable to save ${target.workflowName} / ${target.name} profile: ${message}`);
  }
}

async function pickPhaseProfileTarget(output: vscode.OutputChannel): Promise<PhaseProfileTarget | undefined> {
  type PhaseProfilePick = vscode.QuickPickItem & { phaseId: PhaseStatus['id'] };

  const workflow = await pickWorkflowDefinition(output, {
    title: 'Configure phase profile',
    placeHolder: 'Choose which workflow owns the phase profile.',
  });
  if (!workflow) {
    return undefined;
  }

  const selection = await vscode.window.showQuickPick<PhaseProfilePick>(
    workflow.phases.map((phase) => ({
      label: phase.name,
      description: phase.id,
      detail: `${phase.owner} • ${phase.artifact}`,
      phaseId: phase.id,
    })),
    {
      title: 'Configure phase profile',
      placeHolder: 'Choose which delivery phase gets its own Copilot run profile.',
      ignoreFocusOut: true,
    },
  );

  if (!selection) {
    return undefined;
  }

  return {
    id: selection.phaseId,
    name: selection.label,
    workflowId: workflow.id,
    workflowName: workflow.name,
  };
}

async function promptForPhaseRunProfile(
  target: PhaseProfileTarget,
  defaults: PhaseRunPreferences,
  existingOverride: PhaseRunProfileOverride | undefined,
): Promise<PhaseRunProfileOverride | undefined> {
  type AutoSubmitPick = vscode.QuickPickItem & { value: boolean | 'inherit' };
  const autoSubmitSelection = await vscode.window.showQuickPick<AutoSubmitPick>(
    [
      {
        label: 'Inherit workspace default',
        description: formatAutoSubmitLabel(defaults.autoSubmit),
        detail: 'Use the workspace-level Run Phase auto-submit setting for this phase.',
        value: 'inherit',
        picked: existingOverride?.autoSubmit === undefined,
      },
      {
        label: 'Auto-submit prompt',
        description: 'Submit immediately in GitHub Copilot Chat',
        detail: 'Best when this phase should start running without an extra confirmation step.',
        value: true,
        picked: existingOverride?.autoSubmit === true,
      },
      {
        label: 'Open as draft',
        description: 'Prefill only and wait for manual send',
        detail: 'Best for controlled review before the phase prompt is submitted.',
        value: false,
        picked: existingOverride?.autoSubmit === false,
      },
    ],
    {
      title: `${target.workflowName} / ${target.name}: auto-submit behavior`,
      placeHolder: 'Choose how this phase should open in GitHub Copilot Chat.',
      ignoreFocusOut: true,
    },
  );
  if (!autoSubmitSelection) {
    return undefined;
  }

  type AgentTagModePick = vscode.QuickPickItem & { mode: 'inherit' | 'custom' };
  const agentTagMode = await vscode.window.showQuickPick<AgentTagModePick>(
    [
      {
        label: 'Inherit workspace default',
        description: defaults.agentTag ?? 'No workspace agent tag',
        detail: 'Keep using the workspace-level best-effort routing tag for this phase.',
        mode: 'inherit',
        picked: existingOverride?.agentTag === undefined,
      },
      {
        label: 'Set custom agent tag',
        description: existingOverride?.agentTag ?? defaults.agentTag ?? '#dev-orchestrator',
        detail: 'Use a different prompt hint for this phase, for example #dev-orchestrator or #review-pass.',
        mode: 'custom',
        picked: existingOverride?.agentTag !== undefined,
      },
    ],
    {
      title: `${target.workflowName} / ${target.name}: agent routing hint`,
      placeHolder: 'Choose whether this phase inherits or overrides the agent tag.',
      ignoreFocusOut: true,
    },
  );
  if (!agentTagMode) {
    return undefined;
  }

  let agentTag: string | undefined;
  if (agentTagMode.mode === 'custom') {
    const input = await vscode.window.showInputBox({
      title: `${target.workflowName} / ${target.name}: custom agent tag`,
      prompt: 'Enter the best-effort agent routing hint appended to the prompt for this phase.',
      placeHolder: '#dev-orchestrator',
      value: existingOverride?.agentTag ?? defaults.agentTag ?? '#dev-orchestrator',
      ignoreFocusOut: true,
      validateInput: (value: string) => normalizeNonEmptyString(value)
        ? null
        : 'Agent tag cannot be empty. Choose inherit instead if this phase should not override it.',
    });
    if (input === undefined) {
      return undefined;
    }

    agentTag = normalizeNonEmptyString(input);
  }

  type PreferredAgentModePick = vscode.QuickPickItem & { mode: 'inherit' | 'custom' };
  const preferredAgentMode = await vscode.window.showQuickPick<PreferredAgentModePick>(
    [
      {
        label: 'Inherit workspace default',
        description: defaults.preferredChatAgent ?? 'No workspace preferred agent',
        detail: 'Keep using the workspace-level preferred custom agent for this phase.',
        mode: 'inherit',
        picked: existingOverride?.preferredChatAgent === undefined,
      },
      {
        label: 'Set preferred custom agent',
        description: existingOverride?.preferredChatAgent ?? defaults.preferredChatAgent ?? 'Business Analyst',
        detail: 'Store a human-readable preferred agent name such as Business Analyst or Code Reviewer.',
        mode: 'custom',
        picked: existingOverride?.preferredChatAgent !== undefined,
      },
    ],
    {
      title: `${target.workflowName} / ${target.name}: preferred custom agent`,
      placeHolder: 'Choose whether this phase inherits or overrides the preferred custom agent name.',
      ignoreFocusOut: true,
    },
  );
  if (!preferredAgentMode) {
    return undefined;
  }

  let preferredChatAgent: string | undefined;
  if (preferredAgentMode.mode === 'custom') {
    const input = await vscode.window.showInputBox({
      title: `${target.workflowName} / ${target.name}: preferred custom agent`,
      prompt: 'Enter the preferred custom agent name shown in GitHub Copilot Chat for this phase.',
      placeHolder: 'Business Analyst',
      value: existingOverride?.preferredChatAgent ?? defaults.preferredChatAgent ?? 'Business Analyst',
      ignoreFocusOut: true,
      validateInput: (value: string) => normalizeNonEmptyString(value)
        ? null
        : 'Preferred custom agent cannot be empty. Choose inherit instead if this phase should not override it.',
    });
    if (input === undefined) {
      return undefined;
    }

    preferredChatAgent = normalizeNonEmptyString(input);
  }

  const nextOverride: PhaseRunProfileOverride = {};
  if (autoSubmitSelection.value !== 'inherit') {
    nextOverride.autoSubmit = autoSubmitSelection.value;
  }
  if (agentTag !== undefined) {
    nextOverride.agentTag = agentTag;
  }
  if (preferredChatAgent !== undefined) {
    nextOverride.preferredChatAgent = preferredChatAgent;
  }
  if (existingOverride?.starterPrompt !== undefined) {
    nextOverride.starterPrompt = existingOverride.starterPrompt;
  }

  const confirmation = await vscode.window.showInformationMessage(
    buildPhaseProfileConfirmation(target, defaults, nextOverride),
    { modal: true },
    'Save Profile',
  );
  if (confirmation !== 'Save Profile') {
    return undefined;
  }

  return nextOverride;
}

function buildPhaseProfileConfirmation(
  target: PhaseProfileTarget,
  defaults: PhaseRunPreferences,
  nextOverride: PhaseRunProfileOverride,
): string {
  const autoSubmitSummary = nextOverride.autoSubmit === undefined
    ? `Inherit workspace default (${formatAutoSubmitLabel(defaults.autoSubmit)})`
    : formatAutoSubmitLabel(nextOverride.autoSubmit);
  const agentTagSummary = nextOverride.agentTag === undefined
    ? `Inherit workspace default (${defaults.agentTag ?? 'none'})`
    : nextOverride.agentTag;
  const preferredAgentSummary = nextOverride.preferredChatAgent === undefined
    ? `Inherit workspace default (${defaults.preferredChatAgent ?? 'none'})`
    : nextOverride.preferredChatAgent;

  return `Save ${target.workflowName} / ${target.name} profile? Preferred agent: ${preferredAgentSummary}; auto-submit: ${autoSubmitSummary}; agent tag: ${agentTagSummary}.`;
}

function formatAutoSubmitLabel(value: boolean): string {
  return value ? 'Auto-submit' : 'Open as draft';
}

function formatPhaseProfileLogValue(override: PhaseRunProfileOverride): string {
  return Object.keys(override).length === 0 ? 'workspace defaults' : JSON.stringify(override);
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getConfiguredWorkflowDefinitions(output?: vscode.OutputChannel): readonly WorkflowDefinition[] {
  const rawDefinitions = vscode.workspace.getConfiguration('apexDelivery').get<unknown>('workflowDefinitions', {});
  const parsed = parseWorkflowDefinitions(rawDefinitions, {
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
  for (const error of parsed.errors) {
    output?.appendLine(`[Workflow] ${error}`);
  }
  return parsed.workflows;
}

function resolveWorkflowDefinition(workflowId: string | undefined, output?: vscode.OutputChannel): WorkflowDefinition {
  const workflows = getConfiguredWorkflowDefinitions(output);
  if (workflowId) {
    const match = workflows.find((workflow) => workflow.id === workflowId);
    if (match) {
      return match;
    }

    output?.appendLine(`[Workflow] Unknown workflow "${workflowId}". Falling back to ${getDefaultWorkflowDefinition().id}.`);
  }

  return workflows[0] ?? getDefaultWorkflowDefinition();
}

async function pickWorkflowDefinition(
  output: vscode.OutputChannel,
  options: { title: string; placeHolder: string },
): Promise<WorkflowDefinition | undefined> {
  const workflows = getConfiguredWorkflowDefinitions(output);
  if (workflows.length === 1) {
    return workflows[0];
  }

  type WorkflowPick = vscode.QuickPickItem & { workflow: WorkflowDefinition };
  const selection = await vscode.window.showQuickPick<WorkflowPick>(
    workflows.map((workflow) => ({
      label: workflow.name,
      description: workflow.id,
      detail: `${workflow.phases.length} phases${workflow.source === 'built-in' ? ' • built-in default' : ''}`,
      workflow,
    })),
    {
      title: options.title,
      placeHolder: options.placeHolder,
      ignoreFocusOut: true,
    },
  );

  return selection?.workflow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildDefaultIntegratedFlowTitle(workspaceRoot: string): string {
  const workspaceName = path.basename(workspaceRoot).trim();
  if (workspaceName.length > 0) {
    return `${workspaceName} integrated delivery flow`;
  }
  return 'Integrated delivery flow';
}

async function runGuidedAutopilot(
  context: vscode.ExtensionContext,
  phase: PhaseStatus,
  epic: EpicStatus,
  output: vscode.OutputChannel,
  refreshPipeline: () => void,
  options: PhaseCommandOptions,
  workspaceRoot: string,
  epicsPath: string,
  owner: string,
): Promise<GuidedAutopilotResult> {
  const initialPolicy = resolveGuidedAutopilotPolicy(phase, epic.workflowId);
  if (!initialPolicy.enabled) {
    const reason = `${phase.name} is not marked as autopilot-enabled for this epic workflow.`;
    output.appendLine(`[Autopilot] ${reason}`);
    if (!options.nonInteractive) {
      void vscode.window.showInformationMessage(reason);
    }
    return {
      outcome: 'not-enabled',
      epicKey: epic.key,
      phaseId: phase.id,
      attempts: 0,
      reason,
    };
  }

  let currentEpic = epic;
  let currentPhase: PhaseStatus | undefined = phase;
  let lastPhaseRun: PhaseCommandResult | undefined;
  let attempts = readGuidedAutopilotState(context.workspaceState, epic.key)?.phaseId === phase.id
    ? readGuidedAutopilotState(context.workspaceState, epic.key)?.attempts ?? 0
    : 0;

  while (currentPhase) {
    const policy = resolveGuidedAutopilotPolicy(currentPhase, currentEpic.workflowId);
    if (!policy.enabled) {
      await clearGuidedAutopilotState(context.workspaceState, currentEpic.key);
      return {
        outcome: 'advanced',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        nextPhaseId: currentPhase.id,
        reason: `${currentPhase.name} is waiting for manual execution because Guided Autopilot is disabled for that phase.`,
        lastPhaseRun,
      };
    }

    if (policy.pauseOnManualIntervention && hasDirtyArtifactDocument(currentPhase.artifactPath)) {
      const reason = `Unsaved changes were detected in ${path.basename(currentPhase.artifactPath)}.`;
      await writeGuidedAutopilotState(context.workspaceState, {
        epicKey: currentEpic.key,
        workflowId: currentEpic.workflowId,
        phaseId: currentPhase.id,
        sessionId: resolveAutopilotSessionId(context.workspaceState, currentEpic.key, lastPhaseRun),
        attempts,
        status: 'paused',
        updatedAt: new Date().toISOString(),
        reason,
      });
      output.appendLine(`[Autopilot] Paused ${currentEpic.key} at ${currentPhase.id}: ${reason}`);
      if (!options.nonInteractive) {
        void vscode.window.showWarningMessage(`Guided Autopilot paused for ${currentEpic.key} / ${currentPhase.name}: ${reason}`);
      }
      return {
        outcome: 'paused',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        reason,
        lastPhaseRun,
      };
    }

    await writeGuidedAutopilotState(context.workspaceState, {
      epicKey: currentEpic.key,
      workflowId: currentEpic.workflowId,
      phaseId: currentPhase.id,
      sessionId: resolveAutopilotSessionId(context.workspaceState, currentEpic.key, lastPhaseRun),
      attempts,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    output.appendLine(`[Autopilot] Running ${currentEpic.key} / ${currentPhase.id} (attempt ${attempts + 1}).`);

    const phaseRun = await vscode.commands.executeCommand<PhaseCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase: currentPhase,
      epic: currentEpic,
      nonInteractive: true,
      forceChatFallback: options.forceChatFallback,
      autopilotExecutionMode: options.autopilotExecutionMode,
    });

    if (!phaseRun) {
      const reason = `Guided Autopilot stopped because ${currentEpic.key} / ${currentPhase.id} did not return a phase result.`;
      await writeGuidedAutopilotState(context.workspaceState, {
        epicKey: currentEpic.key,
        workflowId: currentEpic.workflowId,
        phaseId: currentPhase.id,
        sessionId: resolveAutopilotSessionId(context.workspaceState, currentEpic.key),
        attempts,
        status: 'paused',
        updatedAt: new Date().toISOString(),
        reason,
      });
      return {
        outcome: 'cancelled',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        reason,
      };
    }

    attempts += 1;
    lastPhaseRun = phaseRun;

    if (phaseRun.mode === 'blocked') {
      const reason = phaseRun.fallbackReason ?? `Guided Autopilot could not continue ${currentEpic.key} / ${currentPhase.name} in fully automatic mode.`;
      await writeGuidedAutopilotState(context.workspaceState, {
        epicKey: currentEpic.key,
        workflowId: currentEpic.workflowId,
        phaseId: currentPhase.id,
        sessionId: resolveAutopilotSessionId(context.workspaceState, currentEpic.key, phaseRun),
        attempts,
        status: 'paused',
        updatedAt: new Date().toISOString(),
        reason,
      });
      output.appendLine(`[Autopilot] ${reason}`);
      if (!options.nonInteractive) {
        void vscode.window.showWarningMessage(reason);
      }
      return {
        outcome: 'paused',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        reason,
        lastPhaseRun,
      };
    }

    if (phaseRun.mode === 'agent-chat') {
      const reason = phaseRun.chatLaunchResult === 'submitted'
        ? `Guided Autopilot launched Copilot agent mode for ${currentEpic.key} / ${currentPhase.name}. Resume after the agent finishes updating the artifact.`
        : `Guided Autopilot opened Copilot agent mode for ${currentEpic.key} / ${currentPhase.name}. Submit or review the agent prompt, then resume after the artifact is updated.`;
      await writeGuidedAutopilotState(context.workspaceState, {
        epicKey: currentEpic.key,
        workflowId: currentEpic.workflowId,
        phaseId: currentPhase.id,
        sessionId: resolveAutopilotSessionId(context.workspaceState, currentEpic.key, phaseRun),
        attempts,
        status: 'paused',
        updatedAt: new Date().toISOString(),
        reason,
      });
      output.appendLine(`[Autopilot] ${reason}`);
      if (!options.nonInteractive) {
        void vscode.window.showInformationMessage(reason);
      }
      return {
        outcome: 'paused',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        reason,
        lastPhaseRun,
      };
    }

    if (!didVerificationPass(phaseRun.verification)) {
      if (attempts <= policy.retryLimit) {
        output.appendLine(`[Autopilot] Verification did not pass for ${currentEpic.key} / ${currentPhase.id}. Retrying ${attempts}/${policy.retryLimit}.`);
        continue;
      }

      const reason = `Verification did not pass for ${currentEpic.key} / ${currentPhase.name} after ${attempts} attempt(s).`;
      await writeGuidedAutopilotState(context.workspaceState, {
        epicKey: currentEpic.key,
        workflowId: currentEpic.workflowId,
        phaseId: currentPhase.id,
        sessionId: resolveAutopilotSessionId(context.workspaceState, currentEpic.key, phaseRun),
        attempts,
        status: 'paused',
        updatedAt: new Date().toISOString(),
        reason,
      });
      output.appendLine(`[Autopilot] ${reason}`);
      if (!options.nonInteractive) {
        void vscode.window.showWarningMessage(`${reason} Review the artifact, then resume Guided Autopilot when ready.`);
      }
      return {
        outcome: 'paused',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        reason,
        lastPhaseRun,
      };
    }

    const nextPhase = advancePhaseState(currentEpic, currentPhase, owner, refreshPipeline);
    if (!nextPhase) {
      await clearGuidedAutopilotState(context.workspaceState, currentEpic.key);
      if (!options.nonInteractive) {
        void vscode.window.showInformationMessage(`Guided Autopilot completed ${currentEpic.key}.`);
      }
      return {
        outcome: 'completed',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        lastPhaseRun,
      };
    }

    const rescannedEpic = rescanEpic(workspaceRoot, epicsPath, currentEpic.key);
    const rescannedNextPhase = findPhaseById(rescannedEpic, nextPhase.id);
    if (!rescannedNextPhase) {
      await clearGuidedAutopilotState(context.workspaceState, currentEpic.key);
      return {
        outcome: 'advanced',
        epicKey: currentEpic.key,
        phaseId: currentPhase.id,
        attempts,
        nextPhaseId: nextPhase.id,
        lastPhaseRun,
      };
    }

    if (!resolveGuidedAutopilotPolicy(rescannedNextPhase, rescannedEpic.workflowId).enabled) {
      await clearGuidedAutopilotState(context.workspaceState, currentEpic.key);
      if (!options.nonInteractive) {
        void vscode.window.showInformationMessage(`Guided Autopilot advanced ${currentEpic.key} to ${rescannedNextPhase.name} and paused for manual continuation.`);
      }
      return {
        outcome: 'advanced',
        epicKey: rescannedEpic.key,
        phaseId: currentPhase.id,
        attempts,
        nextPhaseId: rescannedNextPhase.id,
        reason: `${rescannedNextPhase.name} is not autopilot-enabled, so manual continuation is required.`,
        lastPhaseRun,
      };
    }

    currentEpic = rescannedEpic;
    currentPhase = rescannedNextPhase;
    attempts = 0;
  }

  await clearGuidedAutopilotState(context.workspaceState, epic.key);
  return {
    outcome: 'completed',
    epicKey: epic.key,
    phaseId: phase.id,
    attempts,
    lastPhaseRun,
  };
}

function resolveAutopilotSessionId(
  store: vscode.Memento,
  epicKey: string,
  phaseRun?: PhaseCommandResult,
): string | undefined {
  return phaseRun?.sessionId ?? readGuidedAutopilotState(store, epicKey)?.sessionId;
}

function resolveWorkflowPhaseAutopilotPolicy(
  workflowId: string | undefined,
  phaseId: PhaseStatus['id'],
): NonNullable<PhaseStatus['autopilot']> | undefined {
  const workflow = resolveWorkflowDefinition(workflowId);
  return workflow.phases.find((candidate) => candidate.id === phaseId)?.autopilot;
}

function resolveGuidedAutopilotPolicy(
  phase: PhaseStatus,
  workflowId?: string,
): Required<NonNullable<PhaseStatus['autopilot']>> {
  const config = vscode.workspace.getConfiguration('apexDelivery');
  const workflowPolicy = resolveWorkflowPhaseAutopilotPolicy(workflowId, phase.id);
  return {
    enabled: phase.autopilot?.enabled ?? workflowPolicy?.enabled ?? false,
    retryLimit: phase.autopilot?.retryLimit
      ?? workflowPolicy?.retryLimit
      ?? Math.max(0, config.get<number>('autopilot.defaultRetryLimit', 1)),
    pauseOnManualIntervention: phase.autopilot?.pauseOnManualIntervention
      ?? workflowPolicy?.pauseOnManualIntervention
      ?? config.get<boolean>('autopilot.pauseOnManualIntervention', true),
  };
}

function didVerificationPass(records: readonly VerificationTraceRecord[] | undefined): boolean {
  if (!records || records.length === 0) {
    return false;
  }

  return records.some((record) => record.outcome === 'passed')
    && records.every((record) => record.outcome !== 'failed');
}

function hasDirtyArtifactDocument(artifactPath: string): boolean {
  return vscode.workspace.textDocuments.some((document) => document.uri.fsPath === artifactPath && document.isDirty);
}

function rescanEpic(workspaceRoot: string, epicsPath: string, epicKey: string): EpicStatus {
  return new PipelineScanner(workspaceRoot, epicsPath).scanEpic(epicKey);
}

function findPhaseById(epic: EpicStatus, phaseId: string): PhaseStatus | undefined {
  return epic.phases.find((candidate) => candidate.id === phaseId);
}

function nextPhaseFor(epic: EpicStatus, phase: PhaseStatus): PhaseStatus | undefined {
  const index = epic.phases.findIndex((candidate) => candidate.id === phase.id);
  if (index < 0) {
    return undefined;
  }
  return epic.phases[index + 1];
}

function advancePhaseState(
  epic: EpicStatus,
  phase: PhaseStatus,
  owner: string,
  refreshPipeline: () => void,
): PhaseStatus | undefined {
  writePhaseStatus(
    phase.statusPath,
    phase.id,
    'passed',
    owner,
    `${phase.name} passed.`,
  );

  const nextPhase = nextPhaseFor(epic, phase);
  if (nextPhase) {
    writePhaseStatus(
      nextPhase.statusPath,
      nextPhase.id,
      'in_progress',
      owner,
      `Ready after ${phase.name} passed.`,
    );
  }

  refreshPipeline();
  return nextPhase;
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

function ensurePhaseArtifactExists(
  phase: PhaseStatus,
  epic: EpicStatus,
  workspaceRoot: string,
  templateRoot: string,
  owner: string,
  output: vscode.OutputChannel,
  refreshPipeline: () => void,
): void {
  if (fs.existsSync(phase.artifactPath)) {
    return;
  }

  const templateContext = buildTemplateContext(epic, owner);
  writeFromTemplate(workspaceRoot, templateRoot, resolvePhaseTemplateRef(phase), phase.artifactPath, templateContext);
  output.appendLine(`[Copilot] Seeded artifact: ${phase.artifactPath}`);
  refreshPipeline();
}

function buildPhaseSessionContext(
  phase: PhaseStatus,
  epic: EpicStatus,
  workspaceRoot: string,
): PhaseSessionContext {
  const sessionKey = buildPhaseChatSessionKey(epic);
  const referencePaths = isPbiDeliveryWorkflow(epic.workflowId)
    ? listPbiReferencePaths(epic, phase)
    : [
      path.join(epic.folderPath, 'EPIC.md'),
      phase.artifactPath,
      phase.statusPath,
    ];
  return {
    sessionId: sessionKey,
    sessionKey,
    transportId: 'not-configured',
    transportStability: 'not-configured',
    sessionStatus: 'prepared',
    phase,
    epic,
    workspaceRoot,
    references: referencePaths.map((filePath) => readContextFile(describePhaseReference(filePath, epic, phase), filePath, resolvePhaseReferenceLimit(filePath))),
  };
}

async function resolvePhaseSessionContext(
  provider: ApexSessionProvider,
  phase: PhaseStatus,
  epic: EpicStatus,
  workspaceRoot: string,
): Promise<PhaseSessionContext> {
  const session = buildPhaseSessionContext(phase, epic, workspaceRoot);
  const record = await provider.getOrCreate(epic, phase);
  return bindSessionRecordToContext(session, record);
}

function bindSessionRecordToContext(
  session: PhaseSessionContext,
  record: ApexSessionRecord,
): PhaseSessionContext {
  return {
    ...session,
    sessionId: record.sessionId,
    sessionKey: record.sessionKey,
    transportId: record.transportId,
    transportStability: record.transportStability,
    transportResource: record.transportResource,
    sessionStatus: record.status,
    lastLaunchMode: record.lastLaunchMode,
  };
}

function sessionToSessionRecord(session: PhaseSessionContext): ApexSessionRecord {
  const now = new Date().toISOString();
  return {
    sessionId: session.sessionId,
    sessionKey: session.sessionKey,
    epicKey: session.epic.key,
    workflowId: session.epic.workflowId,
    currentPhaseId: session.phase.id,
    currentPhaseName: session.phase.name,
    transportId: session.transportId,
    transportStability: session.transportStability,
    transportResource: session.transportResource,
    status: session.sessionStatus,
    lastLaunchMode: session.lastLaunchMode,
    createdAt: now,
    updatedAt: now,
  };
}

async function bindPhaseSessionTransport(
  provider: ApexSessionProvider,
  session: PhaseSessionContext,
  transport: { id: string; stability: ApexTransportStability; supportsExactSessionTargeting: boolean },
  options?: {
    resource?: string;
    launchMode?: ApexSessionRecord['lastLaunchMode'];
    fallbackReason?: string;
  },
): Promise<PhaseSessionContext> {
  const record = await provider.bindTransport(session.sessionId, transport, options);
  return record ? bindSessionRecordToContext(session, record) : {
    ...session,
    transportId: transport.id,
    transportStability: transport.stability,
    transportResource: options?.resource ?? session.transportResource,
    lastLaunchMode: options?.launchMode ?? session.lastLaunchMode,
  };
}

async function markPhaseSessionStatus(
  provider: ApexSessionProvider,
  session: PhaseSessionContext,
  status: ApexSessionRecord['status'],
  reason?: string,
): Promise<PhaseSessionContext> {
  const record = await provider.markStatus(session.sessionId, status, reason);
  return record ? bindSessionRecordToContext(session, record) : {
    ...session,
    sessionStatus: status,
  };
}

function buildPhaseSessionResultMetadata(session: PhaseSessionContext): Pick<PhaseCommandResult, 'sessionId' | 'transportId' | 'transportStability'> {
  return {
    sessionId: session.sessionId,
    transportId: session.transportId,
    transportStability: session.transportStability,
  };
}

function buildPhaseChatSessionKey(epic: EpicStatus): string {
  const digest = createHash('sha1')
    .update(path.normalize(epic.folderPath).toLowerCase())
    .update('\n')
    .update(epic.key)
    .digest('hex')
    .slice(0, 12);
  return `${epic.key}-${digest}`;
}

function buildPhaseChatSessionMarker(session: PhaseSessionContext): string {
  return `APEX_SESSION=${session.sessionKey}`;
}

function buildPhaseChatSessionUri(session: Pick<PhaseSessionContext, 'sessionId'>): vscode.Uri {
  const encodedSessionId = Buffer.from(session.sessionId, 'utf8').toString('base64url');
  return vscode.Uri.from({
    scheme: PHASE_CHAT_SESSION_URI_SCHEME,
    authority: 'local',
    path: `/${encodedSessionId}`,
  });
}

function extractPhaseChatSessionKey(prompt: string): string | undefined {
  return prompt.match(PHASE_CHAT_SESSION_PATTERN)?.[1];
}

function readContextFile(label: string, filePath: string, maxChars: number): PhaseContextFile {
  if (!fs.existsSync(filePath)) {
    return {
      label,
      filePath,
      content: '[missing file]',
      truncated: false,
    };
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (raw.length <= maxChars) {
    return {
      label,
      filePath,
      content: raw.length > 0 ? raw : '[empty file]',
      truncated: false,
    };
  }

  return {
    label,
    filePath,
    content: `${raw.slice(0, maxChars)}\n\n[truncated]`,
    truncated: true,
  };
}

function describePhaseReference(filePath: string, epic: EpicStatus, phase: PhaseStatus): string {
  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === 'epic.md') {
    return 'Epic brief';
  }
  if (filePath === phase.artifactPath) {
    return 'Phase artifact';
  }
  if (filePath === phase.statusPath) {
    return 'Phase status';
  }
  if (baseName === 'pbi.md') {
    return 'PBI intake';
  }
  if (baseName === 'investigation.md') {
    return 'Investigation';
  }
  if (baseName === 'code-flow.md') {
    return 'Code flow';
  }
  if (baseName === 'design-decision.md') {
    return 'Design decision';
  }
  if (baseName === 'test-decision.md') {
    return 'Test decision';
  }
  if (baseName === 'tdd-plan.md') {
    return 'TDD plan';
  }
  if (baseName === 'pbi-review.md') {
    return 'PBI review';
  }
  if (baseName === 'evidence.md') {
    return 'Evidence pack';
  }
  return `${epic.key} context`;
}

function resolvePhaseReferenceLimit(filePath: string): number {
  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === 'epic.md' || baseName === 'pbi.md') {
    return CONTEXT_LIMITS.epic;
  }
  if (baseName.endsWith('.json')) {
    return CONTEXT_LIMITS.status;
  }
  return CONTEXT_LIMITS.artifact;
}

function readStoredRunTraceHistory(context: vscode.ExtensionContext): PhaseRunTraceEntry[] {
  const stored = context.workspaceState.get<PhaseRunTraceEntry[]>(PHASE_RUN_TRACE_STORAGE_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function buildPhaseRunTraceEntry(
  session: PhaseSessionContext,
  executionPath: PhaseRunTraceEntry['executionPath'],
  result: string,
  prompt: string,
  contextFiles: readonly string[],
  verification: readonly VerificationTraceRecord[],
  preferredAgentStatus: PreferredChatAgentStatus,
  rolePolicyResolution?: RolePolicyResolution,
  modelLabel?: string,
  fallbackReason?: string,
): PhaseRunTraceEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    epicKey: session.epic.key,
    epicTitle: session.epic.title,
    sessionId: session.sessionId,
    sessionKey: session.sessionKey,
    transportId: session.transportId,
    transportStability: session.transportStability,
    workflowId: session.epic.workflowId,
    workflowName: session.epic.workflowName,
    phaseId: session.phase.id,
    phaseName: session.phase.name,
    artifactPath: displayPath(session.workspaceRoot, session.phase.artifactPath),
    executionPath,
    result,
    prompt: truncateTraceText(prompt, 12_000),
    contextFiles,
    fallbackReason,
    preferredAgent: preferredAgentStatus.preferredAgent,
    activeAgent: preferredAgentStatus.activeAgent,
    agentSelectionStatus: preferredAgentStatus.status,
    agentSelectionNote: preferredAgentStatus.note,
    userRole: rolePolicyResolution?.userRole,
    preferredRole: rolePolicyResolution?.preferredRole,
    roleRoutingStatus: rolePolicyResolution?.status,
    roleRoutingNote: rolePolicyResolution?.note,
    modelLabel,
    verification,
  };
}

function truncateTraceText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function buildTraceContextFiles(session: PhaseSessionContext): readonly string[] {
  return session.references.map((reference) => displayPath(session.workspaceRoot, reference.filePath));
}

function resolvePreferredChatAgentStatus(runPreferences: PhaseRunPreferences): PreferredChatAgentStatus {
  if (!runPreferences.preferredChatAgent) {
    return {
      status: 'not-configured',
    };
  }

  return {
    preferredAgent: runPreferences.preferredChatAgent,
    status: 'unavailable',
    note: `Preferred agent is ${runPreferences.preferredChatAgent}. Active custom agent detection is unavailable via the public VS Code Chat API, so confirm the Chat agent selector manually.`,
  };
}

function reportPreferredChatAgentStatus(
  session: PhaseSessionContext,
  preferredAgentStatus: PreferredChatAgentStatus,
  output: vscode.OutputChannel,
  nonInteractive: boolean,
): void {
  if (!preferredAgentStatus.preferredAgent) {
    return;
  }

  const message = preferredAgentStatus.status === 'mismatched' && preferredAgentStatus.activeAgent
    ? `${session.phase.name} prefers the GitHub Copilot Chat agent "${preferredAgentStatus.preferredAgent}", but "${preferredAgentStatus.activeAgent}" is active.`
    : `${session.phase.name} prefers the GitHub Copilot Chat agent "${preferredAgentStatus.preferredAgent}". Active custom agent detection is unavailable via public API, so confirm the Chat selector manually.`;

  output.appendLine(`[Copilot] ${message}`);
  if (!nonInteractive) {
    void vscode.window.showInformationMessage(message);
  }
}

async function confirmRoleRouting(
  rolePolicyResolution: RolePolicyResolution,
  nonInteractive: boolean,
): Promise<boolean> {
  if (rolePolicyResolution.status !== 'mismatched' || !rolePolicyResolution.note) {
    return true;
  }

  if (nonInteractive) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `${rolePolicyResolution.note} Continue anyway?`,
    'Continue',
    'Cancel',
  );
  return choice === 'Continue';
}

function describeChatLaunchTraceResult(chatLaunchResult: CopilotChatLaunchResult, label: string): string {
  switch (chatLaunchResult) {
    case 'submitted':
      return `Submitted ${label} prompt.`;
    case 'prefilled':
      return `Opened ${label} prompt as a draft.`;
    case 'opened':
      return `Reopened the existing ${label} session without prefilling the prompt.`;
    default:
      return `Could not open ${label} automatically.`;
  }
}

function describeArtifactProposalTraceResult(outcome: ArtifactProposalResult['outcome']): string {
  switch (outcome) {
    case 'applied':
      return 'Applied the proposed artifact update.';
    case 'rejected':
      return 'Rejected the proposed artifact update after reviewing the diff.';
    case 'unchanged':
      return 'No artifact changes were proposed.';
    default:
      return 'Artifact proposal flow was unavailable.';
  }
}

async function attachVerificationEvidence(
  session: PhaseSessionContext,
  output: vscode.OutputChannel,
  nonInteractive: boolean,
): Promise<VerificationEvidence> {
  const capturedAt = new Date().toISOString();
  const configuration = vscode.workspace.getConfiguration('apexDelivery');
  const automationEnabled = configuration.get<boolean>('verification.autoAttach', true);
  const outputLimit = Math.max(500, configuration.get<number>('verification.maxOutputChars', VERIFICATION_OUTPUT_LIMIT_DEFAULT));

  if (!automationEnabled) {
    const disabledKinds: readonly VerificationKind[] = ['build', 'test', 'lint'];
    return {
      capturedAt,
      records: disabledKinds.map((kind) => buildSkippedVerificationRecord(
        kind,
        'Verification automation is disabled by workspace settings.',
      )),
    };
  }

  const commandPlans = buildVerificationCommandPlans(session.workspaceRoot);
  const commandByKind = new Map<VerificationKind, VerificationCommandPlan>(commandPlans.map((plan) => [plan.kind, plan]));
  const kinds: readonly VerificationKind[] = ['build', 'test', 'lint'];
  const records: VerificationTraceRecord[] = [];

  const runRecords = async (progress?: vscode.Progress<{ message?: string }>): Promise<void> => {
    for (const kind of kinds) {
      const plan = commandByKind.get(kind);
      if (!plan) {
        records.push(buildSkippedVerificationRecord(
          kind,
          `No ${kind} command detected. Configure apexDelivery.verification.${kind}Command or expose a matching package.json script.`,
        ));
        continue;
      }

      output.appendLine(`[Verification] Running ${kind}: ${plan.command}`);
      progress?.report({ message: `${kind}: ${plan.command}` });
      records.push(await runVerificationCommand(plan, session.workspaceRoot, outputLimit));
    }
  };

  if (!nonInteractive && commandPlans.length > 0) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `APEX Delivery: verify ${session.epic.key} / ${session.phase.name}`,
        cancellable: false,
      },
      async (progress) => runRecords(progress),
    );
  } else {
    await runRecords();
  }

  const evidence: VerificationEvidence = { capturedAt, records };
  const currentArtifact = fs.existsSync(session.phase.artifactPath)
    ? fs.readFileSync(session.phase.artifactPath, 'utf8')
    : '';
  const nextArtifact = upsertVerificationSection(currentArtifact, buildVerificationSectionMarkdown(evidence));
  fs.writeFileSync(session.phase.artifactPath, nextArtifact, 'utf8');
  output.appendLine(`[Verification] Attached evidence to ${session.phase.artifactPath}.`);
  return evidence;
}

function buildVerificationCommandPlans(workspaceRoot: string): readonly VerificationCommandPlan[] {
  const configuration = vscode.workspace.getConfiguration('apexDelivery');
  const scripts = readPackageJsonScripts(workspaceRoot);

  return [
    buildVerificationCommandPlan('build', normalizeNonEmptyString(configuration.get<unknown>('verification.buildCommand')), scripts),
    buildVerificationCommandPlan('test', normalizeNonEmptyString(configuration.get<unknown>('verification.testCommand')), scripts),
    buildVerificationCommandPlan('lint', normalizeNonEmptyString(configuration.get<unknown>('verification.lintCommand')), scripts),
  ].filter((plan): plan is VerificationCommandPlan => plan !== undefined);
}

function buildVerificationCommandPlan(
  kind: VerificationKind,
  configuredCommand: string | undefined,
  packageScripts: Record<string, string>,
): VerificationCommandPlan | undefined {
  if (configuredCommand) {
    return {
      kind,
      command: configuredCommand,
      source: 'configuration',
    };
  }

  const scriptName = detectVerificationScriptName(kind, packageScripts);
  if (!scriptName) {
    return undefined;
  }

  return {
    kind,
    command: `npm run ${scriptName}`,
    source: 'package.json',
  };
}

function detectVerificationScriptName(kind: VerificationKind, packageScripts: Record<string, string>): string | undefined {
  const candidates: Record<VerificationKind, readonly string[]> = {
    build: ['compile', 'build'],
    test: ['test:smoke', 'test'],
    lint: ['lint'],
  };

  return candidates[kind].find((candidate) => typeof packageScripts[candidate] === 'string');
}

function readPackageJsonScripts(workspaceRoot: string): Record<string, string> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { scripts?: unknown };
    if (typeof parsed.scripts !== 'object' || parsed.scripts === null) {
      return {};
    }

    return Object.entries(parsed.scripts as Record<string, unknown>).reduce<Record<string, string>>((accumulator, [key, value]) => {
      if (typeof value === 'string') {
        accumulator[key] = value;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function buildSkippedVerificationRecord(kind: VerificationKind, reason: string): VerificationTraceRecord {
  return {
    kind,
    outcome: 'skipped',
    output: reason,
    durationMs: 0,
    source: 'none',
  };
}

async function runVerificationCommand(
  plan: VerificationCommandPlan,
  workspaceRoot: string,
  outputLimit: number,
): Promise<VerificationTraceRecord> {
  const startedAt = Date.now();
  const commandResult = await runShellCommand(plan.command, workspaceRoot);
  const durationMs = Date.now() - startedAt;
  const combinedOutput = [commandResult.stdout.trim(), commandResult.stderr.trim(), commandResult.errorMessage?.trim() ?? '']
    .filter((segment) => segment.length > 0)
    .join('\n\n');

  return {
    kind: plan.kind,
    outcome: commandResult.exitCode === 0 ? 'passed' : 'failed',
    command: plan.command,
    output: truncateVerificationOutput(
      combinedOutput.length > 0 ? combinedOutput : 'Command completed without stdout or stderr output.',
      outputLimit,
    ),
    durationMs,
    source: plan.source,
  };
}

interface ShellCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

function runShellCommand(command: string, cwd: string): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    execCallback(
      command,
      {
        cwd,
        timeout: VERIFICATION_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
          resolve({
            exitCode: typeof rawCode === 'number' ? rawCode : 1,
            stdout,
            stderr,
            errorMessage: error.message,
          });
          return;
        }

        resolve({
          exitCode: 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function truncateVerificationOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) {
    return output;
  }
  return `${output.slice(0, maxChars)}\n\n[truncated]`;
}

function buildVerificationSectionMarkdown(evidence: VerificationEvidence): string {
  const lines = [
    VERIFICATION_SECTION_START,
    '## Verification Evidence',
    '',
    `- Captured: ${evidence.capturedAt}`,
  ];

  for (const record of evidence.records) {
    lines.push(`- ${capitalizeWord(record.kind)}: ${record.outcome} (${record.command ?? 'no command'})`);
  }

  for (const record of evidence.records) {
    lines.push(
      '',
      `### ${capitalizeWord(record.kind)}`,
      `- Outcome: ${record.outcome}`,
      `- Source: ${record.source}`,
      `- Command: ${record.command ?? 'Not configured'}`,
      `- Duration: ${formatDuration(record.durationMs)}`,
      '',
      '```text',
      record.output,
      '```',
    );
  }

  lines.push(VERIFICATION_SECTION_END);
  return lines.join('\n');
}

function upsertVerificationSection(content: string, verificationSection: string): string {
  const normalizedContent = content.trimEnd();
  const sectionPattern = new RegExp(`${escapeRegExp(VERIFICATION_SECTION_START)}[\\s\\S]*?${escapeRegExp(VERIFICATION_SECTION_END)}`, 'm');
  if (sectionPattern.test(normalizedContent)) {
    return `${normalizedContent.replace(sectionPattern, verificationSection)}\n`;
  }

  if (normalizedContent.length === 0) {
    return `${verificationSection}\n`;
  }

  return `${normalizedContent}\n\n${verificationSection}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

async function runPhaseWithCopilotModel(
  context: vscode.ExtensionContext,
  session: PhaseSessionContext,
  output: vscode.OutputChannel,
  options: PhaseCommandOptions,
  runPreferences: PhaseRunPreferences,
  preferredModelFamily?: string,
): Promise<DirectPhaseRunResult> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    return {
      kind: 'fallback',
      reason: 'No Copilot language model is available to the extension host.',
    };
  }

  const model = pickPreferredModel(models, preferredModelFamily);
  if (context.languageModelAccessInformation.canSendRequest(model) === false) {
    return {
      kind: 'fallback',
      reason: 'Direct language-model access is currently not permitted for this extension.',
    };
  }

  output.show(true);
  if (preferredModelFamily) {
    output.appendLine(`[Copilot] Preferred direct model family for ${session.phase.id}: ${preferredModelFamily}.`);
  }
  output.appendLine(`[Copilot] Direct run starting for ${session.epic.key} / ${session.phase.id} with ${formatModelLabel(model)}.`);
  output.appendLine('[Copilot] Streaming response:');

  let responseText = '';
  try {
    const runRequest = async (token: vscode.CancellationToken): Promise<void> => {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(buildDirectModelPrompt(session, runPreferences))],
        {},
        token,
      );

      for await (const fragment of response.text) {
        responseText += fragment;
        output.append(fragment);
      }
    };

    if (options.nonInteractive) {
      const cancellationSource = new vscode.CancellationTokenSource();
      try {
        await runRequest(cancellationSource.token);
      } finally {
        cancellationSource.dispose();
      }
    } else {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `APEX Delivery: ${session.epic.key} / ${session.phase.name}`,
          cancellable: true,
        },
        async (progress, token) => {
          progress.report({ message: `Calling ${formatModelLabel(model)}` });
          await runRequest(token);
        },
      );
    }
  } catch (error: unknown) {
    output.appendLine('');
    output.appendLine(`[Copilot] Direct run failed: ${formatErrorMessage(error)}`);
    return {
      kind: 'fallback',
      reason: formatErrorMessage(error),
    };
  }

  output.appendLine('');

  if (options.nonInteractive) {
    return {
      kind: 'completed',
      model,
      responseText,
    };
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildDirectModelResultDocument(session, model, responseText),
  });

  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
  });

  return {
    kind: 'completed',
    model,
    responseText,
  };
}

async function proposeArtifactUpdateWithCopilot(
  context: vscode.ExtensionContext,
  session: PhaseSessionContext,
  output: vscode.OutputChannel,
  preferredModelFamily?: string,
): Promise<ArtifactProposalResult> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    return {
      outcome: 'unavailable',
      artifactPath: session.phase.artifactPath,
      reason: 'No Copilot language model is available to the extension host.',
    };
  }

  const model = pickPreferredModel(models, preferredModelFamily);
  if (context.languageModelAccessInformation.canSendRequest(model) === false) {
    return {
      outcome: 'unavailable',
      artifactPath: session.phase.artifactPath,
      reason: 'Direct language-model access is currently not permitted for this extension.',
    };
  }

  output.show(true);
  output.appendLine(`[Copilot] Artifact proposal starting for ${session.epic.key} / ${session.phase.id} with ${formatModelLabel(model)}.`);

  let responseText = '';
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `APEX Delivery: propose ${session.phase.name} artifact update`,
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: `Calling ${formatModelLabel(model)}` });
        const response = await model.sendRequest(
          [vscode.LanguageModelChatMessage.User(buildArtifactProposalPrompt(session))],
          {},
          token,
        );

        for await (const fragment of response.text) {
          responseText += fragment;
          output.append(fragment);
        }
      },
    );
  } catch (error: unknown) {
    output.appendLine('');
    output.appendLine(`[Copilot] Artifact proposal failed: ${formatErrorMessage(error)}`);
    return {
      outcome: 'unavailable',
      artifactPath: session.phase.artifactPath,
      reason: formatErrorMessage(error),
    };
  }

  output.appendLine('');
  const currentArtifact = fs.existsSync(session.phase.artifactPath)
    ? fs.readFileSync(session.phase.artifactPath, 'utf8')
    : '';
  const proposedArtifact = normalizeArtifactProposal(responseText);
  if (normalizeComparableText(currentArtifact) === normalizeComparableText(proposedArtifact)) {
    void vscode.window.showInformationMessage(`Copilot did not propose any changes for ${session.epic.key} / ${session.phase.name}.`);
    return {
      outcome: 'unchanged',
      artifactPath: session.phase.artifactPath,
      modelLabel: formatModelLabel(model),
      reason: 'The proposed artifact matched the current artifact contents.',
    };
  }

  const proposalPath = writeArtifactProposalFile(context, session, proposedArtifact);
  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(session.phase.artifactPath),
    vscode.Uri.file(proposalPath),
    `${session.epic.key} ${session.phase.name}: current ↔ Copilot proposal`,
  );

  const choice = await vscode.window.showInformationMessage(
    `Copilot prepared a proposed update for ${session.epic.key} / ${session.phase.name}. Review the diff, then choose what to do.`,
    'Apply Proposal',
    'Reject',
  );

  if (choice !== 'Apply Proposal') {
    return {
      outcome: 'rejected',
      artifactPath: session.phase.artifactPath,
      proposalPath,
      modelLabel: formatModelLabel(model),
      reason: choice === 'Reject' ? 'User rejected the proposed artifact update.' : 'User dismissed the proposal confirmation.',
    };
  }

  fs.writeFileSync(session.phase.artifactPath, proposedArtifact, 'utf8');
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(session.phase.artifactPath));
  void vscode.window.showInformationMessage(`Applied Copilot proposal to ${path.basename(session.phase.artifactPath)}.`);
  return {
    outcome: 'applied',
    artifactPath: session.phase.artifactPath,
    proposalPath,
    modelLabel: formatModelLabel(model),
  };
}

function pickPreferredModel(
  models: readonly vscode.LanguageModelChat[],
  preferredFamily?: string,
): vscode.LanguageModelChat {
  const normalizedPreferredFamily = preferredFamily?.toLowerCase();
  if (normalizedPreferredFamily) {
    const configuredCandidate = models.find((model) => {
      const haystacks = [model.family, model.name, model.id].map((value) => value.toLowerCase());
      return haystacks.some((value) => value.includes(normalizedPreferredFamily));
    });
    if (configuredCandidate) {
      return configuredCandidate;
    }
  }

  const preferredFamilies = ['gpt-4.1', 'gpt-4o', 'gpt-4', 'o1'];
  for (const family of preferredFamilies) {
    const candidate = models.find((model) => model.family.toLowerCase().includes(family));
    if (candidate) {
      return candidate;
    }
  }

  const [firstModel] = models;
  if (!firstModel) {
    throw new Error('No Copilot language model is available.');
  }

  return firstModel;
}

function buildDraftPhaseRunPreferences(runPreferences: PhaseRunPreferences): PhaseRunPreferences {
  return {
    ...runPreferences,
    autoSubmit: false,
  };
}

async function handoffPhaseToCopilotChat(
  session: PhaseSessionContext,
  output: vscode.OutputChannel,
  chatTransport: ApexChatSessionTransport,
  options: PhaseCommandOptions,
  runPreferences?: PhaseRunPreferences,
): Promise<PhaseCommandResult> {
  const chatStarter = buildScopedChatStarter(session, runPreferences);
  const chatLaunchResult = await chatTransport.openAsk(sessionToSessionRecord(session), {
    prompt: chatStarter,
    autoSubmit: runPreferences?.autoSubmit ?? false,
    attachFiles: buildPhaseChatAttachments(session),
  });
  if (chatLaunchResult !== 'prefilled' && chatLaunchResult !== 'submitted') {
    await vscode.env.clipboard.writeText(chatStarter);
  }

  if (options.nonInteractive) {
    return {
      mode: 'chat-fallback',
      artifactPath: session.phase.artifactPath,
      ...buildPhaseSessionResultMetadata(session),
      fallbackReason: chatLaunchResult === 'prefilled'
        ? 'Direct model execution was unavailable; opened GitHub Copilot Chat with a scoped phase prompt prefilled via public command integration.'
        : chatLaunchResult === 'submitted'
          ? 'Direct model execution was unavailable; submitted a scoped phase prompt to GitHub Copilot Chat via public command integration.'
        : 'Direct model execution was unavailable; reopened the existing epic-scoped chat session and copied the scoped prompt for manual continuation.',
      chatStarter,
      chatLaunchResult,
        verification: [],
    };
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildPhaseSessionBrief(session.phase, session.epic, session.workspaceRoot, runPreferences),
  });

  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
  });

  output.appendLine(
    chatLaunchResult === 'submitted'
      ? `[Copilot] Submitted ${session.epic.key} / ${session.phase.id} to GitHub Copilot Chat using the scoped fallback prompt.`
      : chatLaunchResult === 'prefilled'
      ? `[Copilot] Opened GitHub Copilot Chat with ${session.epic.key} / ${session.phase.id} prefilled via public command integration.`
      : `[Copilot] Reopened the existing chat session for ${session.epic.key} / ${session.phase.id} and copied the scoped prompt for manual continuation.`,
  );

  const choice = await vscode.window.showInformationMessage(
    chatLaunchResult === 'submitted'
      ? `GitHub Copilot Chat submitted the scoped fallback prompt for ${session.epic.key} / ${session.phase.name}.`
      : chatLaunchResult === 'prefilled'
      ? `GitHub Copilot Chat is open with a scoped prompt prefilled for ${session.epic.key} / ${session.phase.name}. Review or adjust it before sending.`
      : chatLaunchResult === 'opened'
        ? `GitHub Copilot Chat is open for ${session.epic.key} / ${session.phase.name}. Paste the copied scoped prompt to continue.`
        : `Phase chat follow-up ready for ${session.epic.key} / ${session.phase.name}. Open GitHub Copilot Chat and paste the copied scoped prompt.`,
    'Open Artifact',
  );

  if (choice === 'Open Artifact') {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(session.phase.artifactPath));
  }

  return {
    mode: 'chat-fallback',
    artifactPath: session.phase.artifactPath,
    fallbackReason: chatLaunchResult === 'prefilled'
      ? 'Direct model execution was unavailable; opened GitHub Copilot Chat with a scoped phase prompt prefilled via public command integration.'
      : chatLaunchResult === 'submitted'
        ? 'Direct model execution was unavailable; submitted a scoped phase prompt to GitHub Copilot Chat via public command integration.'
      : 'Direct model execution was unavailable; reopened the existing epic-scoped chat session and copied the scoped prompt for manual continuation.',
    chatStarter,
    chatLaunchResult,
  };
}

function shouldReuseExistingFallbackChatSession(
  session: Pick<ApexSessionRecord, 'transportId' | 'transportResource' | 'lastLaunchMode' | 'status'>,
): boolean {
  return session.transportId === 'best-effort-native-chat'
    && typeof session.transportResource === 'string'
    && session.transportResource.length > 0
    && session.status !== 'prepared'
    && session.lastLaunchMode === 'ask';
}

async function launchPhaseInCopilotAgent(
  session: PhaseSessionContext,
  output: vscode.OutputChannel,
  chatTransport: ApexChatSessionTransport,
  runPreferences: PhaseRunPreferences,
  nonInteractive: boolean,
): Promise<CopilotChatLaunchResult> {
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(session.phase.artifactPath));

  const chatStarter = buildCopilotAgentStarter(session, runPreferences);
  const attachFiles = buildPhaseChatAttachments(session);
  const chatLaunchResult = await chatTransport.openAgent(sessionToSessionRecord(session), {
    prompt: chatStarter,
    attachFiles,
    autoSubmit: runPreferences.autoSubmit,
  });

  if (chatLaunchResult !== 'prefilled' && chatLaunchResult !== 'submitted') {
    await vscode.env.clipboard.writeText(chatStarter);
  }

  if (runPreferences.modelFamily) {
    output.appendLine(`[Copilot] Preferred direct model family for ${session.phase.id}: ${runPreferences.modelFamily}. GitHub Copilot Chat still uses the active chat UI selection because the public chat-open API does not expose model locking.`);
  }

  output.appendLine(
    chatLaunchResult === 'submitted'
      ? `[Copilot] Submitted ${session.epic.key} / ${session.phase.id} to GitHub Copilot Chat in agent mode with the phase files attached.`
      : chatLaunchResult === 'prefilled'
      ? `[Copilot] Opened GitHub Copilot Chat in agent mode for ${session.epic.key} / ${session.phase.id} with the phase files attached.`
      : chatLaunchResult === 'opened'
        ? `[Copilot] Opened GitHub Copilot Chat in agent mode for ${session.epic.key} / ${session.phase.id}; copied the phase prompt as a fallback.`
        : `[Copilot] Could not open GitHub Copilot Chat in agent mode for ${session.epic.key} / ${session.phase.id}.`,
  );

  if (!nonInteractive && chatLaunchResult !== 'unavailable') {
    void vscode.window.showInformationMessage(
      chatLaunchResult === 'submitted'
        ? `GitHub Copilot Chat submitted the ${session.phase.name} prompt immediately for ${session.epic.key}. The existing phase artifact is open and attached.`
        : chatLaunchResult === 'prefilled'
        ? `GitHub Copilot Chat opened in agent mode for ${session.epic.key} / ${session.phase.name}. The existing phase artifact is open and attached; review the prompt, then send it to update that file in place.`
        : `GitHub Copilot Chat opened for ${session.epic.key} / ${session.phase.name}. The phase prompt was copied to the clipboard in case you need to paste it manually.`,
    );
  }

  return chatLaunchResult;
}

async function continuePhaseInChat(
  session: PhaseSessionContext,
  chatTransport: ApexChatSessionTransport,
  runPreferences?: PhaseRunPreferences,
): Promise<void> {
  const chatStarter = buildScopedChatStarter(
    session,
    runPreferences ? buildDraftPhaseRunPreferences(runPreferences) : undefined,
  );
  const chatLaunchResult = await chatTransport.openAsk(sessionToSessionRecord(session), {
    prompt: chatStarter,
    autoSubmit: false,
    attachFiles: buildPhaseChatAttachments(session),
  });
  if (chatLaunchResult !== 'prefilled' && chatLaunchResult !== 'submitted') {
    await vscode.env.clipboard.writeText(chatStarter);
  }

  void vscode.window.showInformationMessage(
    chatLaunchResult === 'prefilled'
      ? `GitHub Copilot Chat is open with a scoped prompt prefilled for ${session.epic.key} / ${session.phase.name}. Review or adjust it before sending.`
      : chatLaunchResult === 'opened'
        ? `GitHub Copilot Chat is ready. Paste the copied scoped prompt to continue ${session.epic.key} / ${session.phase.name}.`
        : `Open GitHub Copilot Chat and paste the copied scoped prompt to continue ${session.epic.key} / ${session.phase.name}.`,
  );
}

  async function tryOpenPhaseChatSession(session: Pick<PhaseSessionContext, 'sessionId'>): Promise<boolean> {
    const sessionUri = buildPhaseChatSessionUri(session);
    const commands = [
      'workbench.action.chat.openSessionInNewEditorGroup',
      'workbench.action.chat.openSessionInEditorGroup',
    ];

    for (const command of commands) {
      try {
        await vscode.commands.executeCommand(command, { resource: sessionUri });
        return true;
      } catch {
        // Try the next session-open entrypoint.
      }
    }

    try {
      await vscode.commands.executeCommand('vscode.open', sessionUri);
      return true;
    } catch {
      return false;
    }
  }

async function tryStartCopilotAgentChat(
  session: Pick<PhaseSessionContext, 'sessionId'>,
  query: string,
  attachFiles: readonly vscode.Uri[],
  autoSubmit: boolean,
): Promise<CopilotChatLaunchResult> {
    const openedScopedSession = await tryOpenPhaseChatSession(session);

  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      mode: 'agent',
      query,
      ...(autoSubmit ? {} : { isPartialQuery: true }),
      ...(attachFiles.length > 0 ? { attachFiles } : {}),
    });
    return autoSubmit ? 'submitted' : 'prefilled';
  } catch {
    if (openedScopedSession) {
      return 'opened';
    }

    // Fall through to opening the agent UI without prefilling.
  }

  const openAgentCommands = ['workbench.action.chat.openAgent', 'workbench.action.chat.open'];
  for (const command of openAgentCommands) {
    try {
      if (command === 'workbench.action.chat.open') {
        await vscode.commands.executeCommand(command, {
          mode: 'agent',
          attachFiles,
        });
      } else {
        await vscode.commands.executeCommand(command);
      }
      return 'opened';
    } catch {
      // Try the next agent entrypoint.
    }
  }

  return 'unavailable';
}

async function tryStartCopilotChat(
  session: Pick<ApexSessionRecord, 'sessionId' | 'transportId' | 'transportResource' | 'lastLaunchMode' | 'status'>,
  query?: string,
  autoSubmit = false,
  attachFiles: readonly vscode.Uri[] = [],
): Promise<CopilotChatLaunchResult> {
  const openedScopedSession = await tryOpenPhaseChatSession(session);

  if (openedScopedSession && shouldReuseExistingFallbackChatSession(session)) {
    return 'opened';
  }

  if (query) {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: 'ask',
        query,
        ...(autoSubmit ? {} : { isPartialQuery: true }),
        ...(attachFiles.length > 0 ? { attachFiles } : {}),
      });
      return autoSubmit ? 'submitted' : 'prefilled';
    } catch {
      if (openedScopedSession) {
        return 'opened';
      }

      // Fall through to opening chat without prefilling.
    }
  } else if (openedScopedSession) {
    return 'opened';
  }

  const commands = [
    'workbench.action.chat.open',
    'workbench.action.chat.openAsk',
    'workbench.action.quickchat.toggle',
  ];

  for (const command of commands) {
    try {
      await vscode.commands.executeCommand(command);
      return 'opened';
    } catch {
      // Try the next Copilot entrypoint.
    }
  }

  return 'unavailable';
}

function buildPhaseSessionBrief(
  phase: PhaseStatus,
  epic: EpicStatus,
  workspaceRoot: string,
  runPreferences?: PhaseRunPreferences,
): string {
  const epicPath = displayPath(workspaceRoot, path.join(epic.folderPath, 'EPIC.md'));
  const artifactPath = displayPath(workspaceRoot, phase.artifactPath);
  const statusPath = displayPath(workspaceRoot, phase.statusPath);
  const lines = [
    `# ${epic.key} - ${phase.name} Copilot Session`,
    '',
    '> Use this editor as a scoped GitHub Copilot Chat context for one delivery phase only.',
    '',
    '## Objective',
    `Advance the ${phase.name} phase for ${epic.key} without changing unrelated phases.`,
    '',
    '## Phase Metadata',
    `- Epic: ${epic.key} - ${epic.title}`,
    `- Status: ${phase.status}`,
    `- Owner: ${phase.owner}`,
    `- Expected output: ${phase.output}`,
    '',
    '## Relevant Files',
    `- Epic brief: ${epicPath}`,
    `- Phase artifact: ${artifactPath}`,
    `- Phase status: ${statusPath}`,
  ];

  if (phase.notes) {
    lines.push('', '## Existing Notes', phase.notes);
  }

  lines.push('', '## Prompt To Paste Into Copilot Chat', buildScopedChatStarter(buildPhaseSessionContext(phase, epic, workspaceRoot), runPreferences));
  return lines.join('\n');
}

function buildScopedChatStarter(session: PhaseSessionContext, runPreferences?: PhaseRunPreferences): string {
  return renderScopedChatStarter(buildPhasePromptRenderContextFromSession(session), runPreferences);
}

function buildCopilotAgentStarter(session: PhaseSessionContext, runPreferences: PhaseRunPreferences): string {
  return renderCopilotAgentStarter(buildPhasePromptRenderContextFromSession(session), runPreferences);
}

function buildPhaseChatAttachments(session: PhaseSessionContext): readonly vscode.Uri[] {
  const candidatePaths = isPbiDeliveryWorkflow(session.epic.workflowId)
    ? listPbiReferencePaths(session.epic, session.phase)
    : [
      path.join(session.epic.folderPath, 'EPIC.md'),
      session.phase.artifactPath,
      session.phase.statusPath,
    ];

  return candidatePaths
    .filter((candidatePath, index, allPaths) => fs.existsSync(candidatePath) && allPaths.indexOf(candidatePath) === index)
    .map((candidatePath) => vscode.Uri.file(candidatePath));
}

function buildDirectModelPrompt(session: PhaseSessionContext, runPreferences?: PhaseRunPreferences): string {
  return renderDirectModelPrompt({
    ...buildPhasePromptRenderContextFromSession(session),
    referenceText: formatSessionReferences(session),
  }, runPreferences);
}

async function createCopilotCliPhaseHandoff(
  session: PhaseSessionContext,
  runPreferences: PhaseRunPreferences,
  output: vscode.OutputChannel,
): Promise<ReturnType<typeof buildCopilotCliHandoff>> {
  const prompt = buildCopilotCliPrompt(session, runPreferences);
  const handoff = buildCopilotCliHandoff(session.workspaceRoot, session.epic, session.phase, prompt);
  await vscode.env.clipboard.writeText(handoff.command);
  output.appendLine(`[Copilot] Copilot CLI handoff ready for ${session.epic.key} / ${session.phase.id}.`);
  output.appendLine(`[Copilot] Prompt file: ${handoff.promptPath}`);
  output.appendLine(`[Copilot] Command: ${handoff.command}`);
  return handoff;
}

function buildCopilotCliPrompt(session: PhaseSessionContext, runPreferences: PhaseRunPreferences): string {
  return renderCopilotCliPrompt({
    ...buildPhasePromptRenderContextFromSession(session),
    workspaceRootDisplayPath: session.workspaceRoot,
    referenceText: formatSessionReferences(session),
  }, buildDraftPhaseRunPreferences(runPreferences));
}

function buildPhasePromptRenderContextFromSession(session: PhaseSessionContext): PhasePromptRenderContext {
  return {
    sessionMarker: buildPhaseChatSessionMarker(session),
    workspaceRootDisplayPath: session.workspaceRoot,
    epicDisplayPath: displayPath(session.workspaceRoot, path.join(session.epic.folderPath, 'EPIC.md')),
    artifactDisplayPath: displayPath(session.workspaceRoot, session.phase.artifactPath),
    artifactBasename: path.basename(session.phase.artifactPath),
    statusDisplayPath: displayPath(session.workspaceRoot, session.phase.statusPath),
    epicKey: session.epic.key,
    epicTitle: session.epic.title,
    workflowId: session.epic.workflowId,
    phaseId: session.phase.id,
    phaseName: session.phase.name,
    phaseStatus: session.phase.status,
    phaseOutput: session.phase.output,
    branchNames: session.epic.coordination?.branches.map((branch) => branch.name) ?? [],
    pullRequestCount: session.epic.coordination?.pullRequests.length ?? 0,
  };
}

function buildArtifactProposalPrompt(session: PhaseSessionContext): string {
  const artifactPath = displayPath(session.workspaceRoot, session.phase.artifactPath);
  const lines = [
    'You are updating one existing APEX delivery artifact inside VS Code.',
    'Return ONLY the complete revised markdown for the artifact.',
    'Do not add explanation before or after the document.',
    'Do not wrap the document in code fences.',
    'Preserve valid material from the current artifact and improve it using the source text below.',
    'If a fact is missing, keep an explicit open question instead of inventing details.',
    '',
    `Epic: ${session.epic.key} - ${session.epic.title}`,
    `Phase: ${session.phase.name} (${session.phase.id})`,
    `Artifact path: ${artifactPath}`,
    '',
    'Source text:',
    formatSessionReferences(session),
  ];

  return lines.join('\n');
}

function buildParticipantPrompt(session: PhaseSessionContext, followUpPrompt: string): string {
  return [
    'Continue an existing APEX delivery phase conversation.',
    buildPhaseChatSessionMarker(session),
    `User follow-up: ${followUpPrompt}`,
    'Keep the response scoped to the current phase and use the stored context below as the source of truth.',
    '',
    `Epic: ${session.epic.key} - ${session.epic.title}`,
    `Phase: ${session.phase.name} (${session.phase.id})`,
    '',
    'Stored source text:',
    formatSessionReferences(session),
  ].join('\n');
}

function formatSessionReferences(session: PhaseSessionContext): string {
  return session.references.map((reference) => {
    const filePath = displayPath(session.workspaceRoot, reference.filePath);
    const truncatedLabel = reference.truncated ? ' (truncated)' : '';
    return [
      `### ${reference.label}${truncatedLabel}`,
      `Path: ${filePath}`,
      reference.content,
    ].join('\n');
  }).join('\n\n');
}

function buildDirectModelResultDocument(
  session: PhaseSessionContext,
  model: vscode.LanguageModelChat,
  responseText: string,
): string {
  return [
    `# ${session.epic.key} - ${session.phase.name} Copilot Response`,
    '',
    `- Model: ${formatModelLabel(model)}`,
    `- Artifact: ${displayPath(session.workspaceRoot, session.phase.artifactPath)}`,
    `- Session Id: ${session.sessionId}`,
    `- Session: ${session.sessionKey}`,
    '',
    '## Follow-up',
    'Use Continue in Chat or rerun Run Phase with Copilot if you want a refreshed scoped prompt for this exact phase context.',
    '',
    '## Response',
    responseText.trim().length > 0 ? responseText.trim() : '_No response text returned._',
  ].join('\n');
}

function formatModelLabel(model: vscode.LanguageModelChat): string {
  return `${model.name} (${model.vendor}/${model.family})`;
}

function normalizeArtifactProposal(responseText: string): string {
  const trimmed = responseText.trim();
  const fencedMatch = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  const unwrapped = fencedMatch?.[1] ?? trimmed;
  return `${unwrapped.trimEnd()}\n`;
}

function normalizeComparableText(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

function writeArtifactProposalFile(
  context: vscode.ExtensionContext,
  session: PhaseSessionContext,
  content: string,
): string {
  const proposalRoot = context.globalStorageUri.fsPath;
  fs.mkdirSync(proposalRoot, { recursive: true });
  const proposalPath = path.join(proposalRoot, `${session.epic.key}-${session.phase.id}-proposal.md`);
  fs.writeFileSync(proposalPath, content, 'utf8');
  return proposalPath;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof vscode.LanguageModelError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function displayPath(workspaceRoot: string, filePath: string): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  return relativePath.length > 0 && !relativePath.startsWith('..') ? relativePath : filePath;
}

function updateStatusBar(
  statusBar: vscode.StatusBarItem,
  epics: readonly EpicStatus[],
  currentBranchContext: CurrentBranchEpicContext,
): void {
  if (currentBranchContext.error) {
    statusBar.command = 'apexDelivery.manageCurrentBranchBinding';
    statusBar.text = '$(warning) APEX Branch Link';
    statusBar.tooltip = `${currentBranchContext.error} Click to manage the current branch binding.`;
    statusBar.show();
    return;
  }

  if (currentBranchContext.epic) {
    statusBar.command = 'apexDelivery.manageCurrentBranchBinding';
    const phaseLabel = currentBranchContext.phase?.name ?? 'Complete';
    const linkedBranchCount = currentBranchContext.epic.coordination?.branches.length ?? 0;
    statusBar.text = linkedBranchCount > 1
      ? `$(git-branch) ${currentBranchContext.epic.key} · ${phaseLabel} · ${linkedBranchCount} branches`
      : `$(git-branch) ${currentBranchContext.epic.key} · ${phaseLabel}`;
    statusBar.tooltip = currentBranchContext.branchName
      ? `Current branch "${currentBranchContext.branchName}" is bound to ${currentBranchContext.epic.key}. Linked branches: ${currentBranchContext.epic.coordination?.branches.map((branch) => branch.name).join(', ') || 'none'}. Click to manage this binding.`
      : `Current epic ${currentBranchContext.epic.key}. Click to manage the current branch binding.`;
    statusBar.show();
    return;
  }

  if (epics.length === 0) {
    statusBar.command = 'apexDelivery.openDashboard';
    statusBar.text = '$(rocket) APEX Delivery';
    statusBar.tooltip = 'No delivery epics found. Open the dashboard or create an epic.';
    statusBar.show();
    return;
  }

  const active = epics.filter((epic) => epic.progress > 0 && epic.progress < 100).length;
  const blocked = epics.filter((epic) => epic.hasBlocked).length;
  if (currentBranchContext.branchName) {
    statusBar.command = 'apexDelivery.manageCurrentBranchBinding';
    statusBar.text = blocked > 0
      ? `$(git-branch) Unlinked · ${active} active · ${blocked} blocked`
      : `$(git-branch) Unlinked · ${active} active`;
    statusBar.tooltip = `Current branch "${currentBranchContext.branchName}" is not bound to an epic. Click to bind or manage the current branch.`;
    statusBar.show();
    return;
  }

  statusBar.command = 'apexDelivery.openDashboard';
  statusBar.text = blocked > 0
    ? `$(warning) ${active} active · ${blocked} blocked`
    : `$(rocket) ${active} active epic${active === 1 ? '' : 's'}`;
  statusBar.tooltip = 'Open the APEX Delivery dashboard.';
  statusBar.show();
}

function resolveCurrentBranchEpicContext(
  epics: readonly EpicStatus[],
  branchResult: GitCurrentBranchResult,
): CurrentBranchEpicContext {
  if (branchResult.error) {
    return {
      error: `Current branch could not be resolved: ${branchResult.error}`,
    };
  }

  if (!branchResult.branchName) {
    return {};
  }

  const matches = epics.filter((epic) => epic.coordination?.branches.some((branch) => branch.name === branchResult.branchName));
  if (matches.length > 1) {
    return {
      branchName: branchResult.branchName,
      error: `Current branch "${branchResult.branchName}" is linked to multiple epics (${matches.map((epic) => epic.key).join(', ')}).`,
    };
  }

  const epic = matches[0];
  if (!epic) {
    return {
      branchName: branchResult.branchName,
    };
  }

  return {
    branchName: branchResult.branchName,
    epic,
    phase: epic.phases[epic.currentPhaseIndex],
  };
}

function buildMissingCommandTargetMessage(
  kind: 'phase' | 'phase-or-epic',
  currentBranchContext: CurrentBranchEpicContext,
): string {
  if (currentBranchContext.error) {
    return `${currentBranchContext.error} Fix the branch binding or select an epic explicitly.`;
  }

  if (currentBranchContext.branchName) {
    return kind === 'phase'
      ? `Current branch "${currentBranchContext.branchName}" is not bound to an epic. Select a delivery phase or run APEX: Bind Branch To Epic.`
      : `Current branch "${currentBranchContext.branchName}" is not bound to an epic. Select a delivery phase or epic, or run APEX: Bind Branch To Epic.`;
  }

  return kind === 'phase'
    ? 'Select a delivery phase first, or run APEX: Bind Branch To Epic.'
    : 'Select a delivery phase or epic first, or run APEX: Bind Branch To Epic.';
}

function resolveEpicCommandTarget(first: unknown, second?: EpicStatus): EpicStatus | undefined {
  if (isEpicItemLike(first)) {
    return first.epic;
  }
  if (isPhaseItemLike(first)) {
    return first.epic;
  }
  return isEpicStatusLike(first) ? first : second;
}

function isEpicItemLike(value: unknown): value is { epic: EpicStatus } {
  return typeof value === 'object'
    && value !== null
    && 'epic' in value
    && isEpicStatusLike((value as { epic?: unknown }).epic);
}

async function pickEpicForBranchLink(
  epics: readonly EpicStatus[],
  branchName: string,
  options?: {
    title?: string;
    placeHolder?: string;
  },
): Promise<EpicStatus | undefined> {
  const selection = await vscode.window.showQuickPick(
    [...epics]
      .sort((left, right) => scoreEpicBranchLinkFit(right, branchName) - scoreEpicBranchLinkFit(left, branchName))
      .map((epic) => ({
      label: epic.key,
      description: epic.title,
      detail: buildEpicBranchLinkDetail(epic, branchName),
      epic,
    })),
    {
      title: options?.title ?? 'Bind Branch To Epic',
      placeHolder: options?.placeHolder ?? `Choose an epic for branch "${branchName}".`,
    },
  );

  return selection?.epic;
}

async function pickEpicForCommand(
  epics: readonly EpicStatus[],
  title: string,
  placeHolder: string,
): Promise<EpicStatus | undefined> {
  const selection = await vscode.window.showQuickPick(
    epics.map((epic) => ({
      label: epic.key,
      description: epic.title,
      detail: `Current phase: ${epic.phases[epic.currentPhaseIndex]?.name ?? 'Complete'}`,
      epic,
    })),
    {
      title,
      placeHolder,
    },
  );

  return selection?.epic;
}

interface EpicExecutionBranchResolution {
  status: 'resolved' | 'unlinked' | 'ambiguous' | 'invalid-explicit' | 'cancelled';
  linkedBranches: string[];
  branchName?: string;
  explicitBranchName?: string;
}

interface EpicExecutionBranchOptions {
  explicitBranchName?: string;
  allowPrompt: boolean;
  preferCurrentBranch: boolean;
  promptTitle: string;
  promptPlaceHolder: string;
}

interface EpicCommandGuardResult {
  allowed: boolean;
  blockedReason?: string;
  expectedBranch?: string;
  currentBranchName?: string;
}

function getLinkedBranchNames(epic: EpicStatus): string[] {
  return [...new Set((epic.coordination?.branches ?? []).map((branch) => branch.name.trim()).filter((branchName) => branchName.length > 0))];
}

async function pickLinkedBranchForEpic(
  epic: EpicStatus,
  linkedBranches: readonly string[],
  title: string,
  placeHolder: string,
  currentBranchName: string | undefined,
): Promise<string | undefined> {
  const selection = await vscode.window.showQuickPick(
    [...linkedBranches].sort((left, right) => left.localeCompare(right)).map((branchName) => ({
      label: branchName,
      detail: currentBranchName === branchName ? 'Currently checked out in this workspace.' : `Linked branch for ${epic.key}`,
    })),
    {
      title,
      placeHolder,
    },
  );

  return selection?.label;
}

async function resolveEpicExecutionBranch(
  epic: EpicStatus,
  currentBranchName: string | undefined,
  options: EpicExecutionBranchOptions,
): Promise<EpicExecutionBranchResolution> {
  const linkedBranches = getLinkedBranchNames(epic);
  if (linkedBranches.length === 0) {
    return { status: 'unlinked', linkedBranches };
  }

  const explicitBranchName = options.explicitBranchName?.trim();
  if (explicitBranchName) {
    return linkedBranches.includes(explicitBranchName)
      ? { status: 'resolved', linkedBranches, branchName: explicitBranchName }
      : { status: 'invalid-explicit', linkedBranches, explicitBranchName };
  }

  if (linkedBranches.length === 1) {
    return {
      status: 'resolved',
      linkedBranches,
      branchName: linkedBranches[0],
    };
  }

  if (options.preferCurrentBranch && currentBranchName && linkedBranches.includes(currentBranchName)) {
    return {
      status: 'resolved',
      linkedBranches,
      branchName: currentBranchName,
    };
  }

  if (options.allowPrompt) {
    const pickedBranch = await pickLinkedBranchForEpic(epic, linkedBranches, options.promptTitle, options.promptPlaceHolder, currentBranchName);
    return pickedBranch
      ? { status: 'resolved', linkedBranches, branchName: pickedBranch }
      : { status: 'cancelled', linkedBranches };
  }

  return { status: 'ambiguous', linkedBranches };
}

function reportEpicExecutionIssue(
  output: vscode.OutputChannel,
  epic: EpicStatus,
  resolution: Exclude<EpicExecutionBranchResolution, { status: 'resolved' | 'cancelled' }>,
  currentBranchResult: GitCurrentBranchResult,
  commandLabel: string,
): string {
  const currentBranchLabel = currentBranchResult.branchName
    ? `Current branch "${currentBranchResult.branchName}".`
    : currentBranchResult.error
      ? `Current branch could not be resolved: ${currentBranchResult.error}.`
      : 'Current branch is unavailable in this workspace.';

  let message = '';
  if (resolution.status === 'unlinked') {
    message = `APEX blocked ${commandLabel} for ${epic.key}. No bound branch is configured. Next action: bind a branch to ${epic.key} first.`;
  } else if (resolution.status === 'invalid-explicit') {
    message = `APEX blocked ${commandLabel} for ${epic.key}. Branch "${resolution.explicitBranchName}" is not linked to this epic. Linked branches: ${resolution.linkedBranches.join(', ')}. Next action: choose one of the linked branches.`;
  } else {
    message = `APEX blocked ${commandLabel} for ${epic.key}. Linked branches: ${resolution.linkedBranches.join(', ')}. ${currentBranchLabel} Next action: choose a linked branch or run APEX: Open Pinned Branch Workspace.`;
  }

  output.appendLine(`[Execution] ${message}`);
  void vscode.window.showWarningMessage(message);
  return message;
}

function reportEpicExecutionMismatch(
  output: vscode.OutputChannel,
  epic: EpicStatus,
  expectedBranch: string,
  currentBranchResult: GitCurrentBranchResult,
  commandLabel: string,
): string {
  const currentBranchLabel = currentBranchResult.branchName
    ? `Current branch "${currentBranchResult.branchName}".`
    : currentBranchResult.error
      ? `Current branch could not be resolved: ${currentBranchResult.error}.`
      : 'Current branch is unavailable in this workspace.';
  const message = `APEX blocked ${commandLabel} for ${epic.key}. Expected linked branch "${expectedBranch}". ${currentBranchLabel} Next action: check out "${expectedBranch}" in this workspace or run APEX: Open Pinned Branch Workspace first.`;
  output.appendLine(`[Execution] ${message}`);
  void vscode.window.showWarningMessage(message);
  return message;
}

async function ensureEpicExecutionBranchMatch(
  epic: EpicStatus,
  workspaceRoot: string,
  gitService: GitService,
  output: vscode.OutputChannel,
  commandLabel: string,
): Promise<EpicCommandGuardResult> {
  const currentBranchResult = gitService.getCurrentBranch(workspaceRoot);
  const resolution = await resolveEpicExecutionBranch(epic, currentBranchResult.branchName, {
    allowPrompt: false,
    preferCurrentBranch: true,
    promptTitle: commandLabel,
    promptPlaceHolder: '',
  });

  if (resolution.status === 'unlinked') {
    return {
      allowed: true,
      currentBranchName: currentBranchResult.branchName,
    };
  }

  if (resolution.status === 'resolved') {
    const resolvedBranchName = resolution.branchName;
    if (!resolvedBranchName) {
      return {
        allowed: false,
        currentBranchName: currentBranchResult.branchName,
      };
    }

    if (currentBranchResult.branchName === resolvedBranchName) {
      output.appendLine(`[Execution] Allowed ${commandLabel} for ${epic.key} on linked branch ${resolvedBranchName}.`);
      return {
        allowed: true,
        expectedBranch: resolvedBranchName,
        currentBranchName: currentBranchResult.branchName,
      };
    }

    return {
      allowed: false,
      expectedBranch: resolvedBranchName,
      currentBranchName: currentBranchResult.branchName,
      blockedReason: reportEpicExecutionMismatch(output, epic, resolvedBranchName, currentBranchResult, commandLabel),
    };
  }

  return {
    allowed: false,
    currentBranchName: currentBranchResult.branchName,
    blockedReason: reportEpicExecutionIssue(output, epic, resolution, currentBranchResult, commandLabel),
  };
}

function buildSuggestedWorktreePath(workspaceRoot: string, branchName: string): string {
  const repoFolderName = path.basename(workspaceRoot);
  return path.join(path.dirname(workspaceRoot), `${repoFolderName}-${sanitizePathSegment(branchName)}`);
}

function remapWorkspacePath(sourceRoot: string, targetRoot: string, filePath: string): string {
  return path.join(targetRoot, path.relative(sourceRoot, filePath));
}

async function pickBranchForLink(
  branches: readonly string[],
  title = 'Bind Branch To Epic',
  placeHolder = 'Choose a local branch to bind to an epic.',
): Promise<string | undefined> {
  const selection = await vscode.window.showQuickPick(
    [...branches].sort((left, right) => left.localeCompare(right)).map((branchName) => ({
      label: branchName,
    })),
    {
      title,
      placeHolder,
    },
  );

  return selection?.label;
}

async function resolveBranchForBinding(
  workspaceRoot: string,
  gitService: GitService,
  options: ReturnType<typeof getBindBranchToEpicCommandOptions>,
): Promise<string | undefined> {
  const explicitBranchName = options.branchName?.trim();
  if (explicitBranchName) {
    return explicitBranchName;
  }

  const currentBranchResult = gitService.getCurrentBranch(workspaceRoot);
  if (options.useCurrentBranch) {
    if (currentBranchResult.branchName) {
      return currentBranchResult.branchName;
    }
    void vscode.window.showWarningMessage(currentBranchResult.error ?? 'Current Git branch could not be resolved.');
    return undefined;
  }

  if (options.nonInteractive) {
    if (currentBranchResult.branchName) {
      return currentBranchResult.branchName;
    }
    void vscode.window.showWarningMessage('Provide a branch name when running Bind Branch To Epic non-interactively.');
    return undefined;
  }

  const branches = gitService.listLocalBranches(workspaceRoot);
  if (branches.length === 0) {
    void vscode.window.showWarningMessage('No local Git branches were found to bind.');
    return undefined;
  }

  const currentBranchName = currentBranchResult.branchName;
  if (currentBranchName) {
    const currentBranchChoice = await vscode.window.showQuickPick(
      [
        {
          label: `Use Current Branch`,
          description: currentBranchName,
          value: 'current',
        },
        {
          label: 'Choose Another Local Branch',
          description: `${Math.max(branches.length - 1, 0)} other branch${branches.length === 2 ? '' : 'es'}`,
          value: 'other',
        },
      ],
      {
        title: 'Bind Branch To Epic',
        placeHolder: 'Choose which branch should be bound.',
      },
    );
    if (!currentBranchChoice) {
      return undefined;
    }
    if (currentBranchChoice.value === 'current') {
      return currentBranchName;
    }
  }

  return pickBranchForLink(branches);
}

async function bindBranchToEpicCommand(
  epics: readonly EpicStatus[],
  workspaceRoot: string,
  gitService: GitService,
  first: unknown,
  second: EpicStatus | undefined,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const options = getBindBranchToEpicCommandOptions(first);
  const branchName = await resolveBranchForBinding(workspaceRoot, gitService, options);
  if (!branchName) {
    return false;
  }

  const selectedEpic = resolveLatestEpicState(epics, resolveEpicCommandTarget(first, second));
  const linkedEpic = epics.find((epic) => epic.coordination?.branches.some((branch) => branch.name === branchName));
  if (linkedEpic && selectedEpic?.key === linkedEpic.key) {
    if (options.openPinnedWorkspace) {
      await vscode.commands.executeCommand('apexDelivery.openLinkedBranchWorktree', {
        nonInteractive: true,
        branchName,
      }, selectedEpic);
      return true;
    }
    void vscode.window.showInformationMessage(`Branch "${branchName}" is already bound to ${linkedEpic.key}.`);
    return true;
  }

  const linked = await linkBranchToEpic(
    epics,
    branchName,
    options,
    selectedEpic,
    output,
    linkedEpic || branchName === gitService.getCurrentBranch(workspaceRoot).branchName ? 'current' : 'selected',
  );
  if (!linked) {
    return false;
  }

  if (options.openPinnedWorkspace) {
    await vscode.commands.executeCommand('apexDelivery.openLinkedBranchWorktree', {
      nonInteractive: true,
      branchName,
    }, selectedEpic);
  }

  return true;
}

async function manageCurrentBranchBindingCommand(
  epics: readonly EpicStatus[],
  workspaceRoot: string,
  gitService: GitService,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const branchResult = gitService.getCurrentBranch(workspaceRoot);
  if (!branchResult.branchName) {
    void vscode.window.showWarningMessage(branchResult.error ?? 'Current Git branch could not be resolved.');
    return false;
  }

  const branchName = branchResult.branchName;
  const linkedEpics = epics.filter((epic) => epic.coordination?.branches.some((branch) => branch.name === branchName));
  if (linkedEpics.length > 1) {
    void vscode.window.showWarningMessage(`Current branch "${branchName}" is linked to multiple epics. Inspect the bindings and clean them up first.`);
    await inspectEpicBranchBindingsCommand(linkedEpics, linkedEpics[0], undefined, output);
    return false;
  }

  const linkedEpic = linkedEpics[0];
  if (!linkedEpic) {
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Bind Current Branch To Epic', value: 'bind', detail: `Bind "${branchName}" to a delivery epic.` },
        { label: 'Open Dashboard', value: 'dashboard', detail: 'Open the APEX dashboard instead.' },
      ],
      {
        title: `Current Branch: ${branchName}`,
        placeHolder: 'This branch is not bound to an epic yet.',
      },
    );
    if (!action) {
      return false;
    }
    if (action.value === 'dashboard') {
      await vscode.commands.executeCommand('apexDelivery.openDashboard');
      return false;
    }
    return bindBranchToEpicCommand(epics, workspaceRoot, gitService, { useCurrentBranch: true }, undefined, output);
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: 'Open Pinned Workspace', value: 'open', detail: `Open the pinned workspace for ${branchName}.` },
      { label: 'Rebind To Another Epic', value: 'move', detail: `Move "${branchName}" from ${linkedEpic.key} to another epic.` },
      { label: 'Unlink From Epic', value: 'unlink', detail: `Remove "${branchName}" from ${linkedEpic.key}.` },
      { label: 'Open Linked Epic', value: 'epic', detail: `${linkedEpic.key} - ${linkedEpic.title}` },
    ],
    {
      title: `Manage Current Branch Binding`,
      placeHolder: `${branchName} is currently bound to ${linkedEpic.key}.`,
    },
  );
  if (!action) {
    return false;
  }

  if (action.value === 'open') {
    await vscode.commands.executeCommand('apexDelivery.openLinkedBranchWorktree', {
      nonInteractive: true,
      branchName,
    }, linkedEpic);
    return true;
  }
  if (action.value === 'move') {
    return moveBranchToEpicCommand(epics, linkedEpic, undefined, output);
  }
  if (action.value === 'unlink') {
    return unlinkBranchFromEpicCommand(epics, linkedEpic, undefined, output);
  }

  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(linkedEpic.folderPath, 'EPIC.md')));
  return false;
}

async function linkBranchToEpic(
  epics: readonly EpicStatus[],
  branchName: string,
  first: unknown,
  second: EpicStatus | undefined,
  output: vscode.OutputChannel,
  source: 'current' | 'selected',
): Promise<boolean> {
  const selectedEpic = resolveLatestEpicState(epics, resolveEpicCommandTarget(first, second)) ?? await pickEpicForBranchLink(epics, branchName, {
    title: 'Bind Branch To Epic',
    placeHolder: `Choose an epic for branch "${branchName}".`,
  });
  if (!selectedEpic) {
    return false;
  }

  if (selectedEpic.coordination?.branches.some((branch) => branch.name === branchName)) {
    output.appendLine(`[Coordination] Branch ${branchName} is already linked to ${selectedEpic.key}.`);
    return true;
  }

  const conflictingEpic = findBranchBindingConflict(epics, branchName, selectedEpic.key);
  if (conflictingEpic) {
    const branchLabel = source === 'current' ? 'Current branch' : 'Branch';
    const conflictChoice = await vscode.window.showWarningMessage(
      `${branchLabel} "${branchName}" is already bound to active epic ${conflictingEpic.key}.`,
      'Move To Selected Epic',
      'Open Linked Epic',
      'Cancel',
    );
    if (conflictChoice === 'Open Linked Epic') {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(conflictingEpic.folderPath, 'EPIC.md')));
      return false;
    }
    if (conflictChoice !== 'Move To Selected Epic') {
      return false;
    }

    const moved = moveBranchBinding(conflictingEpic, selectedEpic, branchName, output);
    if (moved) {
      void vscode.window.showInformationMessage(`Moved branch "${branchName}" from ${conflictingEpic.key} to ${selectedEpic.key}.`);
    }
    return moved;
  }

  const metadataResult = readCoordinationMetadata(selectedEpic.folderPath);
  if (metadataResult.error) {
    void vscode.window.showErrorMessage(`Cannot update coordination metadata for ${selectedEpic.key}: ${metadataResult.error}`);
    return false;
  }

  const metadata = withBranchBinding(
    {
      ...(metadataResult.metadata ?? createDefaultCoordinationMetadata(selectedEpic.key)),
      mode: metadataResult.metadata?.mode ?? 'current-branch',
    },
    {
      name: branchName,
      role: 'implementation',
      createdByApex: false,
      linkedAt: new Date().toISOString(),
    },
  );
  writeCoordinationMetadata(selectedEpic.folderPath, metadata, metadataResult.raw);
  output.appendLine(`[Coordination] Bound branch ${branchName} to ${selectedEpic.key}.`);
  void vscode.window.showInformationMessage(`Bound branch "${branchName}" to ${selectedEpic.key}.`);
  return true;
}

function findBranchBindingConflict(
  epics: readonly EpicStatus[],
  branchName: string,
  targetEpicKey: string,
): EpicStatus | undefined {
  return epics.find((epic) => epic.key !== targetEpicKey
    && epic.progress < 100
    && epic.coordination?.branches.some((branch) => branch.name === branchName));
}

async function unlinkBranchFromEpicCommand(
  epics: readonly EpicStatus[],
  first: unknown,
  second: EpicStatus | undefined,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const targetEpic = resolveLatestEpicState(epics, resolveEpicCommandTarget(first, second)) ?? await pickEpicForCommand(
    epics.filter((epic) => (epic.coordination?.branches.length ?? 0) > 0),
    'Unlink Branch From Epic',
    'Choose an epic whose branch binding should be removed.',
  );
  if (!targetEpic) {
    return false;
  }

  const branchName = await pickLinkedBranchForEpic(
    targetEpic,
    getLinkedBranchNames(targetEpic),
    'Unlink Branch From Epic',
    `Choose a linked branch to remove from ${targetEpic.key}.`,
    undefined,
  );
  if (!branchName) {
    return false;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Remove linked branch "${branchName}" from ${targetEpic.key}?`,
    { modal: true },
    'Unlink Branch',
  );
  if (confirmation !== 'Unlink Branch') {
    return false;
  }

  unlinkBranchBinding(targetEpic, branchName, output);
  void vscode.window.showInformationMessage(`Removed branch "${branchName}" from ${targetEpic.key}.`);
  return true;
}

async function moveBranchToEpicCommand(
  epics: readonly EpicStatus[],
  first: unknown,
  second: EpicStatus | undefined,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const sourceEpic = resolveLatestEpicState(epics, resolveEpicCommandTarget(first, second)) ?? await pickEpicForCommand(
    epics.filter((epic) => (epic.coordination?.branches.length ?? 0) > 0),
    'Move Branch To Epic',
    'Choose the source epic whose branch binding should move.',
  );
  if (!sourceEpic) {
    return false;
  }

  const branchName = await pickLinkedBranchForEpic(
    sourceEpic,
    getLinkedBranchNames(sourceEpic),
    'Move Branch To Epic',
    `Choose the linked branch to move from ${sourceEpic.key}.`,
    undefined,
  );
  if (!branchName) {
    return false;
  }

  const candidateEpics = epics.filter((epic) => epic.key !== sourceEpic.key);
  const targetEpic = await pickEpicForBranchLink(candidateEpics, branchName, {
    title: 'Move Branch To Epic',
    placeHolder: `Choose the destination epic for branch "${branchName}".`,
  });
  if (!targetEpic) {
    return false;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Move branch "${branchName}" from ${sourceEpic.key} to ${targetEpic.key}?`,
    { modal: true },
    'Move Branch',
  );
  if (confirmation !== 'Move Branch') {
    return false;
  }

  moveBranchBinding(sourceEpic, targetEpic, branchName, output);
  void vscode.window.showInformationMessage(`Moved branch "${branchName}" from ${sourceEpic.key} to ${targetEpic.key}.`);
  return true;
}

async function inspectEpicBranchBindingsCommand(
  epics: readonly EpicStatus[],
  first: unknown,
  second: EpicStatus | undefined,
  output: vscode.OutputChannel,
): Promise<void> {
  const targetEpic = resolveLatestEpicState(epics, resolveEpicCommandTarget(first, second)) ?? await pickEpicForCommand(
    epics,
    'Inspect Epic Branch Bindings',
    'Choose an epic to inspect branch bindings.',
  );
  if (!targetEpic) {
    return;
  }

  const branches = targetEpic.coordination?.branches ?? [];
  if (branches.length === 0) {
    void vscode.window.showInformationMessage(`${targetEpic.key} has no linked branches.`);
    return;
  }

  const selection = await vscode.window.showQuickPick(
    branches.map((branch) => ({
      label: branch.name,
      description: branch.role ?? 'implementation',
      detail: `Linked at ${branch.linkedAt ?? 'unknown'}${branch.baseBranch ? ` · base ${branch.baseBranch}` : ''}`,
      branch,
    })),
    {
      title: `Branch bindings for ${targetEpic.key}`,
      placeHolder: 'Inspect current branch bindings for this epic.',
    },
  );
  if (!selection) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: 'Open Pinned Workspace', value: 'open' },
      { label: 'Unlink Branch', value: 'unlink' },
      { label: 'Move Branch To Another Epic', value: 'move' },
    ],
    {
      title: `${targetEpic.key} · ${selection.branch.name}`,
      placeHolder: 'Choose what to do with this branch binding.',
    },
  );
  if (!action) {
    return;
  }

  if (action.value === 'open') {
    await vscode.commands.executeCommand('apexDelivery.openLinkedBranchWorktree', {
      nonInteractive: true,
      branchName: selection.branch.name,
    }, targetEpic);
    return;
  }

  if (action.value === 'unlink') {
    await unlinkBranchFromEpicCommand(epics, targetEpic, undefined, output);
    return;
  }

  await moveBranchToEpicCommand(epics, targetEpic, undefined, output);
}

function moveBranchBinding(
  sourceEpic: EpicStatus,
  targetEpic: EpicStatus,
  branchName: string,
  output: vscode.OutputChannel,
): boolean {
  const sourceMetadataResult = readCoordinationMetadata(sourceEpic.folderPath);
  const targetMetadataResult = readCoordinationMetadata(targetEpic.folderPath);
  if (sourceMetadataResult.error || targetMetadataResult.error) {
    void vscode.window.showErrorMessage(sourceMetadataResult.error ?? targetMetadataResult.error ?? 'Unable to move branch binding.');
    return false;
  }

  const sourceMetadata = sourceMetadataResult.metadata ?? createDefaultCoordinationMetadata(sourceEpic.key);
  const targetMetadata = targetMetadataResult.metadata ?? createDefaultCoordinationMetadata(targetEpic.key);
  const existingBinding = sourceMetadata.branches.find((branch) => branch.name === branchName);
  if (!existingBinding) {
    void vscode.window.showWarningMessage(`Branch "${branchName}" is not linked to ${sourceEpic.key}.`);
    return false;
  }

  writeCoordinationMetadata(sourceEpic.folderPath, withoutBranchBinding(sourceMetadata, branchName), sourceMetadataResult.raw);
  writeCoordinationMetadata(
    targetEpic.folderPath,
    withBranchBinding(targetMetadata, {
      ...existingBinding,
      linkedAt: new Date().toISOString(),
    }),
    targetMetadataResult.raw,
  );
  output.appendLine(`[Coordination] Moved branch ${branchName} from ${sourceEpic.key} to ${targetEpic.key}.`);
  return true;
}

function unlinkBranchBinding(epic: EpicStatus, branchName: string, output: vscode.OutputChannel): boolean {
  const metadataResult = readCoordinationMetadata(epic.folderPath);
  if (metadataResult.error) {
    void vscode.window.showErrorMessage(`Cannot update coordination metadata for ${epic.key}: ${metadataResult.error}`);
    return false;
  }

  const metadata = metadataResult.metadata ?? createDefaultCoordinationMetadata(epic.key);
  writeCoordinationMetadata(epic.folderPath, withoutBranchBinding(metadata, branchName), metadataResult.raw);
  output.appendLine(`[Coordination] Removed branch ${branchName} from ${epic.key}.`);
  return true;
}

function buildEpicBranchLinkDetail(epic: EpicStatus, branchName: string): string {
  const owner = epic.coordination?.owner ? `Owner: ${epic.coordination.owner}` : 'Owner: none';
  const currentPhase = epic.phases[epic.currentPhaseIndex]?.name ?? 'Complete';
  const linkedBranches = epic.coordination?.branches.length ?? 0;
  const branchStatus = epic.coordination?.branches.some((branch) => branch.name === branchName)
    ? `already linked to ${branchName}`
    : linkedBranches === 0
      ? 'no linked branches yet'
      : `${linkedBranches} linked branch${linkedBranches === 1 ? '' : 'es'}`;
  return `${owner} · Phase: ${currentPhase} · ${branchStatus}`;
}

function scoreEpicBranchLinkFit(epic: EpicStatus, branchName: string): number {
  let score = 0;
  const normalizedBranchName = branchName.toLowerCase();
  if ((epic.coordination?.branches.length ?? 0) === 0) {
    score += 8;
  }
  if (normalizedBranchName.includes(epic.key.toLowerCase())) {
    score += 20;
  }
  if (epic.title.toLowerCase().split(/\s+/).some((token) => token.length >= 4 && normalizedBranchName.includes(token))) {
    score += 10;
  }
  if (epic.progress > 0 && epic.progress < 100) {
    score += 5;
  }
  return score;
}

async function reviewPullRequestCommand(
  first: unknown,
  second: EpicStatus | undefined,
  epics: readonly EpicStatus[],
  currentBranchContext: CurrentBranchEpicContext,
  gitService: GitService,
  workspaceRoot: string,
  epicsPath: string,
  reviewer: string,
  output: vscode.OutputChannel,
): Promise<ReviewPullRequestCommandResult | undefined> {
  const targetEpic = resolveEpicCommandTarget(first, second);
  const options = getReviewPullRequestCommandOptions(first);
  const resolvedOptions = options.nonInteractive
    ? options
    : await collectReviewPullRequestCommandOptions(options, currentBranchContext, targetEpic);
  if (!resolvedOptions) {
    return undefined;
  }

  const normalizedPr = normalizePullRequestInput(resolvedOptions);
  if (!normalizedPr) {
    void vscode.window.showWarningMessage('Provide a pull request number or URL to start PR review mode.');
    return undefined;
  }

  const linkedReviewContext = resolveLinkedEpicForPullRequest(epics, normalizedPr, resolvedOptions, targetEpic, currentBranchContext);
  const linkedEpic = linkedReviewContext?.epic;
  const linkedBinding = linkedReviewContext?.binding;
  let baseBranch = resolvedOptions.baseBranch?.trim()
    || linkedBinding?.baseBranch
    || linkedEpic?.coordination?.baseBranch;
  let headBranch = resolvedOptions.headBranch?.trim()
    || linkedBinding?.headBranch
    || currentBranchContext.branchName;
  let reviewWorkspaceRoot = workspaceRoot;
  let linkedEpicFolderPath = linkedEpic?.folderPath;

  if (linkedEpic) {
    const reviewBranchResolution = await resolveEpicExecutionBranch(
      linkedEpic,
      currentBranchContext.branchName,
      {
        explicitBranchName: resolvedOptions.headBranch?.trim() || linkedBinding?.headBranch,
        allowPrompt: !resolvedOptions.nonInteractive,
        preferCurrentBranch: true,
        promptTitle: 'Choose Linked Review Branch',
        promptPlaceHolder: `Choose the linked branch to review for ${linkedEpic.key}.`,
      },
    );

    if (reviewBranchResolution.status === 'cancelled') {
      return undefined;
    }

    if (reviewBranchResolution.status !== 'resolved') {
      const blockedReason = reportEpicExecutionIssue(output, linkedEpic, reviewBranchResolution, gitService.getCurrentBranch(workspaceRoot), 'Review Pull Request');
      return {
        mode: 'blocked',
        linkedEpicKey: linkedEpic.key,
        changedFiles: [],
        prNumber: normalizedPr.number,
        prUrl: normalizedPr.url,
        baseBranch,
        headBranch,
        executionWorkspacePath: workspaceRoot,
        blockedReason,
      } satisfies ReviewPullRequestCommandResult;
    }

    const resolvedReviewBranchName = reviewBranchResolution.branchName;
    if (!resolvedReviewBranchName) {
      return undefined;
    }

    headBranch = resolvedReviewBranchName;
    const linkedWorktree = gitService.findWorktreeForBranch(workspaceRoot, resolvedReviewBranchName);
    if (!linkedWorktree) {
      const blockedReason = `APEX blocked Review Pull Request for ${linkedEpic.key}. Expected linked branch "${resolvedReviewBranchName}" and a local pinned branch workspace for that branch. Current branch "${currentBranchContext.branchName ?? 'unknown'}". Next action: run APEX: Open Pinned Branch Workspace first.`;
      output.appendLine(`[PR Review] ${blockedReason}`);
      void vscode.window.showWarningMessage(blockedReason);
      return {
        mode: 'blocked',
        linkedEpicKey: linkedEpic.key,
        changedFiles: [],
        prNumber: normalizedPr.number,
        prUrl: normalizedPr.url,
        baseBranch,
        headBranch,
        executionWorkspacePath: workspaceRoot,
        blockedReason,
      } satisfies ReviewPullRequestCommandResult;
    }

    reviewWorkspaceRoot = linkedWorktree.path;
    linkedEpicFolderPath = remapWorkspacePath(workspaceRoot, reviewWorkspaceRoot, linkedEpic.folderPath);
    output.appendLine(`[PR Review] Using linked worktree ${reviewWorkspaceRoot} for ${linkedEpic.key}. Base: ${baseBranch ?? 'unspecified'}. Head: ${headBranch}.`);
  }

  const reviewFolderPath = path.join(buildAiDeliveryRoot(reviewWorkspaceRoot, epicsPath), 'reviews', buildPullRequestFolderName(normalizedPr.number, normalizedPr.url));
  const reviewArtifactPath = path.join(reviewFolderPath, 'REVIEW.md');
  const reviewContextPath = path.join(reviewFolderPath, 'review-context.json');
  const generatedAt = new Date().toISOString();
  const changedFiles = baseBranch && headBranch
    ? gitService.getChangedFiles(reviewWorkspaceRoot, baseBranch, headBranch)
    : [];

  const artifactContext: PullRequestReviewArtifactContext = {
    generatedAt,
    reviewer,
    mode: linkedEpic ? 'linked-epic' : 'unlinked',
    pr: {
      provider: resolvedOptions.provider ?? linkedBinding?.provider ?? normalizedPr.provider ?? 'github',
      number: normalizedPr.number,
      url: normalizedPr.url,
      title: resolvedOptions.prTitle,
      baseBranch,
      headBranch,
      author: resolvedOptions.author ?? linkedBinding?.author,
    },
    linkedEpic: linkedEpic ? { key: linkedEpic.key, title: linkedEpic.title } : undefined,
    changedFiles,
  };

  fs.mkdirSync(reviewFolderPath, { recursive: true });
  fs.writeFileSync(reviewArtifactPath, buildPullRequestReviewMarkdown(artifactContext), 'utf8');
  fs.writeFileSync(reviewContextPath, buildPullRequestReviewContextJson(artifactContext), 'utf8');

  let primaryArtifactPath = reviewArtifactPath;
  if (linkedEpic && linkedEpicFolderPath) {
    const epicReviewPath = path.join(linkedEpicFolderPath, 'REVIEW.md');
    const existingEpicReview = fs.existsSync(epicReviewPath) ? fs.readFileSync(epicReviewPath, 'utf8') : undefined;
    const nextEpicReview = upsertPullRequestReviewSection(
      existingEpicReview,
      normalizedPr.number,
      buildPullRequestReviewSection(artifactContext),
    );
    fs.writeFileSync(epicReviewPath, nextEpicReview, 'utf8');
    primaryArtifactPath = epicReviewPath;
  }

  output.appendLine(`[PR Review] Generated ${artifactContext.mode} review for ${formatPullRequestDisplay(normalizedPr.number, normalizedPr.url)}.`);
  output.appendLine(`[PR Review] Primary artifact: ${primaryArtifactPath}`);
  output.appendLine(`[PR Review] Review workspace: ${reviewFolderPath}`);

  if (resolvedOptions.openArtifact !== false) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(primaryArtifactPath));
  }

  return {
    mode: artifactContext.mode,
    artifactPath: primaryArtifactPath,
    reviewArtifactPath,
    reviewContextPath,
    linkedEpicKey: linkedEpic?.key,
    changedFiles,
    prNumber: normalizedPr.number,
    prUrl: normalizedPr.url,
    baseBranch,
    headBranch,
    executionWorkspacePath: reviewWorkspaceRoot,
  };
}

async function collectReviewPullRequestCommandOptions(
  options: ReviewPullRequestCommandOptions,
  currentBranchContext: CurrentBranchEpicContext,
  targetEpic: EpicStatus | undefined,
): Promise<ReviewPullRequestCommandOptions | undefined> {
  const prInput = options.prInput
    ?? options.prUrl
    ?? (options.prNumber !== undefined ? String(options.prNumber) : await vscode.window.showInputBox({
      title: 'Review Pull Request',
      prompt: 'Enter a pull request number or URL.',
      placeHolder: '45 or https://github.com/org/repo/pull/45',
      ignoreFocusOut: true,
      validateInput: (value: string) => value.trim().length === 0 ? 'Pull request number or URL is required.' : null,
    }));
  if (!prInput) {
    return undefined;
  }

  const baseBranch = options.baseBranch ?? await vscode.window.showInputBox({
    title: 'PR Base Branch',
    prompt: 'Enter the PR base branch used for local diff generation.',
    value: targetEpic?.coordination?.baseBranch ?? currentBranchContext.epic?.coordination?.baseBranch ?? 'main',
    ignoreFocusOut: true,
  });
  if (!baseBranch) {
    return undefined;
  }

  const headBranch = options.headBranch ?? await vscode.window.showInputBox({
    title: 'PR Head Branch',
    prompt: 'Enter the PR head branch. Leave the current branch value if it is already checked out.',
    value: currentBranchContext.branchName ?? '',
    ignoreFocusOut: true,
  });
  if (!headBranch) {
    return undefined;
  }

  return {
    ...options,
    prInput,
    baseBranch,
    headBranch,
    openArtifact: options.openArtifact !== false,
  };
}

function resolveLinkedEpicForPullRequest(
  epics: readonly EpicStatus[],
  normalizedPr: NormalizedPullRequestInput,
  options: ReviewPullRequestCommandOptions,
  targetEpic: EpicStatus | undefined,
  currentBranchContext: CurrentBranchEpicContext,
): { epic: EpicStatus; binding?: CoordinationPullRequestBinding } | undefined {
  if (options.linkedEpicKey) {
    const explicitEpic = epics.find((epic) => epic.key === options.linkedEpicKey);
    if (explicitEpic) {
      return { epic: explicitEpic };
    }
  }

  if (targetEpic) {
    return { epic: resolveLatestEpicState(epics, targetEpic) ?? targetEpic };
  }

  const explicitMatch = findExplicitPullRequestLink(epics, normalizedPr, options.headBranch);
  if (explicitMatch) {
    return explicitMatch;
  }

  if (currentBranchContext.epic) {
    return { epic: currentBranchContext.epic };
  }

  return undefined;
}

function findExplicitPullRequestLink(
  epics: readonly EpicStatus[],
  normalizedPr: { number?: number; url?: string },
  headBranch: string | undefined,
): { epic: EpicStatus; binding?: CoordinationPullRequestBinding } | undefined {
  for (const epic of epics) {
    for (const binding of epic.coordination?.pullRequests ?? []) {
      if (matchesPullRequestBinding(binding, normalizedPr, headBranch)) {
        return { epic, binding };
      }
    }
  }
  return undefined;
}

function resolveLatestEpicState(epics: readonly EpicStatus[], epic: EpicStatus | undefined): EpicStatus | undefined {
  if (!epic) {
    return undefined;
  }

  return epics.find((candidate) => candidate.key === epic.key) ?? epic;
}

function matchesPullRequestBinding(
  binding: CoordinationPullRequestBinding,
  normalizedPr: { number?: number; url?: string },
  headBranch: string | undefined,
): boolean {
  if (binding.number !== undefined && normalizedPr.number !== undefined) {
    return binding.number === normalizedPr.number;
  }
  if (binding.url && normalizedPr.url) {
    return binding.url === normalizedPr.url;
  }
  if (binding.headBranch && headBranch) {
    return binding.headBranch === headBranch;
  }
  return false;
}

function buildAiDeliveryRoot(workspaceRoot: string, epicsPath: string): string {
  return path.resolve(workspaceRoot, epicsPath, '..');
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
