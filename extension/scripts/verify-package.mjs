import { constants } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const dist = resolve(extensionRoot, 'dist');
const packageJson = JSON.parse(await readFile(resolve(extensionRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Manifest version ${manifest.version} does not match package ${packageJson.version}`
  );
}

const manifestResources = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_page,
  manifest.options_ui?.page,
  manifest.devtools_page,
  ...Object.values(manifest.chrome_url_overrides || {}),
  ...(manifest.content_scripts || []).flatMap(({ js = [], css = [] }) => [...js, ...css]),
  ...(manifest.web_accessible_resources || []).flatMap(({ resources = [] }) => resources),
].filter((resource) => typeof resource === 'string' && !resource.includes('*'));

for (const resource of new Set(manifestResources)) {
  const file = resolve(dist, resource);
  const pathFromDist = relative(dist, file);
  if (!pathFromDist || pathFromDist.startsWith('..')) {
    throw new Error(`Manifest resource escapes the package: ${resource}`);
  }
  await access(file, constants.R_OK);
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(resolve(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function archiveFiles(output) {
  return output
    .split(/\r?\n/)
    .filter((entry) => entry && !entry.endsWith('/'))
    .map((entry) => entry.replace(/^\.\//, ''))
    .sort();
}

const expectedFiles = await listFiles(dist);
const zip = resolve(extensionRoot, `citicious-extension-v${packageJson.version}.zip`);
const tar = resolve(extensionRoot, `citicious-extension-v${packageJson.version}.tar.gz`);
run('unzip', ['-tqq', zip]);

for (const [name, files] of [
  ['ZIP', archiveFiles(run('unzip', ['-Z1', zip]))],
  ['tar.gz', archiveFiles(run('tar', ['-tzf', tar]))],
]) {
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${name} contents do not match dist`);
  }
}

console.log(`Verified ${expectedFiles.length} packaged files for v${packageJson.version}`);
