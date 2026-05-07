import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  createDefaultCoordinationMetadata,
  parseCoordinationMetadata,
  readCoordinationMetadata,
  withPullRequestBinding,
  withBranchBinding,
  writeCoordinationMetadata,
} from '../../coordinationModel';
import {
  PersistentApexSessionProvider,
  type ApexChatSessionTransport,
  WorkspaceApexSessionStore,
} from '../../apexSessionProvider';
import type { EpicStatus, PhaseStatus } from '../../pipelineModel';
import { PipelineScanner } from '../../pipelineScanner';
import {
  buildWorkflowEditorDraft,
  buildWorkflowPresetDrafts,
  serializeWorkflowEditorDraft,
  validateWorkflowEditorDraft,
} from '../../workflowConfigModel';
import { buildWorkflowConfigPanelHtml } from '../../workflowConfigPanel';
import { buildCopilotCliHandoff, computePbiReviewScore } from '../../pbiWorkflow';
import {
  getBuiltInWorkflowDefinitions,
  parseWorkflowDefinitions,
} from '../../workflowModel';
import { runSessionRoutingSmokeSuite } from './sessionRouting.test';
import { runWorktreePoolSmokeSuite } from './worktreePool.test';

interface SmokeCommandResult {
  mode: 'agent-chat' | 'direct' | 'chat-fallback' | 'cli-handoff' | 'blocked';
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
}

interface PortfolioDashboardResult {
  entries: Array<{
    epic: {
      key: string;
    };
    worktreeSignal?: {
      worktreePath: string;
      dirtyFiles: number;
    };
    missingBranchLink: boolean;
  }>;
  summary: {
    activeEpics: number;
    blockedEpics: number;
    awaitingReview: number;
    openPullRequests: number;
    localWorktrees: number;
    missingBranchLinks: number;
  };
  indexState: 'available' | 'missing' | 'invalid';
}

interface ReviewPullRequestCommandResult {
  mode: 'linked-epic' | 'unlinked' | 'blocked';
  artifactPath?: string;
  reviewArtifactPath?: string;
  reviewContextPath?: string;
  linkedEpicKey?: string;
  changedFiles: string[];
  prNumber?: number;
  executionWorkspacePath?: string;
  blockedReason?: string;
}

interface OpenLinkedBranchWorktreeCommandResult {
  epicKey: string;
  branchName: string;
  worktreePath: string;
  created: boolean;
  openedInNewWindow: boolean;
}

