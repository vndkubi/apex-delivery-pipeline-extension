import * as path from 'path';
import * as vscode from 'vscode';
import { EpicStatus, PhaseStatus, PhaseStatusValue } from './pipelineModel';
import { PipelineScanner } from './pipelineScanner';

type TreeNode = EpicItem | PhaseItem | DetailItem;

export class PipelineProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private epics: EpicStatus[] = [];

  constructor(private readonly scanner: PipelineScanner) {
    this.refresh();
  }

  refresh(): void {
    this.epics = this.scanner.scanAll();
    this.onDidChangeTreeDataEmitter.fire(undefined);
    void vscode.commands.executeCommand('setContext', 'apexDelivery.empty', this.epics.length === 0);
  }

  getEpics(): EpicStatus[] {
    return this.epics;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.epics.map((epic) => new EpicItem(epic));
    }

    if (element instanceof EpicItem) {
      return element.epic.phases.map((phase) => new PhaseItem(phase, element.epic));
    }

    if (element instanceof PhaseItem) {
      return [
        new DetailItem('Owner', element.phase.owner, 'account'),
        new DetailItem('Gate', element.phase.gate, 'shield'),
        new DetailItem('Output', element.phase.output, 'output'),
        new DetailItem('Artifact', element.phase.artifact, 'file', element.phase.artifactPath),
        new DetailItem('Status file', path.basename(element.phase.statusPath), 'json', element.phase.statusPath),
      ];
    }

    return [];
  }
}

export class EpicItem extends vscode.TreeItem {
  constructor(readonly epic: EpicStatus) {
    super(epic.key, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${epic.progress}% - ${currentPhaseLabel(epic)}`;
    this.tooltip = new vscode.MarkdownString(buildEpicTooltip(epic));
    this.contextValue = 'epic';
    this.iconPath = iconForEpic(epic);
    this.command = {
      command: 'vscode.open',
      title: 'Open Epic',
      arguments: [vscode.Uri.file(path.join(epic.folderPath, 'EPIC.md'))],
    };
  }
}

export class PhaseItem extends vscode.TreeItem {
  constructor(readonly phase: PhaseStatus, readonly epic: EpicStatus) {
    super(phase.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${phase.status} - ${phase.owner}`;
    this.tooltip = new vscode.MarkdownString(buildPhaseTooltip(phase));
    this.contextValue = `phase-${phase.status}`;
    this.iconPath = iconForStatus(phase.status);
    this.command = {
      command: 'apexDelivery.openOrCreateArtifact',
      title: 'Open or Create Artifact',
      arguments: [phase, epic],
    };
  }
}

class DetailItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string, filePath?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    if (filePath) {
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [vscode.Uri.file(filePath)],
      };
    }
  }
}

function currentPhaseLabel(epic: EpicStatus): string {
  const phase = epic.phases[epic.currentPhaseIndex];
  return phase ? phase.name : 'Complete';
}

function buildEpicTooltip(epic: EpicStatus): string {
  const lines = [
    `## ${epic.key}`,
    '',
    `**Title**: ${epic.title}`,
    `**Progress**: ${epic.progress}%`,
    '',
  ];
  for (const phase of epic.phases) {
    lines.push(`- ${phase.name}: ${phase.status}`);
  }
  return lines.join('\n');
}

function buildPhaseTooltip(phase: PhaseStatus): string {
  const lines = [
    `## ${phase.name}`,
    '',
    `**Status**: ${phase.status}`,
    `**Owner**: ${phase.owner}`,
    `**Quality Gate**: ${phase.gate}`,
    `**Artifact**: ${phase.artifact}`,
    `**Output**: ${phase.output}`,
  ];
  if (phase.updatedAt) {
    lines.push(`**Updated**: ${phase.updatedAt}`);
  }
  if (phase.notes) {
    lines.push('', phase.notes);
  }
  return lines.join('\n');
}

function iconForEpic(epic: EpicStatus): vscode.ThemeIcon {
  if (epic.hasBlocked) {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  }
  if (epic.hasAwaitingReview) {
    return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.orange'));
  }
  if (epic.progress === 100) {
    return new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'));
  }
  if (epic.progress > 0) {
    return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.yellow'));
  }
  return new vscode.ThemeIcon('circle-outline');
}

function iconForStatus(status: PhaseStatusValue): vscode.ThemeIcon {
  switch (status) {
    case 'passed':
    case 'done':
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    case 'in_progress':
      return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.yellow'));
    case 'awaiting_review':
      return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.orange'));
    case 'rejected':
    case 'blocked':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'stale':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    case 'pending':
      return new vscode.ThemeIcon('circle-outline');
  }
}
