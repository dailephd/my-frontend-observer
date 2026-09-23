import { access, readFile } from 'node:fs/promises';

const required = [
  'README.md', 'CHANGELOG.md', 'docs/PROJECT_OVERVIEW.md', 'docs/CURRENT_STATE.md',
  'docs/ARCHITECTURE.md', 'docs/CONTRACTS.md', 'docs/COMMANDS.md', 'docs/WORKFLOWS.md',
  'docs/QUICKSTART.md', 'docs/DEVELOPMENT.md', 'docs/CI_CD.md', 'docs/ROADMAP.md',
  'docs/RELEASE.md', 'docs/SECURITY.md', 'docs/DOCUMENTATION_PRESERVATION_POLICY.md',
  'docs/PROJECT_DESCRIPTION.md', 'docs/PROJECT_MILESTONES.md',
];
await Promise.all(required.map((file) => access(file)));
const roadmap = await readFile('docs/ROADMAP.md', 'utf8');
for (let version = 1; version <= 10; version += 1) {
  if (!roadmap.includes(`v0.${version}`)) throw new Error(`ROADMAP.md is missing v0.${version}`);
}
if (/\bBatch\s+\d+/i.test(roadmap)) throw new Error('ROADMAP.md must not contain implementation batches.');

// Guards the exact mistake the v0.8 documentation-completeness audit was
// instructed to check for on every future pass: a documentation-only stage
// must never leave package.json and package-lock.json reporting different
// versions from each other.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const pkgLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (pkg.version !== pkgLock.version) {
  throw new Error(`package.json version (${pkg.version}) and package-lock.json version (${pkgLock.version}) must match.`);
}
if (pkgLock.packages?.['']?.version !== pkg.version) {
  throw new Error(`package-lock.json packages[''].version (${pkgLock.packages?.['']?.version}) must match package.json version (${pkg.version}).`);
}

// Keep a forward-looking section and a dated entry for the current release.
const changelog = await readFile('CHANGELOG.md', 'utf8');
if (!changelog.includes('[Unreleased]')) {
  throw new Error('CHANGELOG.md must retain an "[Unreleased]" section for future work.');
}
if (!/^## 0\.10\.0 - 2026-09-23$/m.test(changelog)) {
  throw new Error('CHANGELOG.md must contain the dated v0.10.0 release section.');
}

// Durable v0.10 reconciliation guards. These intentionally test status and
// contract markers rather than exact prose so ordinary documentation editing
// does not become coupled to this script.
const currentState = await readFile('docs/CURRENT_STATE.md', 'utf8');
const projectOverview = await readFile('docs/PROJECT_OVERVIEW.md', 'utf8');
const architecture = await readFile('docs/ARCHITECTURE.md', 'utf8');
const contracts = await readFile('docs/CONTRACTS.md', 'utf8');
const readme = await readFile('README.md', 'utf8');
const currentDocs = [currentState, projectOverview, architecture, readme].join('\n');
if (/v0\.10[^\n]*(?:remains|is|still)[^\n]*(?:future|unimplemented)|v0\.10[^\n]*implementation has not started/i.test(currentDocs)) {
  throw new Error('Current documentation must not describe the completed v0.10 implementation as future or unimplemented.');
}
if (!/v0\.10\.0 is the current release/i.test(currentState)
  || !/package version is `0\.10\.0`/i.test(currentState)
  || !/readiness[\s\S]{0,100}passed/i.test(currentState)
  || !/Viewer protocol remains `1\.3\.0`/i.test(currentState)) {
  throw new Error('CURRENT_STATE.md must record the current v0.10.0 release, passed readiness, package, and Viewer protocol.');
}
if (!/Current status: released as `0\.10\.0`/i.test(roadmap)) {
  throw new Error('ROADMAP.md must record v0.10 as released at the version level.');
}
if (!contracts.includes('my-frontend-observer/visual-change-workflow') || !contracts.includes('my-frontend-observer/visual-change-agent-handoff')) {
  throw new Error('CONTRACTS.md must retain the canonical v0.10 workflow and handoff contract markers.');
}

console.log(`Documentation check passed (${required.length} required files).`);
