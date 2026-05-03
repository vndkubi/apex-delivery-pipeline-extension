import * as vscode from 'vscode';

const GUIDED_AUTOPILOT_STORAGE_KEY = 'apexDelivery.guidedAutopilotStates';

export interface GuidedAutopilotState {
  epicKey: string;
  workflowId: string;
  phaseId: string;
  sessionId?: string;
  attempts: number;
  status: 'running' | 'paused';
  updatedAt: string;
  reason?: string;
}

type GuidedAutopilotStateMap = Record<string, GuidedAutopilotState>;

export function readGuidedAutopilotState(
  store: vscode.Memento,
  epicKey: string,
): GuidedAutopilotState | undefined {
  return readGuidedAutopilotStateMap(store)[epicKey];
}

export async function writeGuidedAutopilotState(
  store: vscode.Memento,
  state: GuidedAutopilotState,
): Promise<void> {
  const nextStates = {
    ...readGuidedAutopilotStateMap(store),
    [state.epicKey]: state,
  } satisfies GuidedAutopilotStateMap;
  await store.update(GUIDED_AUTOPILOT_STORAGE_KEY, nextStates);
}

export async function clearGuidedAutopilotState(
  store: vscode.Memento,
  epicKey: string,
): Promise<void> {
  const nextStates = { ...readGuidedAutopilotStateMap(store) };
  delete nextStates[epicKey];
  await store.update(GUIDED_AUTOPILOT_STORAGE_KEY, nextStates);
}

function readGuidedAutopilotStateMap(store: vscode.Memento): GuidedAutopilotStateMap {
  const stored = store.get<GuidedAutopilotStateMap>(GUIDED_AUTOPILOT_STORAGE_KEY, {});
  return isRecord(stored) ? stored : {};
}

function isRecord(value: unknown): value is Record<string, GuidedAutopilotState> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}