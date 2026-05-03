import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  PersistentApexSessionProvider,
  type ApexChatSessionTransport,
  WorkspaceApexSessionStore,
} from '../../apexSessionProvider';
import type { EpicStatus, PhaseStatus } from '../../pipelineModel';
import { PipelineScanner } from '../../pipelineScanner';
import {
  buildWorkflowEditorDraft,
  serializeWorkflowEditorDraft,
  validateWorkflowEditorDraft,
} from '../../workflowConfigModel';
import { buildWorkflowConfigPanelHtml } from '../../workflowConfigPanel';
import { parseWorkflowDefinitions } from '../../workflowModel';

interface SmokeCommandResult {
  mode: 'agent-chat' | 'direct' | 'chat-fallback' | 'blocked';
  artifactPath: string;
  sessionId?: string;
  transportId?: string;
  transportStability?: 'stable-public' | 'best-effort-command' | 'internal-unsupported' | 'not-configured';
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
    starterPrompt?: string;
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

  const invalidWorkflowDefinitions = parseWorkflowDefinitions({
    'invalid-session-defaults': {
      name: 'Invalid Session Defaults',
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Business Analyst',
          artifact: 'DISCOVERY.md',
          gate: 'Gate 1',
          output: 'Problem baseline captured',
          sessionDefaults: {
            autoSubmit: 'yes',
          },
        },
      ],
    },
  });
  assert.ok(
    invalidWorkflowDefinitions.errors.some((error) => /sessionDefaults\.autoSubmit/.test(error)),
    'AC6: Expected invalid workflow session defaults to surface a parser error.',
  );

  const invalidTemplateDefinitions = parseWorkflowDefinitions({
    'invalid-template-ref': {
      name: 'Invalid Template Ref',
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Business Analyst',
          artifact: 'DISCOVERY.md',
          gate: 'Gate 1',
          output: 'Problem baseline captured',
          templateRef: '../outside.md',
        },
      ],
    },
  });
  assert.ok(
    invalidTemplateDefinitions.errors.some((error) => /templateRef/.test(error)),
    'AC2: Expected invalid workflow templateRef values to surface a parser error.',
  );

  const builtWorkflowDraft = buildWorkflowEditorDraft(parseWorkflowDefinitions({
    'ui-workflow': {
      name: 'UI Workflow',
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Business Analyst',
          artifact: 'DISCOVERY.md',
          templateRef: 'docs/ai-delivery/templates/missing.md',
          gate: 'Gate 1',
          output: 'Problem baseline captured',
          autopilot: {
            enabled: true,
            retryLimit: 1,
          },
          sessionDefaults: {
            starterPrompt: 'Collect evidence first.',
          },
        },
      ],
    },
  }).workflows.filter((workflow) => workflow.source === 'workspace'));
  const workflowEditorIssues = validateWorkflowEditorDraft(
    builtWorkflowDraft,
    workspaceRoot,
    path.join(extension.extensionPath, 'templates', 'generic'),
  );
  assert.ok(
    workflowEditorIssues.some((issue) => issue.path.endsWith('.templateRef')),
    'AC5: Expected the workflow configuration model to reject unresolved template references before save.',
  );
  const uiWorkflowDraft = builtWorkflowDraft.workflows[0];
  assert.ok(uiWorkflowDraft, 'Expected the workflow editor draft builder to return the workspace workflow.');
  const uiWorkflowPhaseDraft = uiWorkflowDraft.phases[0];
  assert.ok(uiWorkflowPhaseDraft, 'Expected the workflow editor draft builder to return the first phase.');
  const serializedWorkflowDraft = serializeWorkflowEditorDraft({
    workflows: [
      {
        ...uiWorkflowDraft,
        phases: [
          {
            ...uiWorkflowPhaseDraft,
            templateMode: 'workspace',
            templateRef: 'docs/ai-delivery/templates/investigate-template.md',
          },
        ],
      },
    ],
  });
  const serializedPhase = ((serializedWorkflowDraft['ui-workflow'] as { phases: Array<Record<string, unknown>> }).phases[0]);
  assert.ok(serializedPhase, 'Expected serialized workflow draft to include the first phase.');
  assert.strictEqual(serializedPhase.templateRef, 'docs/ai-delivery/templates/investigate-template.md', 'AC6: Expected workflow UI serialization to preserve templateRef values.');
  assert.deepStrictEqual(serializedPhase.autopilot, { enabled: true, retryLimit: 1 }, 'AC6: Expected workflow UI serialization to preserve existing autopilot metadata.');
  const workflowConfigHtml = buildWorkflowConfigPanelHtml(
    { cspSource: 'vscode-webview-resource://test' },
    { workflows: [] },
    ['DESIGN.md', 'REVIEW.md'],
  );
  assert.ok(
    workflowConfigHtml.includes('split(String.fromCharCode(92)).join(\'/\')'),
    'Expected the workflow configuration webview script to use a safe backslash-normalization path inside the generated HTML.',
  );
  assert.ok(
    workflowConfigHtml.includes('No workspace workflows yet.'),
    'Expected the workflow configuration webview HTML to include the empty-state message.',
  );
  assert.ok(
    !workflowConfigHtml.includes('data-field="gate"'),
    'Expected the workflow configuration webview to hide gate editing because gate does not control runtime execution.',
  );
  assert.ok(
    workflowConfigHtml.includes('Run Defaults'),
    'Expected the workflow configuration webview to label runtime-applied run defaults clearly.',
  );
  assert.ok(
    workflowConfigHtml.includes('File Reference'),
    'Expected the workflow configuration webview to expose inline or file reference modes for longer text fields.',
  );

  const workflowTextRefPath = path.join(workspaceRoot, 'docs', 'ai-delivery', 'prompts', 'discover-output.md');
  const starterPromptRefPath = path.join(workspaceRoot, 'docs', 'ai-delivery', 'prompts', 'discover-starter.md');
  fs.mkdirSync(path.dirname(workflowTextRefPath), { recursive: true });
  fs.writeFileSync(workflowTextRefPath, 'Capture baseline, blockers, and ROI framing.', 'utf8');
  fs.writeFileSync(starterPromptRefPath, 'Ask for source-backed evidence before proposing edits.', 'utf8');

  const fileBackedDefinitions = parseWorkflowDefinitions({
    'file-backed-workflow': {
      name: 'File Backed Workflow',
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Business Analyst',
          artifact: 'DISCOVERY.md',
          gate: 'Gate 1',
          output: '',
          outputRef: 'docs/ai-delivery/prompts/discover-output.md',
          sessionDefaults: {
            starterPromptRef: 'docs/ai-delivery/prompts/discover-starter.md',
          },
        },
      ],
    },
  }, { workspaceRoot });
  assert.strictEqual(fileBackedDefinitions.errors.length, 0, 'Expected file-backed workflow definitions to parse without errors.');
  const fileBackedPhase = fileBackedDefinitions.workflows.find((workflow) => workflow.id === 'file-backed-workflow')?.phases[0];
  assert.ok(fileBackedPhase, 'Expected file-backed workflow phase to be present.');
  assert.strictEqual(fileBackedPhase?.output, 'Capture baseline, blockers, and ROI framing.', 'Expected outputRef to resolve file content during workspace workflow parsing.');
  assert.strictEqual(fileBackedPhase?.sessionDefaults?.starterPrompt, 'Ask for source-backed evidence before proposing edits.', 'Expected starterPromptRef to resolve file content during workspace workflow parsing.');

  const fileBackedDraft = buildWorkflowEditorDraft(fileBackedDefinitions.workflows.filter((workflow) => workflow.source === 'workspace'));
  const serializedFileBackedDraft = serializeWorkflowEditorDraft(fileBackedDraft);
  const serializedFileBackedPhase = (serializedFileBackedDraft['file-backed-workflow'] as { phases: Array<Record<string, unknown>> }).phases[0];
  assert.ok(serializedFileBackedPhase, 'Expected serialized file-backed workflow draft to include its first phase.');
  assert.strictEqual(serializedFileBackedPhase.outputRef, 'docs/ai-delivery/prompts/discover-output.md', 'Expected workflow UI serialization to preserve outputRef values.');
  assert.deepStrictEqual(
    serializedFileBackedPhase.sessionDefaults,
    {
      starterPromptRef: 'docs/ai-delivery/prompts/discover-starter.md',
      starterPrompt: 'Ask for source-backed evidence before proposing edits.',
    },
    'Expected workflow UI serialization to preserve starterPromptRef values with the cached file content.',
  );

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

  const workspaceTemplateRef = 'docs/ai-delivery/templates/investigate-template.md';
  const workspaceTemplatePath = path.join(workspaceRoot, ...workspaceTemplateRef.split('/'));
  fs.mkdirSync(path.dirname(workspaceTemplatePath), { recursive: true });
  fs.writeFileSync(
    workspaceTemplatePath,
    '# Investigate Custom Template\n\nEpic: {{EPIC_KEY}}\nOwner: {{OWNER}}\n',
    'utf8',
  );

  const configuredWorkflows = {
    'investigate-workflow': {
      name: 'Investigate Only',
      phases: [
        {
          id: 'investigate',
          name: 'Investigate',
          owner: 'Business Analyst',
          artifact: 'DISCOVER.md',
          templateRef: workspaceTemplateRef,
          gate: 'Gate 1',
          output: 'Problem baseline captured',
          sessionDefaults: {
            autoSubmit: false,
            agentTag: '#workflow-investigate',
            preferredChatAgent: 'Workflow Analyst',
            modelFamily: 'gpt-4.1',
            starterPrompt: 'Ask for source evidence before proposing artifact changes.',
          },
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
  };

  await vscode.workspace.getConfiguration('apexDelivery').update('workflowDefinitions', configuredWorkflows, vscode.ConfigurationTarget.Workspace);

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
  assert.strictEqual(phase.sessionDefaults?.agentTag, '#workflow-investigate', 'AC1: Expected the snapshotted epic phase to retain workflow session defaults.');
  assert.strictEqual(phase.sessionDefaults?.starterPrompt, 'Ask for source evidence before proposing artifact changes.', 'AC1: Expected the workflow starter prompt to be preserved in the epic snapshot.');
  assert.strictEqual(phase.templateRef, workspaceTemplateRef, 'AC3: Expected the snapshotted epic phase to retain the configured templateRef.');
  assert.match(
    fs.readFileSync(phase.artifactPath, 'utf8'),
    /Investigate Custom Template[\s\S]*Epic:\s+APEX-/,
    'AC3: Expected sample epic seeding to use the configured workspace templateRef rather than the artifact filename.',
  );

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

  const existingEpicKeys = new Set(new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanAll().map((candidate) => candidate.key));
  await vscode.workspace.getConfiguration('apexDelivery').update('workflowDefinitions', {
    ...configuredWorkflows,
    'snapshot-fallback-workflow': {
      name: 'Snapshot Fallback Workflow',
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Product / Business',
          artifact: 'DISCOVERY.md',
          gate: 'Gate 3',
          output: 'Business problem captured',
        },
        {
          id: 'triage',
          name: 'Triage',
          owner: 'Code Reviewer',
          artifact: 'REVIEW.md',
          gate: 'Gate 2',
          output: 'Risk summary captured',
        },
      ],
    },
  }, vscode.ConfigurationTarget.Workspace);

  await vscode.commands.executeCommand('apexDelivery.createSampleEpic', {
    nonInteractive: true,
    workflowId: 'snapshot-fallback-workflow',
  });
  const staleAutopilotEpic = await waitForNewEpic(workspaceRoot, existingEpicKeys);
  const staleAutopilotPhase = staleAutopilotEpic.phases[0];
  assert.ok(staleAutopilotPhase, 'Expected the stale snapshot epic to include a first phase');
  assert.strictEqual(staleAutopilotPhase?.autopilot, undefined, 'Expected the stale epic snapshot to omit autopilot metadata before the workspace workflow is updated');

  await vscode.workspace.getConfiguration('apexDelivery').update('workflowDefinitions', {
    ...configuredWorkflows,
    'snapshot-fallback-workflow': {
      name: 'Snapshot Fallback Workflow',
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Product / Business',
          artifact: 'DISCOVERY.md',
          gate: 'Gate 3',
          output: 'Business problem captured',
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
      ],
    },
  }, vscode.ConfigurationTarget.Workspace);

  const snapshotFallbackAdvance = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'apexDelivery.runPhaseInCopilot') {
      const request = args[0] as {
        phase?: PhaseStatus;
        epic?: EpicStatus;
      } | undefined;
      assert.strictEqual(request?.epic?.key, staleAutopilotEpic.key, 'Expected the stale snapshot fallback test to target the second epic');
      assert.strictEqual(request?.phase?.id, staleAutopilotPhase?.id, 'Expected the stale snapshot fallback test to run the first phase');
      return {
        mode: 'direct',
        artifactPath: staleAutopilotPhase?.artifactPath ?? path.join(staleAutopilotEpic.folderPath, 'DISCOVERY.md'),
        responseText: 'Fallback success',
        verification: [buildPassedVerificationRecord()],
      } satisfies SmokeCommandResult;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<GuidedAutopilotResult>('apexDelivery.runGuidedAutopilot', {
    phase: staleAutopilotPhase,
    epic: staleAutopilotEpic,
    nonInteractive: true,
    forceChatFallback: true,
  }));

  assert.ok(snapshotFallbackAdvance, 'Expected Guided Autopilot to return a result for the stale snapshot fallback scenario');
  assert.strictEqual(snapshotFallbackAdvance.outcome, 'advanced', 'Expected Guided Autopilot to fall back to the current workflow definition when the epic snapshot lacks autopilot metadata');
  assert.strictEqual(snapshotFallbackAdvance.nextPhaseId, 'triage', 'Expected Guided Autopilot to advance to the next manual phase after fallback');
  const rescannedFallbackEpic = new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanEpic(staleAutopilotEpic.key);
  assert.strictEqual(findPhaseStatus(rescannedFallbackEpic, 'discover')?.status, 'passed', 'Expected fallback autopilot execution to pass the stale snapshot phase');
  assert.strictEqual(findPhaseStatus(rescannedFallbackEpic, 'triage')?.status, 'in_progress', 'Expected fallback autopilot execution to advance the next phase');

  const sameEpicLaterPhase = epic.phases[1];
  assert.ok(sameEpicLaterPhase, 'Expected the sample epic to include a follow-up phase for epic-scoped chat session reuse');

  const testSessionStore = new WorkspaceApexSessionStore(createInMemoryMemento());
  const testSessionProvider = new PersistentApexSessionProvider(testSessionStore, (candidateEpic) => `${candidateEpic.key}-provider-session`);
  const testTransport: ApexChatSessionTransport = {
    id: 'best-effort-native-chat',
    stability: 'best-effort-command',
    supportsExactSessionTargeting: false,
    openAsk: async () => 'opened',
    openAgent: async () => 'submitted',
  };
  const firstSessionRecord = await testSessionProvider.getOrCreate(epic, phase);
  assert.strictEqual(firstSessionRecord.sessionId, `${epic.key}-provider-session`, 'Expected the provider to allocate a deterministic session id for the epic');
  const boundTransportRecord = await testSessionProvider.bindTransport(firstSessionRecord.sessionId, testTransport, {
    launchMode: 'ask',
    resource: 'vscode-chat-session://local/test-provider-session',
  });
  assert.strictEqual(boundTransportRecord?.transportId, 'best-effort-native-chat', 'Expected the provider to persist transport metadata on the session record');
  assert.strictEqual(boundTransportRecord?.transportStability, 'best-effort-command', 'Expected the provider to persist transport stability on the session record');
  const reboundPhaseRecord = await testSessionProvider.bindPhase(firstSessionRecord.sessionId, sameEpicLaterPhase);
  assert.strictEqual(reboundPhaseRecord?.sessionId, firstSessionRecord.sessionId, 'Expected later phases of the same epic to keep the same provider-owned session id');
  assert.strictEqual(reboundPhaseRecord?.currentPhaseId, sameEpicLaterPhase.id, 'Expected phase rebinding to update the current phase metadata on the session record');

  const scopedSessionLaunches: Array<{ command: string; resource: string }> = [];
  const scopedChatRequests: Array<{ mode?: string; query?: string }> = [];
  await withExecuteCommandInterceptor(async (command, args, next) => {
    if ((command === 'workbench.action.chat.openSessionInNewEditorGroup' || command === 'workbench.action.chat.openSessionInEditorGroup') && isChatSessionOpenRequest(args[0])) {
      scopedSessionLaunches.push({ command, resource: args[0].resource.toString() });
      return undefined;
    }

    if (command === 'workbench.action.chat.open' && isAskChatOpenRequest(args[0])) {
      scopedChatRequests.push({ mode: args[0].mode, query: args[0].query });
      return undefined;
    }

    return next(command, ...args);
  }, async () => {
    await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase,
      epic,
      nonInteractive: true,
      forceChatFallback: true,
    });
    await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase: sameEpicLaterPhase,
      epic,
      nonInteractive: true,
      forceChatFallback: true,
    });
    await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase: staleAutopilotPhase,
      epic: staleAutopilotEpic,
      nonInteractive: true,
      forceChatFallback: true,
    });
  });

  assert.strictEqual(scopedSessionLaunches.length, 3, 'Expected each fallback run to open or reveal an epic-scoped native chat session before sending the prompt');
  assert.strictEqual(scopedChatRequests.length, 3, 'Expected each fallback run to submit one ask-mode Copilot chat request');
  const firstScopedSessionUri = vscode.Uri.parse(scopedSessionLaunches[0]?.resource ?? '');
  const secondScopedSessionUri = vscode.Uri.parse(scopedSessionLaunches[1]?.resource ?? '');
  const thirdScopedSessionUri = vscode.Uri.parse(scopedSessionLaunches[2]?.resource ?? '');
  assert.strictEqual(firstScopedSessionUri.scheme, 'vscode-chat-session', 'Expected the scoped chat session URI to use the native chat-session scheme');
  assert.strictEqual(firstScopedSessionUri.authority, 'local', 'Expected the scoped chat session URI to target the native local chat authority');
  assert.strictEqual(decodeScopedSessionResource(firstScopedSessionUri), decodeScopedSessionResource(secondScopedSessionUri), 'Expected different phases of the same epic to resolve to the same decoded native session id');
  assert.ok(decodeScopedSessionResource(firstScopedSessionUri).startsWith(`${epic.key}-`), 'Expected the decoded native session id to remain epic-scoped');
  assert.ok(decodeScopedSessionResource(thirdScopedSessionUri).startsWith(`${staleAutopilotEpic.key}-`), 'Expected the decoded native session id for the second epic to stay scoped to that epic');
  assert.strictEqual(scopedSessionLaunches[0]?.resource, scopedSessionLaunches[1]?.resource, 'Expected different phases of the same epic to reuse the same native chat session');
  assert.notStrictEqual(scopedSessionLaunches[0]?.resource, scopedSessionLaunches[2]?.resource, 'Expected a different epic to use a different native chat session');
  assert.ok(scopedChatRequests[0]?.query?.includes(epic.key), 'Expected the first scoped chat request to target the first epic');
  assert.ok(scopedChatRequests[1]?.query?.includes(epic.key), 'Expected the second scoped chat request to keep targeting the same epic');
  assert.ok(scopedChatRequests[2]?.query?.includes(staleAutopilotEpic.key), 'Expected the third scoped chat request to target the second epic');

  await vscode.workspace.getConfiguration('apexDelivery').update('userRole', 'Developer', vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('apexDelivery').update('runPhase.rolePolicies', {
    Developer: {
      preferredChatAgent: 'Code Reviewer',
      modelFamily: 'gpt-4o',
      autoSubmit: false,
      agentTag: '#role-default',
      starterPrompt: 'Role default starter prompt.',
    },
  }, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('apexDelivery').update('runPhase.phaseProfiles', {
    [epic.workflowId]: {
      [phase.id]: {
        preferredChatAgent: 'Business Analyst',
        autoSubmit: true,
        starterPrompt: 'Profile override starter prompt.',
      },
    },
  }, vscode.ConfigurationTarget.Workspace);

  const fallbackLaunches: Array<{ command: string; args: readonly unknown[] }> = [];
  const result = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'workbench.action.chat.open' && isAskChatOpenRequest(args[0])) {
      fallbackLaunches.push({ command, args });
      return undefined;
    }
    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
    phase,
    epic,
    nonInteractive: true,
    forceChatFallback: true,
  }));

  assert.ok(result, 'Expected the phase command to return a smoke-test result');
  assert.ok(fs.existsSync(result.artifactPath), 'Expected the phase artifact to exist after the run');
  assert.ok(result.mode === 'direct' || result.mode === 'chat-fallback', 'Expected a valid execution mode');
  assert.match(
    fs.readFileSync(result.artifactPath, 'utf8'),
    /## Verification Evidence/i,
    'Expected the phase artifact to include the verification evidence section after the run',
  );

  assert.strictEqual(result.mode, 'chat-fallback', 'Expected the smoke test to exercise the Copilot Chat fallback path');
  assert.ok(typeof result.sessionId === 'string' && result.sessionId.startsWith(`${epic.key}-`), 'Expected fallback execution to return the epic-scoped session id');
  assert.strictEqual(result.transportId, 'best-effort-native-chat', 'Expected fallback execution to report the best-effort chat transport id');
  assert.strictEqual(result.transportStability, 'best-effort-command', 'Expected fallback execution to report best-effort transport stability');
  assert.ok(typeof result.chatStarter === 'string' && result.chatStarter.includes('APEX_SESSION='), 'Expected fallback execution to prepare an epic-scoped chat starter');
  assert.ok(typeof result.chatStarter === 'string' && !result.chatStarter.includes('@apex'), 'Expected fallback execution to avoid depending on the @apex participant');
  assert.strictEqual(result.chatLaunchResult, 'prefilled', 'Expected fallback execution to open Copilot Chat with the scoped prompt prefilled but not submitted');
  assert.strictEqual(result.runPreferences?.preferredChatAgent, 'Business Analyst', 'AC2: Expected explicit phase profile overrides to win over workflow and role defaults.');
  assert.strictEqual(result.runPreferences?.agentTag, '#workflow-investigate', 'AC2: Expected workflow defaults to win over role defaults when no explicit phase profile agentTag override exists.');
  assert.strictEqual(result.runPreferences?.modelFamily, 'gpt-4.1', 'AC2: Expected workflow defaults to win over role defaults for model family.');
  assert.strictEqual(result.runPreferences?.starterPrompt, 'Profile override starter prompt.', 'AC2: Expected explicit phase profile starter prompts to win over workflow and role defaults.');
  assert.strictEqual(result.rolePolicyResolution?.status, 'mismatched', 'Expected the current user role to mismatch the phase owner');
  assert.strictEqual(result.rolePolicyResolution?.userRole, 'Developer', 'Expected the role-aware resolver to record the configured user role');
  assert.strictEqual(result.rolePolicyResolution?.preferredRole, 'Business Analyst', 'Expected the role-aware resolver to record the preferred phase role');
  assert.match(
    result.fallbackReason ?? '',
    /prefilled via public command integration/i,
    'Expected fallback execution to report public Copilot Chat prefill integration',
  );
  assert.ok(fallbackLaunches.length > 0, 'Expected fallback execution to invoke the ask-mode Copilot chat launch command');
  const [fallbackLaunch] = fallbackLaunches;
  assert.ok(fallbackLaunch, 'Expected to capture the fallback Copilot chat payload');
  const fallbackRequest = fallbackLaunch.args[0] as {
    mode?: string;
    query?: string;
    isPartialQuery?: boolean;
    attachFiles?: readonly vscode.Uri[];
  };
  assert.strictEqual(fallbackRequest.mode, 'ask', 'Expected the fallback Copilot chat command to open in ask mode');
  assert.ok(typeof fallbackRequest.query === 'string' && fallbackRequest.query.includes('APEX_SESSION='), 'Expected the fallback prompt to include the epic session marker');
  assert.ok(typeof fallbackRequest.query === 'string' && fallbackRequest.query.includes(epic.key), 'Expected the fallback prompt to mention the current epic key');
  assert.ok(typeof fallbackRequest.query === 'string' && !fallbackRequest.query.includes('@apex'), 'Expected the fallback prompt payload to avoid the @apex participant');
  assert.ok(typeof fallbackRequest.query === 'string' && fallbackRequest.query.includes('Preferred GitHub Copilot Chat agent: Business Analyst.'), 'AC3: Expected public Chat launches to carry the preferred agent as a best-effort hint.');
  assert.ok(typeof fallbackRequest.query === 'string' && fallbackRequest.query.includes('#workflow-investigate'), 'AC2: Expected workflow-scoped agentTag defaults to flow into the scoped fallback prompt.');
  assert.ok(typeof fallbackRequest.query === 'string' && fallbackRequest.query.includes('Preferred model family hint: gpt-4.1.'), 'AC3: Expected public Chat launches to surface model preference only as a best-effort hint.');
  assert.ok(typeof fallbackRequest.query === 'string' && fallbackRequest.query.includes('Profile override starter prompt.'), 'AC5: Expected workflow-scoped starter prompt content to be included in the chat handoff.');
  assert.strictEqual(fallbackRequest.isPartialQuery, true, 'Expected the fallback Copilot chat launch to prefill rather than auto-submit');
  assert.ok(Array.isArray(fallbackRequest.attachFiles) && fallbackRequest.attachFiles.length >= 3, 'Expected ask-mode fallback to attach the phase artifact, epic brief, and status file');

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
  assert.ok(typeof agentModeResult.sessionId === 'string' && agentModeResult.sessionId.startsWith(`${epic.key}-`), 'Expected agent-mode execution to return the epic-scoped session id');
  assert.strictEqual(agentModeResult.transportId, 'best-effort-native-chat', 'Expected agent-mode execution to report the best-effort chat transport id');
  assert.strictEqual(agentModeResult.transportStability, 'best-effort-command', 'Expected agent-mode execution to report best-effort transport stability');
  assert.strictEqual(agentModeResult.chatLaunchResult, 'submitted', 'Expected agent mode to submit immediately when autoSubmit is enabled');
  assert.strictEqual(agentModeResult.runPreferences?.starterPrompt, 'Profile override starter prompt.', 'AC2: Expected agent-mode execution to keep the resolved starter prompt in run preferences.');
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
  assert.ok(typeof agentRequest.query === 'string' && agentRequest.query.includes('Preferred model family hint: gpt-4.1.'), 'AC3: Expected agent-mode launches to surface model preference as a best-effort hint only.');
  assert.ok(typeof agentRequest.query === 'string' && agentRequest.query.includes('Profile override starter prompt.'), 'AC5: Expected workflow starter prompt content to be included in the agent-mode launch prompt.');
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
  assert.ok(typeof fullyAutomaticBlockedResult.sessionId === 'string' && fullyAutomaticBlockedResult.sessionId.startsWith(`${epic.key}-`), 'Expected fully automatic blocked results to keep the epic-scoped session id');
  assert.strictEqual(fullyAutomaticBlockedResult.transportId, 'copilot-language-model', 'Expected fully automatic blocked results to report the direct-model transport id');
  assert.strictEqual(fullyAutomaticBlockedResult.transportStability, 'stable-public', 'Expected fully automatic blocked results to report stable-public transport stability');
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

  const currentEpicKeys = new Set(new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanAll().map((candidate) => candidate.key));
  await vscode.commands.executeCommand('apexDelivery.createSampleEpic', {
    nonInteractive: true,
    workflowId: 'investigate-workflow',
  });
  const fullyAutomaticEpic = await waitForNewEpic(workspaceRoot, currentEpicKeys);
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

function isAskChatOpenRequest(value: unknown): value is {
  mode: 'ask';
  query?: string;
  isPartialQuery?: boolean;
  attachFiles?: readonly vscode.Uri[];
} {
  return typeof value === 'object'
    && value !== null
    && 'mode' in value
    && (value as { mode?: unknown }).mode === 'ask';
}

function isChatSessionOpenRequest(value: unknown): value is {
  resource: vscode.Uri;
} {
  const resource = typeof value === 'object' && value !== null
    ? (value as { resource?: unknown }).resource
    : undefined;

  return typeof value === 'object'
    && value !== null
    && 'resource' in value
    && typeof resource === 'object'
    && resource !== null
    && 'scheme' in resource
    && 'path' in resource;
}

function decodeScopedSessionResource(resource: vscode.Uri): string {
  return Buffer.from(resource.path.replace(/^\//, ''), 'base64url').toString('utf8');
}

function createInMemoryMemento(): vscode.Memento {
  const state = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return state.has(key) ? state.get(key) as T : defaultValue as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) {
        state.delete(key);
      } else {
        state.set(key, value);
      }
      return Promise.resolve();
    },
    keys(): readonly string[] {
      return [...state.keys()];
    },
  } as vscode.Memento;
}