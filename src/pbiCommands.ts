import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createWorkflowEpic } from './epicBootstrapper';
import { GitService } from './gitService';
import type { EpicStatus, PhaseStatus } from './pipelineModel';
import {
  buildPbiEvidencePack,
  buildPbiReviewArtifact,
  type CopilotCliHandoffResult,
  computePbiReviewScore,
  findPbiPhase,
  isPbiDeliveryWorkflow,
  writePbiImportNotes,
} from './pbiWorkflow';
import { getPbiDeliveryWorkflowDefinition } from './workflowModel';

export interface PbiCurrentBranchContext {
  epic?: EpicStatus;
}

export interface PbiPhaseRunPreferences {
  autoSubmit: boolean;
  agentTag?: string;
  modelFamily?: string;
  preferredChatAgent?: string;
  starterPrompt?: string;
  starterPromptPlacement: 'prepend' | 'append' | 'replace';
}

export interface PbiPhaseExecutionResolution {
  runPreferences: PbiPhaseRunPreferences;
}

export interface PbiPhaseSessionContext {
  phase: PhaseStatus;
  epic: EpicStatus;
  workspaceRoot: string;
}

export interface PbiPhaseCommandResult {
  mode: 'agent-chat' | 'direct' | 'chat-fallback' | 'cli-handoff' | 'blocked';
  artifactPath: string;
  handoffPath?: string;
  handoffCommand?: string;
}

interface PbiCommandRegistrationOptions {
  context: vscode.ExtensionContext;
  workspaceRoot: string;
  templateRoot: string;
  output: vscode.OutputChannel;
  gitService: GitService;
  getEpicsPath: () => string;
  getOwner: () => string;
  refreshPipeline: () => void;
  getEpics: () => readonly EpicStatus[];
  getCurrentBranchContext: () => PbiCurrentBranchContext;
  resolveEpicCommandTarget: (first: unknown, second?: EpicStatus) => EpicStatus | undefined;
  resolveLatestEpicState: (epics: readonly EpicStatus[], epic: EpicStatus | undefined) => EpicStatus | undefined;
  unwrapPhaseArgs: (first: unknown, second?: EpicStatus) => { phase: PhaseStatus | undefined; epic: EpicStatus | undefined };
  pickEpicForCommand: (
    epics: readonly EpicStatus[],
    title: string,
    placeHolder: string,
  ) => Promise<EpicStatus | undefined>;
  ensurePhaseArtifactExists: (
    phase: PhaseStatus,
    epic: EpicStatus,
    workspaceRoot: string,
    templateRoot: string,
    owner: string,
    output: vscode.OutputChannel,
    refreshPipeline: () => void,
  ) => void;
  resolvePhaseSessionContext: (
    phase: PhaseStatus,
    epic: EpicStatus,
    workspaceRoot: string,
  ) => Promise<PbiPhaseSessionContext>;
  getPhaseExecutionResolution: (
    epic: EpicStatus,
    phase: PhaseStatus,
  ) => PbiPhaseExecutionResolution;
  createCopilotCliPhaseHandoff: (
    session: PbiPhaseSessionContext,
    runPreferences: PbiPhaseRunPreferences,
    output: vscode.OutputChannel,
  ) => Promise<CopilotCliHandoffResult>;
  runPhaseInCopilot: (request: Record<string, unknown>) => Thenable<PbiPhaseCommandResult | undefined>;
  normalizeNonEmptyString: (value: unknown) => string | undefined;
}

