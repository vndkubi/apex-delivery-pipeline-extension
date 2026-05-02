import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { EpicStatus, PhaseStatus } from '../../pipelineModel';
import { PipelineScanner } from '../../pipelineScanner';

interface SmokeCommandResult {
  mode: 'agent-chat' | 'direct' | 'chat-fallback' | 'blocked';
  artifactPath: string;
  modelLabel?: string;
  responseText?: string;
  fallbackReason?: string;
  chatStarter?: string;
  chatLaunchResult?: 'submitted' | 'prefilled' | 'opened' | 'unavailable';
  verification?: Array<{
    kind: 'build' | 'test' | 'lint';
    outcome: 'passed' | 'failed' | 'skipped';
    command?: string;
    output: string;
    durationMs: number;
    source: string;
  }>;
  runPreferences?: {
    autoSubmit: boolean;
    preferredChatAgent?: string;
    agentTag?: string;
    modelFamily?: string;
  };
  rolePolicyResolution?: {
    userRole?: string;
    preferredRole?: string;
    status: 'not-configured' | 'not-required' | 'matched' | 'mismatched';
  };
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
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('vndkubi.apex-delivery-pipeline-v1');
  assert.ok(extension, 'Expected APEX extension to be present in the extension host');
  await extension.activate();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, 'Expected smoke test workspace to be open');
  seedWorkspacePackageJson(workspaceRoot);

  const integratedFlow = await vscode.commands.executeCommand<IntegratedFlowCommandResult>('apexDelivery.startIntegratedFlow', {
    nonInteractive: true,
    openSpec: true,
  });
  assert.ok(integratedFlow, 'Expected the integrated delivery flow to return a result');
  assert.ok(fs.existsSync(integratedFlow.specFilePath), 'Expected integrated delivery flow to create spec.md');
  assert.ok(fs.existsSync(integratedFlow.copilotInstructionsPath), 'Expected integrated delivery flow to create the Copilot bootstrap pack');
  assert.strictEqual(
    vscode.window.activeTextEditor?.document.uri.fsPath,
    integratedFlow.specFilePath,
    'Expected the quick-start flow to open spec.md automatically',
  );

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  await vscode.workspace.getConfiguration('apexDelivery').update('workflowDefinitions', {
    'investigate-workflow': {
      name: 'Investigate Only',
      phases: [
        {
          id: 'investigate',
          name: 'Investigate',
          owner: 'Business Analyst',
          artifact: 'DISCOVER.md',
          gate: 'Gate 1',
          output: 'Problem baseline captured',
          autopilot: {
            enabled: true,
            retryLimit: 0,
          },
        },
        {
          id: 'triage',
          name: 'Triage',
          owner: 'Code Reviewer',
          artifact: 'REVIEW.md',
          gate: 'Gate 2',
          output: 'Risk summary captured',
        },
        {
          id: 'handoff',
          name: 'Handoff',
          owner: 'APEX Owner',
          artifact: 'LEARN.md',
          gate: 'Gate 3',
          output: 'Next action recorded',
        },
      ],
    },
  }, vscode.ConfigurationTarget.Workspace);

  await vscode.commands.executeCommand('apexDelivery.createSampleEpic', {
    nonInteractive: true,
    workflowId: 'investigate-workflow',
  });
  const epic = await waitForEpic(workspaceRoot);
  assert.strictEqual(epic.workflowId, 'investigate-workflow', 'Expected the sample epic to carry the selected workflow id');
  assert.deepStrictEqual(
    epic.phases.map((candidate) => candidate.id),
    ['investigate', 'triage', 'handoff'],
    'Expected the sample epic to use the snapshotted workflow phases',
  );
  const phase = epic.phases[0];
  assert.ok(phase, 'Expected the sample epic to include at least one phase');

  const fullyAutomaticTitleFallback = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'apexDelivery.runPhaseInCopilot') {
      const request = args[0] as {
        phase?: PhaseStatus;
        epic?: EpicStatus;
        autopilotExecutionMode?: string;
        nonInteractive?: boolean;
      } | undefined;
      assert.strictEqual(request?.epic?.key, epic.key, 'Expected the fully automatic title command to fall back to the only epic in the tree when no explicit target is supplied');
      assert.strictEqual(request?.phase?.id, phase.id, 'Expected the fully automatic title command to fall back to the current phase of the only epic when no explicit target is supplied');
      assert.strictEqual(request?.autopilotExecutionMode, 'fully-automatic', 'Expected the fully automatic title command to preserve the command-level execution mode override');
      assert.strictEqual(request?.nonInteractive, true, 'Expected the fully automatic title command smoke test to stay non-interactive');
      return {
        mode: 'blocked',
        artifactPath: phase.artifactPath,
        fallbackReason: 'Title command fallback resolved the only epic.',
        verification: [buildPassedVerificationRecord()],
      } satisfies SmokeCommandResult;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runFullyAutomaticAutopilot', {
    nonInteractive: true,
  }));

  assert.ok(fullyAutomaticTitleFallback, 'Expected the fully automatic title command to return a result when it falls back to the only epic in the tree');
  assert.strictEqual(fullyAutomaticTitleFallback.outcome, 'paused', 'Expected the fully automatic title command to keep fully automatic pause semantics after resolving the implicit target');
  assert.match(fullyAutomaticTitleFallback.reason ?? '', /Title command fallback resolved the only epic/i, 'Expected the fully automatic title command to surface the direct-path block reason after resolving the implicit target');

  await vscode.workspace.getConfiguration('apexDelivery').update('userRole', 'Developer', vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('apexDelivery').update('runPhase.rolePolicies', {
    Developer: {
      preferredChatAgent: 'Code Reviewer',
      modelFamily: 'gpt-4o',
      autoSubmit: false,
    },
  }, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('apexDelivery').update('runPhase.phaseProfiles', {
    [epic.workflowId]: {
      [phase.id]: {
        preferredChatAgent: 'Business Analyst',
        autoSubmit: true,
      },
    },
  }, vscode.ConfigurationTarget.Workspace);

  const result = await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
    phase,
    epic,
    nonInteractive: true,
    forceChatFallback: true,
  });

  assert.ok(result, 'Expected the phase command to return a smoke-test result');
  assert.ok(fs.existsSync(result.artifactPath), 'Expected the phase artifact to exist after the run');
  assert.ok(result.mode === 'direct' || result.mode === 'chat-fallback', 'Expected a valid execution mode');
  assert.match(
    fs.readFileSync(result.artifactPath, 'utf8'),
    /## Verification Evidence/i,
    'Expected the phase artifact to include the verification evidence section after the run',
  );

  assert.strictEqual(result.mode, 'chat-fallback', 'Expected the smoke test to exercise the Copilot Chat fallback path');
  assert.ok(typeof result.chatStarter === 'string' && result.chatStarter.includes('@apex'), 'Expected fallback execution to prepare an @apex chat starter');
  assert.strictEqual(result.chatLaunchResult, 'prefilled', 'Expected fallback execution to open Copilot Chat with the @apex prompt prefilled but not submitted');
  assert.strictEqual(result.runPreferences?.preferredChatAgent, 'Business Analyst', 'Expected explicit phase profile overrides to win over role defaults');
  assert.strictEqual(result.rolePolicyResolution?.status, 'mismatched', 'Expected the current user role to mismatch the phase owner');
  assert.strictEqual(result.rolePolicyResolution?.userRole, 'Developer', 'Expected the role-aware resolver to record the configured user role');
  assert.strictEqual(result.rolePolicyResolution?.preferredRole, 'Business Analyst', 'Expected the role-aware resolver to record the preferred phase role');
  assert.match(
    result.fallbackReason ?? '',
    /prefilled via public command integration/i,
    'Expected fallback execution to report public Copilot Chat prefill integration',
  );

  const agentLaunches: Array<{ command: string; args: readonly unknown[] }> = [];
  const agentModeResult = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'workbench.action.chat.open' && isAgentChatOpenRequest(args[0])) {
      agentLaunches.push({ command, args });
      return undefined;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
    phase,
    epic,
    nonInteractive: true,
  }));

  assert.ok(agentModeResult, 'Expected the phase command to return a result for non-interactive agent mode');
  assert.strictEqual(agentModeResult.mode, 'agent-chat', 'Expected non-interactive execution to launch Copilot agent mode before direct model fallback');
  assert.strictEqual(agentModeResult.chatLaunchResult, 'submitted', 'Expected agent mode to submit immediately when autoSubmit is enabled');
  assert.ok(agentLaunches.length > 0, 'Expected non-interactive execution to invoke the Copilot agent launch command');
  const [agentLaunch] = agentLaunches;
  assert.ok(agentLaunch, 'Expected to capture the Copilot agent launch payload');
  const agentRequest = agentLaunch.args[0] as {
    mode?: string;
    query?: string;
    isPartialQuery?: boolean;
    attachFiles?: readonly vscode.Uri[];
  };
  assert.strictEqual(agentRequest.mode, 'agent', 'Expected the Copilot chat command to open in agent mode');
  assert.ok(typeof agentRequest.query === 'string' && agentRequest.query.includes('Update the attached phase artifact'), 'Expected the agent prompt to target the attached phase artifact');
  assert.strictEqual(agentRequest.isPartialQuery, undefined, 'Expected agent auto-submit to omit partial-query mode');
  assert.ok(Array.isArray(agentRequest.attachFiles) && agentRequest.attachFiles.length >= 3, 'Expected the phase artifact, epic brief, and status file to be attached to the agent request');

  await vscode.workspace.getConfiguration('apexDelivery').update('autopilot.executionMode', 'fully-automatic', vscode.ConfigurationTarget.Workspace);
  const fullyAutomaticChatLaunches: Array<{ command: string; args: readonly unknown[] }> = [];
  const fullyAutomaticBlockedResult = await withPatchedSelectChatModels(async () => [], async () => withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'workbench.action.chat.open') {
      fullyAutomaticChatLaunches.push({ command, args });
      return undefined;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
    phase,
    epic,
    nonInteractive: true,
  })));

  assert.ok(fullyAutomaticBlockedResult, 'Expected a non-interactive result when fully automatic mode skips chat paths');
  assert.strictEqual(fullyAutomaticBlockedResult.mode, 'blocked', 'Expected fully automatic mode to block instead of opening chat when direct model access is unavailable');
  assert.strictEqual(fullyAutomaticChatLaunches.length, 0, 'Expected fully automatic mode to avoid opening Copilot chat automatically');
  assert.match(
    fullyAutomaticBlockedResult.fallbackReason ?? '',
    /Fully automatic mode could not continue/i,
    'Expected fully automatic mode to report why the observable direct path could not continue',
  );

  const fullyAutomaticPaused = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'apexDelivery.runPhaseInCopilot') {
      return {
        mode: 'blocked',
        artifactPath: phase.artifactPath,
        fallbackReason: 'Fully automatic test block.',
        verification: [buildPassedVerificationRecord()],
      } satisfies SmokeCommandResult;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runGuidedAutopilot', {
    phase,
    epic,
    nonInteractive: true,
  }));

  assert.ok(fullyAutomaticPaused, 'Expected fully automatic Guided Autopilot to return a result when the direct path is blocked');
  assert.strictEqual(fullyAutomaticPaused.outcome, 'paused', 'Expected fully automatic Guided Autopilot to pause when no observable direct completion is available');
  assert.match(fullyAutomaticPaused.reason ?? '', /Fully automatic test block/i, 'Expected Guided Autopilot to preserve the block reason from the direct path');

  await vscode.workspace.getConfiguration('apexDelivery').update('autopilot.executionMode', 'agent-pause', vscode.ConfigurationTarget.Workspace);
  const fullyAutomaticCommandResult = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'apexDelivery.runPhaseInCopilot') {
      const request = args[0] as { autopilotExecutionMode?: string; forceChatFallback?: boolean } | undefined;
      assert.strictEqual(request?.autopilotExecutionMode, 'fully-automatic', 'Expected the dedicated fully automatic command to override the workspace autopilot mode');
      assert.strictEqual(request?.forceChatFallback, false, 'Expected the dedicated fully automatic command to suppress chat fallback overrides');
      return {
        mode: 'blocked',
        artifactPath: phase.artifactPath,
        fallbackReason: 'Fully automatic wrapper command block.',
        verification: [buildPassedVerificationRecord()],
      } satisfies SmokeCommandResult;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runFullyAutomaticAutopilot', {
    phase,
    epic,
    nonInteractive: true,
    forceChatFallback: true,
  }));

  assert.ok(fullyAutomaticCommandResult, 'Expected the dedicated fully automatic command to return a result');
  assert.strictEqual(fullyAutomaticCommandResult.outcome, 'paused', 'Expected the dedicated fully automatic command to preserve fully automatic pause semantics');
  assert.match(fullyAutomaticCommandResult.reason ?? '', /Fully automatic wrapper command block/i, 'Expected the dedicated fully automatic command to surface the direct-path block reason');

  await vscode.workspace.getConfiguration('apexDelivery').update('autopilot.executionMode', 'agent-pause', vscode.ConfigurationTarget.Workspace);

  const autopilotAgentPause = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'workbench.action.chat.open' && isAgentChatOpenRequest(args[0])) {
      return undefined;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runGuidedAutopilot', {
    phase,
    epic,
    nonInteractive: true,
  }));

  assert.ok(autopilotAgentPause, 'Expected Guided Autopilot to return a result after launching Copilot agent mode');
  assert.strictEqual(autopilotAgentPause.outcome, 'paused', 'Expected Guided Autopilot to pause after submitting the agent prompt');
  assert.match(autopilotAgentPause.reason ?? '', /resume after the agent finishes updating the artifact/i, 'Expected Guided Autopilot to explain the manual resume requirement after agent launch');

  const artifactDocument = await vscode.workspace.openTextDocument(result.artifactPath);
  const artifactEditor = await vscode.window.showTextDocument(artifactDocument, { preview: false });
  await artifactEditor.edit((editBuilder) => {
    editBuilder.insert(new vscode.Position(0, 0), '<!-- manual intervention -->\n');
  });
  assert.strictEqual(artifactDocument.isDirty, true, 'Expected the artifact to be dirty before autopilot starts');

  const pausedAutopilot = await vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runGuidedAutopilot', {
    phase,
    epic,
    nonInteractive: true,
    forceChatFallback: true,
  });
  assert.ok(pausedAutopilot, 'Expected Guided Autopilot to return a result when it pauses');
  assert.strictEqual(pausedAutopilot.outcome, 'paused', 'Expected Guided Autopilot to pause when manual unsaved edits are detected');
  assert.match(pausedAutopilot.reason ?? '', /Unsaved changes/i, 'Expected Guided Autopilot to explain why it paused');

  await artifactDocument.save();

  const autopilotResult = await vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.resumeGuidedAutopilot', {
    phase,
    epic,
    nonInteractive: true,
    forceChatFallback: true,
  });
  assert.ok(autopilotResult, 'Expected Guided Autopilot resume to return a result');
  assert.strictEqual(autopilotResult.outcome, 'advanced', 'Expected Guided Autopilot to advance to the next non-autopilot phase');
  assert.strictEqual(autopilotResult.nextPhaseId, 'triage', 'Expected Guided Autopilot to stop on the next manual phase');

  const rescannedEpic = new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanEpic(epic.key);
  assert.strictEqual(findPhaseStatus(rescannedEpic, 'investigate')?.status, 'passed', 'Expected Guided Autopilot to pass the autopilot-enabled phase');
  assert.strictEqual(findPhaseStatus(rescannedEpic, 'triage')?.status, 'in_progress', 'Expected Guided Autopilot to advance the next phase to in progress');

  const existingEpicKeys = new Set(new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanAll().map((candidate) => candidate.key));
  await vscode.commands.executeCommand('apexDelivery.createSampleEpic', {
    nonInteractive: true,
    workflowId: 'investigate-workflow',
  });
  const fullyAutomaticEpic = await waitForNewEpic(workspaceRoot, existingEpicKeys);
  const fullyAutomaticPhase = fullyAutomaticEpic.phases[0];
  assert.ok(fullyAutomaticPhase, 'Expected the second sample epic to include an autopilot-enabled phase');

  await vscode.workspace.getConfiguration('apexDelivery').update('autopilot.executionMode', 'fully-automatic', vscode.ConfigurationTarget.Workspace);
  const fullyAutomaticAdvance = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'apexDelivery.runPhaseInCopilot') {
      const request = args[0] as { autopilotExecutionMode?: string } | undefined;
      assert.strictEqual(request?.autopilotExecutionMode, 'fully-automatic', 'Expected Guided Autopilot to propagate the fully automatic setting to phase execution');
      return {
        mode: 'direct',
        artifactPath: fullyAutomaticPhase.artifactPath,
        responseText: 'Direct success',
        verification: [buildPassedVerificationRecord()],
      } satisfies SmokeCommandResult;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runGuidedAutopilot', {
    phase: fullyAutomaticPhase,
    epic: fullyAutomaticEpic,
    nonInteractive: true,
  }));

  assert.ok(fullyAutomaticAdvance, 'Expected fully automatic Guided Autopilot to return a result for a successful direct run');
  assert.strictEqual(fullyAutomaticAdvance.outcome, 'advanced', 'Expected fully automatic Guided Autopilot to advance automatically after a successful direct result');
  assert.strictEqual(fullyAutomaticAdvance.nextPhaseId, 'triage', 'Expected fully automatic Guided Autopilot to stop at the next manual phase');
  const rescannedFullyAutomaticEpic = new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanEpic(fullyAutomaticEpic.key);
  assert.strictEqual(findPhaseStatus(rescannedFullyAutomaticEpic, 'investigate')?.status, 'passed', 'Expected fully automatic mode to mark the current phase as passed after a direct result');
  assert.strictEqual(findPhaseStatus(rescannedFullyAutomaticEpic, 'triage')?.status, 'in_progress', 'Expected fully automatic mode to advance the next phase to in progress');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  console.log(`APEX smoke test passed with mode: ${result.mode} (${result.chatLaunchResult ?? 'unknown'})`);
}

