import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspacePath = createSmokeWorkspace();

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
  }
}

function createSmokeWorkspace(): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-delivery-smoke-'));
  fs.mkdirSync(path.join(workspacePath, 'docs', 'ai-delivery', 'epics'), { recursive: true });
  return workspacePath;
}

void main();