export function registerPbiCommands(options: PbiCommandRegistrationOptions): void {
  const {
    context,
    workspaceRoot,
    templateRoot,
    output,
    gitService,
    getEpicsPath,
    getOwner,
    refreshPipeline,
    getEpics,
    getCurrentBranchContext,
    resolveEpicCommandTarget,
    resolveLatestEpicState,
    unwrapPhaseArgs,
    pickEpicForCommand,
    ensurePhaseArtifactExists,
    resolvePhaseSessionContext,
    getPhaseExecutionResolution,
    createCopilotCliPhaseHandoff,
    runPhaseInCopilot,
    normalizeNonEmptyString,
  } = options;

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.createPbiDelivery', async (value: unknown) => {
    const commandOptions = isRecord(value) ? value : {};
    const title = normalizeNonEmptyString(commandOptions.title)
      ?? await vscode.window.showInputBox({
        title: 'Create PBI Delivery',
        prompt: 'Enter the PBI title.',
        placeHolder: 'Improve PR review flow for delivery leads',
        ignoreFocusOut: true,
        validateInput: (input) => input.trim().length === 0 ? 'PBI title is required.' : null,
      });
    if (!title) {
      return;
    }

    const result = createWorkflowEpic(
      workspaceRoot,
      getEpicsPath(),
      templateRoot,
      getPbiDeliveryWorkflowDefinition(),
      {
        title,
        owner: getOwner(),
        initialPhaseNote: 'PBI delivery created. Start by normalizing the intake and acceptance criteria.',
      },
    );
    output.appendLine(`Created PBI delivery epic: ${result.epicKey}`);
    refreshPipeline();
    const epic = getEpics().find((candidate) => candidate.key === result.epicKey);
    if (epic && typeof commandOptions.text === 'string' && commandOptions.text.trim().length > 0) {
      writePbiImportNotes(epic, commandOptions.text, normalizeNonEmptyString(commandOptions.source));
    }
    const artifactPath = epic ? path.join(epic.folderPath, 'PBI.md') : path.join(result.folderPath, 'PBI.md');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(artifactPath));
    void vscode.window.showInformationMessage(`Created PBI delivery epic ${result.epicKey}.`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.importPbiFromText', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    let targetEpic = resolveEpicCommandTarget(first, second) ?? getCurrentBranchContext().epic;
    const rawInput = isRecord(first) && typeof first.text === 'string'
      ? first.text
      : await vscode.window.showInputBox({
        title: 'Import PBI From Text',
        prompt: 'Paste the PBI, issue, or request text.',
        placeHolder: 'Paste the ticket description or business request here.',
        ignoreFocusOut: true,
        validateInput: (input) => input.trim().length === 0 ? 'PBI text is required.' : null,
      });
    if (!rawInput) {
      return;
    }

    if (!targetEpic || !isPbiDeliveryWorkflow(targetEpic.workflowId)) {
      const title = normalizeNonEmptyString(isRecord(first) ? first.title : undefined)
        ?? rawInput.trim().split(/\r?\n/, 1)[0]
        ?? 'Imported PBI';
      const created = createWorkflowEpic(
        workspaceRoot,
        getEpicsPath(),
        templateRoot,
        getPbiDeliveryWorkflowDefinition(),
        {
          title,
          owner: getOwner(),
          initialPhaseNote: 'PBI delivery created from imported text. Normalize the intake before advancing.',
        },
      );
      refreshPipeline();
      targetEpic = getEpics().find((candidate) => candidate.key === created.epicKey);
    }

    if (!targetEpic) {
      return;
    }

    const artifactPath = writePbiImportNotes(targetEpic, rawInput, normalizeNonEmptyString(isRecord(first) ? first.source : undefined));
    output.appendLine(`[PBI] Imported intake text into ${artifactPath}.`);
    refreshPipeline();
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(artifactPath));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.explainCodeFlow', async (first: unknown, second?: EpicStatus) => {
    return runNamedPbiPhaseCommand('code-flow', first, second);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.createTestDecision', async (first: unknown, second?: EpicStatus) => {
    return runNamedPbiPhaseCommand('test-decision', first, second);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.runTddSlice', async (first: unknown, second?: EpicStatus) => {
    return runNamedPbiPhaseCommand('tdd-implementation', first, second);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.reviewByPbi', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const epic = await resolvePbiEpicTarget(first, second);
    if (!epic) {
      return;
    }

    const changedFiles = collectEpicChangedFiles(epic);
    const reviewArtifact = buildPbiReviewArtifact(epic, changedFiles);
    const reviewPath = path.join(epic.folderPath, 'PBI-REVIEW.md');
    fs.writeFileSync(reviewPath, reviewArtifact, 'utf8');
    output.appendLine(`[PBI] Generated PBI review artifact for ${epic.key}.`);
    refreshPipeline();
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(reviewPath));
    return runNamedPbiPhaseCommand(
      'pbi-review',
      { epic, phase: findPbiPhase(epic, 'pbi-review'), nonInteractive: true },
      undefined,
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.generateEvidencePack', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const epic = await resolvePbiEpicTarget(first, second);
    if (!epic) {
      return;
    }

    const changedFiles = collectEpicChangedFiles(epic);
    const evidencePath = path.join(epic.folderPath, 'EVIDENCE.md');
    fs.writeFileSync(evidencePath, buildPbiEvidencePack(epic, changedFiles), 'utf8');
    output.appendLine(`[PBI] Generated evidence pack for ${epic.key}.`);
    refreshPipeline();
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(evidencePath));
    return {
      artifactPath: evidencePath,
      score: computePbiReviewScore(epic, changedFiles),
      changedFiles,
    };
  }));

  context.subscriptions.push(vscode.commands.registerCommand('apexDelivery.generateCopilotCliHandoff', async (first: unknown, second?: EpicStatus) => {
    refreshPipeline();
    const target = await resolvePbiPhaseTarget(first, second);
    if (!target) {
      return;
    }

    ensurePhaseArtifactExists(target.phase, target.epic, workspaceRoot, templateRoot, getOwner(), output, refreshPipeline);
    const session = await resolvePhaseSessionContext(target.phase, target.epic, workspaceRoot);
    const executionResolution = getPhaseExecutionResolution(target.epic, target.phase);
    const handoff = await createCopilotCliPhaseHandoff(session, executionResolution.runPreferences, output);
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(handoff.promptPath));
    void vscode.window.showInformationMessage(`Generated Copilot CLI handoff for ${target.epic.key}. Command copied to clipboard.`);
    return {
      artifactPath: target.phase.artifactPath,
      handoffPath: handoff.promptPath,
      handoffCommand: handoff.command,
    };
  }));

  async function resolvePbiEpicTarget(first: unknown, second?: EpicStatus): Promise<EpicStatus | undefined> {
    const epics = getEpics();
    const directEpic = resolveLatestEpicState(epics, resolveEpicCommandTarget(first, second) ?? getCurrentBranchContext().epic);
    if (directEpic && isPbiDeliveryWorkflow(directEpic.workflowId)) {
      return directEpic;
    }

    const pbiEpics = epics.filter((epic) => isPbiDeliveryWorkflow(epic.workflowId));
    if (pbiEpics.length === 0) {
      void vscode.window.showWarningMessage('No PBI Delivery epics were found. Create one first.');
      return undefined;
    }

    if (pbiEpics.length === 1) {
      return pbiEpics[0];
    }

    return pickEpicForCommand(
      pbiEpics,
      'Select PBI Delivery',
      'Choose the PBI delivery epic to use for this command.',
    );
  }

  async function resolvePbiPhaseTarget(
    first: unknown,
    second?: EpicStatus,
    expectedPhaseId?: string,
  ): Promise<{ epic: EpicStatus; phase: PhaseStatus } | undefined> {
    const epics = getEpics();
    const directTarget = unwrapPhaseArgs(first, second);
    if (directTarget.epic && directTarget.phase && isPbiDeliveryWorkflow(directTarget.epic.workflowId)) {
      if (!expectedPhaseId || directTarget.phase.id === expectedPhaseId) {
        const latestEpic = resolveLatestEpicState(epics, directTarget.epic) ?? directTarget.epic;
        return {
          epic: latestEpic,
          phase: latestEpic.phases.find((phase) => phase.id === directTarget.phase?.id) ?? directTarget.phase,
        };
      }
    }

    const epic = await resolvePbiEpicTarget(first, second);
    if (!epic) {
      return undefined;
    }

    const phase = expectedPhaseId
      ? findPbiPhase(epic, expectedPhaseId)
      : epic.phases[epic.currentPhaseIndex] ?? epic.phases[0];
    if (!phase) {
      void vscode.window.showWarningMessage(`PBI delivery epic ${epic.key} does not contain the requested phase.`);
      return undefined;
    }

    return { epic, phase };
  }

  async function runNamedPbiPhaseCommand(
    phaseId: string,
    first: unknown,
    second?: EpicStatus,
  ): Promise<PbiPhaseCommandResult | undefined> {
    const target = await resolvePbiPhaseTarget(first, second, phaseId);
    if (!target) {
      return undefined;
    }

    output.appendLine(`[PBI] Running ${target.epic.key} / ${target.phase.id}.`);
    const commandOptions = isRecord(first) ? first : {};
    return runPhaseInCopilot({
      ...commandOptions,
      epic: target.epic,
      phase: target.phase,
    });
  }

  function collectEpicChangedFiles(epic: EpicStatus): string[] {
    const linkedPullRequest = epic.coordination?.pullRequests[0];
    const linkedBranch = linkedPullRequest?.headBranch ?? epic.coordination?.branches[0]?.name;
    const baseBranch = linkedPullRequest?.baseBranch ?? epic.coordination?.baseBranch;
    if (!baseBranch || !linkedBranch) {
      return [];
    }

    const executionWorkspace = gitService.findWorktreeForBranch(workspaceRoot, linkedBranch)?.path ?? workspaceRoot;
    return gitService.getChangedFiles(executionWorkspace, baseBranch, linkedBranch);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