async function waitForEpic(workspaceRoot: string): Promise<EpicStatus> {
  const scanner = new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics');
  const timeout = Date.now() + 10_000;

  while (Date.now() < timeout) {
    const [epic] = scanner.scanAll();
    if (epic) {
      return epic;
    }
    await delay(200);
  }

  throw new Error('Timed out waiting for sample epic creation');
}

async function waitForNewEpic(workspaceRoot: string, existingKeys: ReadonlySet<string>): Promise<EpicStatus> {
  const scanner = new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics');
  const timeout = Date.now() + 10_000;

  while (Date.now() < timeout) {
    const epic = scanner.scanAll().find((candidate) => !existingKeys.has(candidate.key));
    if (epic) {
      return epic;
    }
    await delay(200);
  }

  throw new Error('Timed out waiting for the next sample epic creation');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedWorkspacePackageJson(workspaceRoot: string): void {
  fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
    name: 'apex-delivery-smoke-workspace',
    private: true,
    scripts: {
      compile: 'node -e "console.log(\'build ok\')"',
      'test:smoke': 'node -e "console.log(\'test ok\')"',
      lint: 'node -e "console.log(\'lint ok\')"',
    },
  }, null, 2));
}

function findPhaseStatus(epic: EpicStatus, phaseId: string): PhaseStatus | undefined {
  return epic.phases.find((candidate) => candidate.id === phaseId);
}