export async function run(): Promise<void> {
  runSessionRoutingSmokeSuite();

  const extension = vscode.extensions.getExtension('vndkubi.apex-delivery-pipeline-v1');
  assert.ok(extension, 'Expected APEX extension to be present in the extension host');
  await extension.activate();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, 'Expected smoke test workspace to be open');
  seedWorkspacePackageJson(workspaceRoot);
  initializeGitRepository(workspaceRoot);

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

  const invalidExecutionDefinitions = parseWorkflowDefinitions({
    'invalid-execution-policy': {
      name: 'Invalid Execution Policy',
      execution: {
        mode: 'auto',
      },
      phases: [
        {
          id: 'discover',
          name: 'Discover',
          owner: 'Business Analyst',
          artifact: 'DISCOVERY.md',
          gate: 'Gate 1',
          output: 'Problem baseline captured',
        },
      ],
    },
  });
  assert.ok(
    invalidExecutionDefinitions.errors.some((error) => /execution\.mode/.test(error)),
    'AC2: Expected invalid workflow execution policy values to surface a parser error.',
  );

  const builtInWorkflows = getBuiltInWorkflowDefinitions();
  assert.ok(
    builtInWorkflows.some((workflow) => workflow.id === 'pbi-delivery'),
    'Expected the built-in workflow set to include the PBI Delivery preset.',
  );
  const pbiPresetDraft = buildWorkflowPresetDrafts()[0];
  assert.ok(pbiPresetDraft, 'Expected a workflow editor preset draft for PBI Delivery.');
  assert.strictEqual(pbiPresetDraft?.phases[0]?.artifact, 'PBI.md', 'Expected the PBI Delivery preset draft to start with the intake artifact.');

  const builtWorkflowDraft = buildWorkflowEditorDraft(parseWorkflowDefinitions({
    'ui-workflow': {
      name: 'UI Workflow',
      execution: {
        mode: 'pooled',
        commands: {
          runPhase: 'control',
          reviewPullRequest: 'pooled',
          openWorkspace: 'pinned',
        },
      },
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
  assert.deepStrictEqual(
    uiWorkflowDraft.execution,
    {
      configured: true,
      mode: 'control',
      commands: {
        runPhase: 'control',
        reviewPullRequest: 'control',
        openWorkspace: 'pinned',
      },
    },
    'AC2: Expected the workflow editor draft builder to normalize deprecated pooled execution values to supported editor routing modes.',
  );
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
  const serializedUiWorkflow = (serializedWorkflowDraft['ui-workflow'] as { execution?: Record<string, unknown>; phases: Array<Record<string, unknown>> });
  const serializedPhase = serializedUiWorkflow.phases[0];
  assert.ok(serializedPhase, 'Expected serialized workflow draft to include the first phase.');
  assert.deepStrictEqual(
    serializedUiWorkflow.execution,
    {
      mode: 'control',
      commands: {
        runPhase: 'control',
        reviewPullRequest: 'control',
        openWorkspace: 'pinned',
      },
    },
    'AC2: Expected workflow UI serialization to persist only supported editor routing modes.',
  );
  assert.strictEqual(serializedPhase.templateRef, 'docs/ai-delivery/templates/investigate-template.md', 'AC6: Expected workflow UI serialization to preserve templateRef values.');
  assert.deepStrictEqual(serializedPhase.autopilot, { enabled: true, retryLimit: 1 }, 'AC6: Expected workflow UI serialization to preserve existing autopilot metadata.');
  const workflowConfigHtml = buildWorkflowConfigPanelHtml(
    { cspSource: 'vscode-webview-resource://test' },
    { workflows: [] },
    ['DESIGN.md', 'REVIEW.md'],
    'C:/workspace',
  );
  assert.ok(
    workflowConfigHtml.includes('split(String.fromCharCode(92)).join(\'/\')'),
    'Expected the workflow configuration webview script to use a safe backslash-normalization path inside the generated HTML.',
  );
  assert.ok(
    workflowConfigHtml.includes('/^[a-zA-Z]:\\//.test(value)'),
    'AC1: Expected the workflow configuration webview script to preserve the absolute-path regex escape sequence in the emitted HTML.',
  );
  const workflowConfigScripts = [...workflowConfigHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(workflowConfigScripts.length > 0, 'AC1: Expected the workflow configuration webview HTML to include an inline script.');
  const workflowConfigScript = workflowConfigScripts[workflowConfigScripts.length - 1]?.[1] ?? '';
  assert.doesNotThrow(
    () => new Function(workflowConfigScript),
    'AC1: Expected the workflow configuration webview script to stay syntactically valid so Add Workflow can initialize.',
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
  const workflowConfigHtmlWithExecution = buildWorkflowConfigPanelHtml(
    { cspSource: 'vscode-webview-resource://test' },
    builtWorkflowDraft,
    ['DESIGN.md', 'REVIEW.md'],
    'C:/workspace',
  );
  assert.ok(
    workflowConfigHtmlWithExecution.includes('Workspace Routing'),
    'AC4: Expected the workflow configuration webview to expose a workspace routing section.',
  );
  assert.ok(
    workflowConfigHtmlWithExecution.includes('Review Pull Request Execution'),
    'AC4: Expected the workflow configuration webview to expose Review Pull Request execution policy controls.',
  );
  assert.ok(
    !workflowConfigHtmlWithExecution.includes('Managed Pool'),
    'AC4: Expected the workflow configuration webview to stop exposing deprecated Managed Pool routing in the editor.',
  );
  assert.ok(
    !workflowConfigHtmlWithExecution.includes('Model Family'),
    'AC4: Expected the workflow configuration webview to stop exposing deprecated model family inputs for chat-first workflows.',
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

  const invalidCoordinationMetadata = parseCoordinationMetadata({
    schemaVersion: 1,
    epicKey: 'APEX-1000',
    branches: [
      {
        role: 'implementation',
      },
    ],
  }, 'coordination metadata');
  assert.ok(
    typeof invalidCoordinationMetadata.error === 'string' && /non-empty name/.test(invalidCoordinationMetadata.error),
    'AC-1: Expected coordination metadata parsing to reject branch bindings without an explicit branch name.',
  );

  const parsedCoordinationMetadata = parseCoordinationMetadata({
    schemaVersion: 1,
    epicKey: 'APEX-1000',
    branches: [
      {
        name: 'feat/checkout-redesign',
        role: 'implementation',
        worktreePath: '../repo-checkout-redesign',
      },
    ],
  }, 'coordination metadata');
  assert.ok(parsedCoordinationMetadata.metadata, 'Expected coordination metadata to parse when branch bindings are explicit.');
  assert.strictEqual(parsedCoordinationMetadata.metadata?.branches[0]?.name, 'feat/checkout-redesign', 'Expected coordination metadata parsing to preserve the explicit branch binding name.');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(parsedCoordinationMetadata.metadata?.branches[0] ?? {}, 'worktreePath'),
    'AC-5: Expected machine-local branch fields to be stripped from repo-owned coordination metadata.',
  );

  const linkedCoordinationMetadata = withBranchBinding(
    createDefaultCoordinationMetadata('APEX-1000'),
    {
      name: 'feat/checkout-redesign',
      role: 'implementation',
      createdByApex: false,
      linkedAt: '2026-05-03T09:00:00Z',
    },
  );
  const relinkedCoordinationMetadata = withBranchBinding(linkedCoordinationMetadata, {
    name: 'feat/checkout-redesign',
    role: 'review',
    createdByApex: false,
  });
  assert.strictEqual(relinkedCoordinationMetadata.branches.length, 1, 'AC-4: Expected the same branch to keep a single explicit binding when relinked.');
  assert.strictEqual(relinkedCoordinationMetadata.branches[0]?.role, 'review', 'AC-4: Expected relinking the same branch to replace the existing binding instead of duplicating it.');

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

  runWorktreePoolSmokeSuite(workspaceRoot);

  const integratedFlow = await vscode.commands.executeCommand<IntegratedFlowCommandResult>('apexDelivery.startIntegratedFlow', {
    nonInteractive: true,
    openSpec: true,
  });
  assert.ok(integratedFlow, 'Expected the integrated delivery flow to return a result');
  assert.ok(fs.existsSync(integratedFlow.specFilePath), 'Expected integrated delivery flow to create spec.md');
  assert.ok(fs.existsSync(integratedFlow.copilotInstructionsPath), 'Expected integrated delivery flow to create the Copilot bootstrap pack');
  const generatedTddPromptPath = path.join(workspaceRoot, '.github', 'prompts', 'apex-tdd-epic.prompt.md');
  const generatedTddInstructionsPath = path.join(workspaceRoot, '.github', 'instructions', 'apex-tdd-micro-commit.instructions.md');
  const generatedTddAgentPath = path.join(workspaceRoot, '.github', 'agents', 'apex-tdd-epic-executor.agent.md');
  assert.ok(fs.existsSync(generatedTddPromptPath), 'AC6: Expected the Copilot bootstrap pack to create a reusable TDD epic prompt.');
  assert.ok(fs.existsSync(generatedTddInstructionsPath), 'AC6: Expected the Copilot bootstrap pack to create scoped TDD instructions.');
  assert.ok(fs.existsSync(generatedTddAgentPath), 'AC6: Expected the Copilot bootstrap pack to create a TDD epic executor agent.');
  const generatedCopilotInstructions = fs.readFileSync(integratedFlow.copilotInstructionsPath, 'utf8');
  assert.ok(!generatedCopilotInstructions.includes('VI:'), 'AC6: Expected generated Copilot instructions to use English only.');
  const generatedTddInstructions = fs.readFileSync(generatedTddInstructionsPath, 'utf8');
  assert.ok(/applyTo:\s+"\*\*\/\*\.{/.test(generatedTddInstructions), 'AC6: Expected generated TDD instructions to target multi-language source files rather than a single language tree.');
  assert.ok(generatedTddInstructions.includes('py'), 'AC6: Expected generated TDD instructions to mention at least one non-TypeScript language extension.');
  const generatedTddAgent = fs.readFileSync(generatedTddAgentPath, 'utf8');
  assert.ok(generatedTddAgent.includes('TDD Epic Executor'), 'AC6: Expected the generated TDD agent to expose a dedicated executor identity.');
  assert.strictEqual(
    vscode.window.activeTextEditor?.document.uri.fsPath,
    integratedFlow.specFilePath,
    'Expected the quick-start flow to open spec.md automatically',
  );

  const initialPbiKeys = new Set(new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanAll().map((candidate) => candidate.key));
  await vscode.commands.executeCommand('apexDelivery.createPbiDelivery', {
    title: 'Daily PBI Smoke',
    text: 'As a reviewer, I need a PBI-aware review artifact so that daily technical review stays tied to requirements.',
    source: 'jira',
  });
  const pbiEpic = await waitForNewEpic(workspaceRoot, initialPbiKeys);
  assert.strictEqual(pbiEpic.workflowId, 'pbi-delivery', 'Expected Create PBI Delivery to use the built-in PBI workflow.');
  assert.ok(fs.existsSync(path.join(pbiEpic.folderPath, 'PBI.md')), 'Expected Create PBI Delivery to seed PBI.md.');
  assert.match(
    fs.readFileSync(path.join(pbiEpic.folderPath, 'PBI.md'), 'utf8'),
    /PBI-aware review artifact/i,
    'Expected imported PBI text to be written into PBI.md.',
  );
  const pbiReviewScore = computePbiReviewScore(pbiEpic);
  assert.ok(pbiReviewScore.score > 0, 'Expected PBI review scoring to produce a non-zero readiness score for a seeded epic.');
  const previewHandoff = buildCopilotCliHandoff(workspaceRoot, pbiEpic, pbiEpic.phases[0]!, 'Prompt preview');
  assert.match(previewHandoff.command, /^copilot -p "@docs\/ai-delivery\/epics\/APEX-\d+\/handoffs\/copilot-cli\/intake\.prompt\.md"$/, 'Expected Copilot CLI handoff commands to point at the epic-relative prompt file.');
  assert.ok(fs.existsSync(previewHandoff.promptPath), 'Expected the direct Copilot CLI handoff helper to write the prompt file.');

  await vscode.workspace.getConfiguration('apexDelivery').update('copilot.provider', 'copilotCliPrompt', vscode.ConfigurationTarget.Workspace);
  const pbiCliResult = await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
    epic: pbiEpic,
    phase: pbiEpic.phases[0],
    nonInteractive: true,
  });
  assert.ok(pbiCliResult, 'Expected Run Phase with Copilot to return a result for PBI CLI handoff mode.');
  assert.strictEqual(pbiCliResult?.mode, 'cli-handoff', 'Expected the Copilot provider switch to generate a CLI handoff instead of launching VS Code Copilot.');
  assert.ok(pbiCliResult?.handoffPath && fs.existsSync(pbiCliResult.handoffPath), 'Expected the CLI handoff result to return a prompt path that exists on disk.');
  assert.match(pbiCliResult?.handoffCommand ?? '', /^copilot -p "@docs\/ai-delivery\/epics\/APEX-\d+\/handoffs\/copilot-cli\/intake\.prompt\.md"$/, 'Expected the CLI handoff result to expose a terminal-safe copilot -p command.');
  const pbiEvidenceResult = await vscode.commands.executeCommand<{ artifactPath?: string; score?: { score: number } }>('apexDelivery.generateEvidencePack', pbiEpic);
  assert.ok(pbiEvidenceResult?.artifactPath && fs.existsSync(pbiEvidenceResult.artifactPath), 'Expected Generate Evidence Pack to write EVIDENCE.md for the PBI epic.');
  assert.ok((pbiEvidenceResult?.score?.score ?? 0) > 0, 'Expected Generate Evidence Pack to return the computed PBI review score.');
  await vscode.workspace.getConfiguration('apexDelivery').update('copilot.provider', 'vscodeBuiltIn', vscode.ConfigurationTarget.Workspace);

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
      execution: {
        mode: 'pooled',
        commands: {
          runPhase: 'control',
          reviewPullRequest: 'pooled',
          openWorkspace: 'pinned',
        },
      },
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

  const initialEpicKeys = new Set(new PipelineScanner(workspaceRoot, 'docs/ai-delivery/epics').scanAll().map((candidate) => candidate.key));
  await vscode.commands.executeCommand('apexDelivery.createSampleEpic', {
    nonInteractive: true,
    workflowId: 'investigate-workflow',
  });
  const epic = await waitForNewEpic(workspaceRoot, initialEpicKeys);
  assert.strictEqual(epic.workflowId, 'investigate-workflow', 'Expected the sample epic to carry the selected workflow id');
  assert.deepStrictEqual(
    epic.execution,
    {
      mode: 'pooled',
      commands: {
        runPhase: 'control',
        reviewPullRequest: 'pooled',
        openWorkspace: 'pinned',
      },
    },
    'AC3: Expected the sample epic snapshot to retain workflow execution policy even when the workflow has no implement phase.',
  );
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
  let firstScopedResult: SmokeCommandResult | undefined;
  let reopenedScopedResult: SmokeCommandResult | undefined;
  let secondEpicScopedResult: SmokeCommandResult | undefined;
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
    firstScopedResult = await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase,
      epic,
      nonInteractive: true,
      forceChatFallback: true,
    });
    reopenedScopedResult = await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase: sameEpicLaterPhase,
      epic,
      nonInteractive: true,
      forceChatFallback: true,
    });
    secondEpicScopedResult = await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
      phase: staleAutopilotPhase,
      epic: staleAutopilotEpic,
      nonInteractive: true,
      forceChatFallback: true,
    });
  });

  assert.strictEqual(scopedSessionLaunches.length, 3, 'Expected each fallback run to open or reveal an epic-scoped native chat session before sending the prompt');
  assert.strictEqual(firstScopedResult?.chatLaunchResult, 'prefilled', 'Expected the first fallback run for an epic to prefill the scoped ask prompt.');
  assert.strictEqual(reopenedScopedResult?.chatLaunchResult, 'opened', 'AC1: Expected rerunning the same epic after a prior fallback session to reopen that session instead of starting a new ask chat.');
  assert.strictEqual(secondEpicScopedResult?.chatLaunchResult, 'prefilled', 'Expected a different epic to start with its own prefilled fallback prompt.');
  assert.strictEqual(scopedChatRequests.length, 2, 'Expected only fresh epic fallback runs to invoke the generic ask-mode Copilot chat command.');
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
  assert.ok(scopedChatRequests[1]?.query?.includes(staleAutopilotEpic.key), 'Expected the second scoped chat request to target the second epic after the reopened first-epic session skipped generic ask-mode launch');

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
  assert.strictEqual(result.chatLaunchResult, 'opened', 'AC1: Expected rerunning fallback for the same epic to reopen the existing chat session rather than prefill a new ask chat');
  assert.strictEqual(result.runPreferences?.preferredChatAgent, 'Business Analyst', 'AC2: Expected explicit phase profile overrides to win over workflow and role defaults.');
  assert.strictEqual(result.runPreferences?.agentTag, '#workflow-investigate', 'AC2: Expected workflow defaults to win over role defaults when no explicit phase profile agentTag override exists.');
  assert.strictEqual(result.runPreferences?.modelFamily, undefined, 'AC2: Expected deprecated model family preferences to be ignored in chat-first run preferences.');
  assert.strictEqual(result.runPreferences?.starterPrompt, 'Profile override starter prompt.', 'AC2: Expected explicit phase profile starter prompts to win over workflow and role defaults.');
  assert.strictEqual(result.rolePolicyResolution?.status, 'mismatched', 'Expected the current user role to mismatch the phase owner');
  assert.strictEqual(result.rolePolicyResolution?.userRole, 'Developer', 'Expected the role-aware resolver to record the configured user role');
  assert.strictEqual(result.rolePolicyResolution?.preferredRole, 'Business Analyst', 'Expected the role-aware resolver to record the preferred phase role');
  assert.match(
    result.fallbackReason ?? '',
    /reopened the existing epic-scoped chat session/i,
    'AC1: Expected fallback execution to report that it reused the stored epic-scoped chat session',
  );
  assert.strictEqual(fallbackLaunches.length, 0, 'AC1: Expected fallback execution to avoid issuing a generic ask-mode launch when reopening an existing epic-scoped chat session');
  assert.ok(typeof result.chatStarter === 'string' && result.chatStarter.includes(epic.key), 'Expected the reopened fallback prompt to mention the current epic key');
  assert.ok(typeof result.chatStarter === 'string' && result.chatStarter.includes('Preferred GitHub Copilot Chat agent: Business Analyst.'), 'AC3: Expected the reopened fallback prompt to preserve the preferred agent hint.');
  assert.ok(typeof result.chatStarter === 'string' && result.chatStarter.includes('#workflow-investigate'), 'AC2: Expected workflow-scoped agentTag defaults to flow into the reopened fallback prompt.');
  assert.ok(typeof result.chatStarter === 'string' && !result.chatStarter.includes('Preferred model family hint:'), 'AC3: Expected the reopened fallback prompt to omit model preference hints because the chat UI picker is the source of truth.');
  assert.ok(typeof result.chatStarter === 'string' && result.chatStarter.includes('Profile override starter prompt.'), 'AC5: Expected workflow-scoped starter prompt content to remain in the reopened fallback prompt.');

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
  assert.ok(typeof agentRequest.query === 'string' && !agentRequest.query.includes('Preferred model family hint:'), 'AC3: Expected agent-mode launches to omit model preference hints because the chat UI picker is the source of truth.');
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

  checkoutBranch(workspaceRoot, 'main');
  commitAll(workspaceRoot, 'Smoke baseline for portfolio and PR review');

  checkoutBranch(workspaceRoot, 'feat/linked-review', true);
  const linkedReviewChangePath = path.join(workspaceRoot, 'docs', 'ai-delivery', 'epics', epic.key, 'IMPLEMENTATION.md');
  fs.appendFileSync(linkedReviewChangePath, '\nLinked PR review smoke change.\n', 'utf8');
  commitAll(workspaceRoot, 'Linked PR review change');
  checkoutBranch(workspaceRoot, 'main');
  await vscode.commands.executeCommand('apexDelivery.linkBranchToEpic', {
    nonInteractive: true,
    branchName: 'feat/linked-review',
  }, epic);
  const linkedMetadata = readCoordinationMetadata(epic.folderPath);
  assert.ok(
    linkedMetadata.metadata?.branches.some((branch) => branch.name === 'feat/linked-review'),
    'AC-1: Expected Link Branch To Epic to bind a selected branch without checking it out first.',
  );
  const linkedCoordination = withPullRequestBinding(
    linkedMetadata.metadata ?? createDefaultCoordinationMetadata(epic.key),
    {
      provider: 'github',
      number: 42,
      url: 'https://github.com/org/repo/pull/42',
      baseBranch: 'main',
      headBranch: 'feat/linked-review',
      author: 'linked-reviewer',
      linkedAt: '2026-05-03T13:00:00Z',
    },
  );
  writeCoordinationMetadata(epic.folderPath, linkedCoordination, linkedMetadata.raw);

  const blockedPhaseRun = await vscode.commands.executeCommand<SmokeCommandResult>('apexDelivery.runPhaseInCopilot', {
    phase,
    epic,
    nonInteractive: true,
    forceChatFallback: true,
  });
  assert.ok(blockedPhaseRun, 'Expected Run Phase with Copilot to return a result when the linked branch guard blocks execution.');
  assert.strictEqual(blockedPhaseRun.mode, 'blocked', 'Expected Run Phase with Copilot to block when the current workspace branch does not match the linked branch.');
  assert.match(blockedPhaseRun.fallbackReason ?? '', /Expected linked branch "feat\/linked-review"/i, 'Expected the blocked phase run to explain the linked-branch mismatch.');

  const missingWorktreeReviewPath = path.join(workspaceRoot, 'docs', 'ai-delivery', 'reviews', 'PR-42', 'REVIEW.md');
  const blockedLinkedReviewResult = await vscode.commands.executeCommand<ReviewPullRequestCommandResult>('apexDelivery.reviewPullRequest', {
    nonInteractive: true,
    prNumber: 42,
    prUrl: 'https://github.com/org/repo/pull/42',
    baseBranch: 'main',
    headBranch: 'feat/linked-review',
    openArtifact: false,
  });
  assert.ok(blockedLinkedReviewResult, 'Expected linked PR review to return a result when blocked for a missing worktree.');
  assert.strictEqual(blockedLinkedReviewResult.mode, 'blocked', 'Expected linked PR review to block until the linked branch worktree exists.');
  assert.match(blockedLinkedReviewResult.blockedReason ?? '', /Open Pinned Branch Workspace/i, 'Expected blocked linked PR review to direct the user to open the pinned branch workspace.');
  assert.ok(!fs.existsSync(missingWorktreeReviewPath), 'Expected blocked linked PR review to avoid writing review artifacts in the control workspace.');

  const linkedWorktreeOpenRequests: Array<{ folderUri: vscode.Uri; forceNewWindow?: boolean }> = [];
  const linkedWorktreeResult = await withExecuteCommandInterceptor(async (command, args, next) => {
    if (command === 'vscode.openFolder' && args[0] instanceof vscode.Uri) {
      linkedWorktreeOpenRequests.push({
        folderUri: args[0],
        forceNewWindow: typeof args[1] === 'boolean' ? args[1] : undefined,
      });
      return undefined;
    }

    return next(command, ...args);
  }, async () => vscode.commands.executeCommand<OpenLinkedBranchWorktreeCommandResult>('apexDelivery.openLinkedBranchWorktree', {
    nonInteractive: true,
    branchName: 'feat/linked-review',
  }, epic));
  assert.ok(linkedWorktreeResult, 'Expected the linked branch worktree command to return a result.');
  assert.strictEqual(linkedWorktreeResult.branchName, 'feat/linked-review', 'Expected the linked worktree command to resolve the requested linked branch.');
  assert.ok(fs.existsSync(linkedWorktreeResult.worktreePath), 'Expected the linked branch worktree command to create or reuse a local worktree path.');
  assert.strictEqual(linkedWorktreeOpenRequests.length, 1, 'Expected the linked branch worktree command to request opening the worktree folder.');
  assert.strictEqual(
    path.normalize(linkedWorktreeOpenRequests[0]?.folderUri.fsPath ?? '').toLowerCase(),
    path.normalize(linkedWorktreeResult.worktreePath).toLowerCase(),
    'Expected the open-folder request to target the resolved linked worktree path.',
  );
  assert.strictEqual(linkedWorktreeOpenRequests[0]?.forceNewWindow, true, 'Expected the linked branch worktree command to open the worktree in a new window.');

  const observedWorktreePath = path.join(path.dirname(workspaceRoot), `${path.basename(workspaceRoot)}-observed-worktree`);
  createGitWorktree(workspaceRoot, observedWorktreePath, 'feat/worktree-observed', 'main');
  fs.writeFileSync(path.join(observedWorktreePath, 'worktree-note.md'), 'worktree signal\n', 'utf8');
  const observedWorktreeMetadata = withBranchBinding(
    createDefaultCoordinationMetadata(fullyAutomaticEpic.key),
    {
      name: 'feat/worktree-observed',
      role: 'implementation',
      createdByApex: false,
      linkedAt: '2026-05-03T13:00:00Z',
    },
  );
  writeCoordinationMetadata(fullyAutomaticEpic.folderPath, observedWorktreeMetadata);

  const dashboard = await vscode.commands.executeCommand<PortfolioDashboardResult>('apexDelivery.openDashboard');
  assert.ok(dashboard, 'Expected the dashboard command to return a portfolio snapshot.');
  assert.strictEqual(dashboard.indexState, 'missing', 'Expected the dashboard to degrade gracefully when portfolio.json is absent.');
  assert.ok(dashboard.summary.activeEpics >= 2, 'Expected the portfolio snapshot to include multiple active epics.');
  assert.ok(dashboard.summary.localWorktrees >= 1, 'Expected the portfolio snapshot to observe at least one local worktree.');
  const worktreeEntry = dashboard.entries.find((entry) => entry.epic.key === fullyAutomaticEpic.key);
  assert.ok(worktreeEntry?.worktreeSignal, 'Expected the portfolio snapshot to surface the observed secondary worktree.');
  assert.strictEqual(
    path.normalize(worktreeEntry?.worktreeSignal?.worktreePath ?? '').toLowerCase(),
    path.normalize(observedWorktreePath).toLowerCase(),
    'Expected the portfolio snapshot to report the observed worktree path for the linked epic.',
  );
  assert.strictEqual(worktreeEntry?.worktreeSignal?.dirtyFiles, 1, 'Expected the portfolio snapshot to report the local dirty-file signal for the observed worktree.');

  const linkedReviewResult = await vscode.commands.executeCommand<ReviewPullRequestCommandResult>('apexDelivery.reviewPullRequest', {
    nonInteractive: true,
    prNumber: 42,
    prUrl: 'https://github.com/org/repo/pull/42',
    baseBranch: 'main',
    headBranch: 'feat/linked-review',
    openArtifact: false,
  });
  assert.ok(linkedReviewResult, 'Expected linked PR review mode to return an artifact result.');
  assert.strictEqual(linkedReviewResult.mode, 'linked-epic', 'Expected an explicitly linked PR to resolve to the linked epic review mode.');
  assert.strictEqual(linkedReviewResult.linkedEpicKey, epic.key, 'Expected linked PR review mode to resolve the epic key from explicit coordination metadata.');
  assert.strictEqual(
    path.normalize(linkedReviewResult.executionWorkspacePath ?? '').toLowerCase(),
    path.normalize(linkedWorktreeResult.worktreePath).toLowerCase(),
    'Expected linked PR review mode to execute from the linked branch worktree instead of the control workspace.',
  );
  assert.ok(linkedReviewResult.reviewArtifactPath && fs.existsSync(linkedReviewResult.reviewArtifactPath), 'Expected linked PR review mode to create the detailed review workspace artifact.');
  assert.ok(linkedReviewResult.reviewContextPath && fs.existsSync(linkedReviewResult.reviewContextPath), 'Expected linked PR review mode to create review-context.json.');
  assert.ok(linkedReviewResult.artifactPath && fs.existsSync(linkedReviewResult.artifactPath), 'Expected linked PR review mode to update the epic review artifact inside the linked worktree.');
  assert.ok(
    path.normalize(linkedReviewResult.artifactPath ?? '').toLowerCase().startsWith(path.normalize(linkedWorktreeResult.worktreePath).toLowerCase()),
    'Expected linked PR review mode to write the epic review artifact under the linked worktree root.',
  );
  assert.match(fs.readFileSync(linkedReviewResult.reviewArtifactPath ?? '', 'utf8'), /# PR Review - #42/, 'Expected the linked PR review workspace artifact to include the PR heading.');
  assert.match(fs.readFileSync(linkedReviewResult.artifactPath ?? '', 'utf8'), /APEX:PR-REVIEW:42:START/, 'Expected the linked epic REVIEW.md artifact to embed the PR review section markers.');
  assert.ok(linkedReviewResult.changedFiles.some((file) => file.endsWith('IMPLEMENTATION.md')), 'Expected linked PR review mode to capture local diff files from base to head.');

  checkoutBranch(workspaceRoot, 'main');
  checkoutBranch(workspaceRoot, 'feat/unlinked-review', true);
  fs.appendFileSync(path.join(workspaceRoot, 'README.md'), '\nUnlinked PR review smoke change.\n', 'utf8');
  commitAll(workspaceRoot, 'Unlinked PR review change');
  const unlinkedReviewResult = await vscode.commands.executeCommand<ReviewPullRequestCommandResult>('apexDelivery.reviewPullRequest', {
    nonInteractive: true,
    prNumber: 77,
    prUrl: 'https://github.com/org/repo/pull/77',
    baseBranch: 'main',
    headBranch: 'feat/unlinked-review',
    openArtifact: false,
  });
  assert.ok(unlinkedReviewResult, 'Expected unlinked PR review mode to return an artifact result.');
  assert.strictEqual(unlinkedReviewResult.mode, 'unlinked', 'Expected an unlinked PR to create a standalone review workspace.');
  assert.strictEqual(unlinkedReviewResult.linkedEpicKey, undefined, 'Expected unlinked PR review mode to stay detached from epic context.');
  const unlinkedArtifactPath = unlinkedReviewResult.artifactPath;
  assert.ok(unlinkedArtifactPath && fs.existsSync(unlinkedArtifactPath), 'Expected unlinked PR review mode to create the standalone review artifact.');
  assert.match(unlinkedArtifactPath?.replace(/\\/g, '/') ?? '', /docs\/ai-delivery\/reviews\/PR-77\/REVIEW\.md$/, 'Expected unlinked PR review mode to place the artifact under docs/ai-delivery/reviews/PR-77/.');
  assert.match(fs.readFileSync(unlinkedArtifactPath ?? '', 'utf8'), /# PR Review - #77/, 'Expected the unlinked review artifact to include the PR heading.');
  assert.ok(unlinkedReviewResult.changedFiles.some((file) => file.endsWith('README.md')), 'Expected unlinked PR review mode to capture local diff files from base to head.');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  console.log(`APEX smoke test passed with mode: ${result.mode} (${result.chatLaunchResult ?? 'unknown'})`);
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

function initializeGitRepository(workspaceRoot: string): void {
  if (fs.existsSync(path.join(workspaceRoot, '.git'))) {
    return;
  }

  fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# APEX Smoke Workspace\n', 'utf8');
  runGit(workspaceRoot, ['init']);
  runGit(workspaceRoot, ['config', 'user.email', 'apex-smoke@example.com']);
  runGit(workspaceRoot, ['config', 'user.name', 'APEX Smoke']);
  runGit(workspaceRoot, ['add', '.']);
  runGit(workspaceRoot, ['commit', '-m', 'Initial smoke workspace']);
  runGit(workspaceRoot, ['branch', '-M', 'main']);
}

function commitAll(workspaceRoot: string, message: string): void {
  const status = runGit(workspaceRoot, ['status', '--porcelain']).trim();
  if (status.length === 0) {
    return;
  }

  runGit(workspaceRoot, ['add', '.']);
  runGit(workspaceRoot, ['commit', '-m', message]);
}

function checkoutBranch(workspaceRoot: string, branchName: string, create = false): void {
  runGit(workspaceRoot, create ? ['checkout', '-B', branchName] : ['checkout', branchName]);
}

function createGitWorktree(workspaceRoot: string, worktreePath: string, branchName: string, startPoint: string): void {
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
  runGit(workspaceRoot, ['worktree', 'add', worktreePath, '-b', branchName, startPoint]);
}

function runGit(workspaceRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
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
