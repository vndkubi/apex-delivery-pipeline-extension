import * as fs from 'fs';
import * as path from 'path';

export interface McpServerConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpWorkspaceConfig {
  servers?: Record<string, unknown>;
  [key: string]: unknown;
}

export type McpWriteResult =
  | { status: 'written'; configPath: string; serverName: string }
  | { status: 'already-exists'; configPath: string; serverName: string };

export function buildAtlassianRemoteServer(remoteUrl: string): McpServerConfig {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-remote', remoteUrl],
  };
}

export function buildCustomStdioServer(command: string, args: string[]): McpServerConfig {
  return {
    type: 'stdio',
    command,
    args,
  };
}

export function ensureMcpConfigFile(workspaceRoot: string, configuredPath: string): string {
  const configPath = resolveConfigPath(workspaceRoot, configuredPath);
  if (!fs.existsSync(configPath)) {
    writeConfig(configPath, { servers: {} });
  }
  return configPath;
}

export function upsertMcpServer(
  workspaceRoot: string,
  configuredPath: string,
  serverName: string,
  server: McpServerConfig,
): McpWriteResult {
  const configPath = resolveConfigPath(workspaceRoot, configuredPath);
  const config = readConfig(configPath);
  const servers = config.servers ?? {};

  if (Object.prototype.hasOwnProperty.call(servers, serverName)) {
    return { status: 'already-exists', configPath, serverName };
  }

  config.servers = {
    ...servers,
    [serverName]: server,
  };
  writeConfig(configPath, config);
  return { status: 'written', configPath, serverName };
}

export function sanitizeServerName(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function parseArgsInput(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
        return parsed;
      }
    } catch {
      return [];
    }
  }

  const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((part) => part.replace(/^"|"$/g, '')).filter(Boolean);
}

function resolveConfigPath(workspaceRoot: string, configuredPath: string): string {
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(workspaceRoot, configuredPath || '.vscode/mcp.json');
}

function readConfig(configPath: string): McpWorkspaceConfig {
  if (!fs.existsSync(configPath)) {
    return { servers: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    if (isRecord(parsed)) {
      const servers = isRecord(parsed.servers) ? parsed.servers : {};
      return { ...parsed, servers };
    }
  } catch {
    return { servers: {} };
  }

  return { servers: {} };
}

function writeConfig(configPath: string, config: McpWorkspaceConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
