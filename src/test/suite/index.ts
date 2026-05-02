import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { EpicStatus, PhaseStatus } from '../../pipelineModel';
import { PipelineScanner } from '../../pipelineScanner';

interface SmokeCommandResult {
  mode: 'direct' | 'chat-fallback';
  artifactPath: string;
  modelLabel?: string;
  responseText?: string;
  fallbackReason?: string;
  chatStarter?: string;
  chatLaunchResult?: 'prefilled' | 'opened' | 'unavailable';
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