#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const deleteFiles = process.argv.includes('--delete');
const keepLatest = process.argv.includes('--keep-latest');

const vsixFiles = fs.readdirSync(workspaceRoot)
  .filter((name) => name.toLowerCase().endsWith('.vsix'))
  .map((name) => {
    const filePath = path.join(workspaceRoot, name);
    return {
      name,
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    };
  })
  .sort((left, right) => right.mtimeMs - left.mtimeMs);

const removableFiles = keepLatest ? vsixFiles.slice(1) : vsixFiles;

if (vsixFiles.length === 0) {
  console.log('No local .vsix packages found in the repository root.');
  process.exit(0);
}

console.log(`Found ${vsixFiles.length} local .vsix package(s).`);
if (!deleteFiles) {
  for (const file of vsixFiles) {
    console.log(`dry-run ${file.name}`);
  }
  console.log('Run `npm run clean:vsix -- --delete` to remove them, or add `--keep-latest` to keep the newest package.');
  process.exit(0);
}

for (const file of removableFiles) {
  const resolvedPath = path.resolve(file.filePath);
  if (!resolvedPath.startsWith(workspaceRoot + path.sep)) {
    throw new Error(`Refusing to delete outside workspace: ${resolvedPath}`);
  }
  fs.rmSync(resolvedPath, { force: true });
  console.log(`removed ${file.name}`);
}

if (keepLatest && vsixFiles[0]) {
  console.log(`kept latest ${vsixFiles[0].name}`);
}
