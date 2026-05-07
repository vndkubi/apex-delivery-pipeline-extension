import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspacePath = createSmokeWorkspace();
  const restoredEnv = clearInheritedVsCodeEnvironment();

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error('Smoke test run failed');
    console.error(message);
    process.exit(1);
  } finally {
    restoreEnvironment(restoredEnv);
  }
}

function createSmokeWorkspace(): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-delivery-smoke-'));
  fs.mkdirSync(path.join(workspacePath, 'docs', 'ai-delivery', 'epics'), { recursive: true });
  return workspacePath;
}

function clearInheritedVsCodeEnvironment(): Record<string, string | undefined> {
  const restoredEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) {
      restoredEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
  return restoredEnv;
}

function restoreEnvironment(restoredEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(restoredEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

void main();
