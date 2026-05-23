#!/usr/bin/env node
/**
 * Starts the Claude Design bridge MCP server with Windows-friendly PATH fixes.
 * Git for Windows ships unzip in usr/bin; prepend it when present.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const mcpEntry = join(repoRoot, 'node_modules', 'claude-design-cursor-bridge', 'bin', 'cdc-mcp.mjs');

const gitUnzipDir = 'C:\\Program Files\\Git\\usr\\bin';
const pathParts = [process.env.PATH ?? ''];
if (existsSync(join(gitUnzipDir, 'unzip.exe'))) {
  pathParts.unshift(gitUnzipDir);
}

const child = spawn(process.execPath, [mcpEntry], {
  stdio: 'inherit',
  env: { ...process.env, PATH: pathParts.filter(Boolean).join(';') },
});

child.on('exit', (code) => process.exit(code ?? 0));