function buildPassedVerificationRecord(): NonNullable<SmokeCommandResult['verification']>[number] {
  return {
    kind: 'build',
    outcome: 'passed',
    command: 'compile',
    output: 'ok',
    durationMs: 1,
    source: 'test',
  };
}

type ExecuteCommandLike = (command: string, ...args: unknown[]) => Thenable<unknown>;
type SelectChatModelsLike = typeof vscode.lm.selectChatModels;

async function withExecuteCommandInterceptor<T>(
  interceptor: (command: string, args: readonly unknown[], next: ExecuteCommandLike) => Promise<unknown>,
  callback: () => Promise<T>,
): Promise<T> {
  const commandsApi = vscode.commands as unknown as { executeCommand: ExecuteCommandLike };
  const originalExecuteCommand = commandsApi.executeCommand.bind(vscode.commands);
  commandsApi.executeCommand = async (command: string, ...args: unknown[]): Promise<unknown> => interceptor(command, args, originalExecuteCommand);

  try {
    return await callback();
  } finally {
    commandsApi.executeCommand = originalExecuteCommand;
  }
}

async function withPatchedSelectChatModels<T>(
  selectChatModels: SelectChatModelsLike,
  callback: () => Promise<T>,
): Promise<T> {
  const languageModelApi = vscode.lm as unknown as { selectChatModels: SelectChatModelsLike };
  const originalSelectChatModels = languageModelApi.selectChatModels.bind(vscode.lm);
  languageModelApi.selectChatModels = selectChatModels;

  try {
    return await callback();
  } finally {
    languageModelApi.selectChatModels = originalSelectChatModels;
  }
}

function isAgentChatOpenRequest(value: unknown): value is {
  mode: 'agent';
  query?: string;
  isPartialQuery?: boolean;
  attachFiles?: readonly vscode.Uri[];
} {
  return typeof value === 'object'
    && value !== null
    && 'mode' in value
    && (value as { mode?: unknown }).mode === 'agent';
}