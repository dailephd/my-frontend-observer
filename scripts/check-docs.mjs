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

// Guards the "unreleased implementation, released package metadata" drift
// this audit found repeated across README/PROJECT_OVERVIEW/WORKFLOWS/
// CONTRACTS/SECURITY: once a version's implementation is documented as
// complete-but-unreleased, CHANGELOG.md must carry a place for it rather
// than silently omitting unreleased work from release history.
const changelog = await readFile('CHANGELOG.md', 'utf8');
if (!changelog.includes('[Unreleased]')) {
  throw new Error('CHANGELOG.md must contain an "[Unreleased]" section once unreleased implementation work exists in the repository.');
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
if (!/v0\.10[\s\S]{0,240}implementation[\s\S]{0,120}complete/i.test(currentState)
  || !/documentation[\s\S]{0,80}reconcil/i.test(currentState)
  || !/pre-release readiness[\s\S]{0,120}(?:next|not yet|pending)/i.test(currentState)) {
  throw new Error('CURRENT_STATE.md must distinguish complete v0.10 implementation/reconciliation from pending pre-release readiness.');
}
if (!/v0\.10[\s\S]{0,180}implementation complete[\s\S]{0,100}documentation-reconciled/i.test(roadmap)) {
  throw new Error('ROADMAP.md must record v0.10 as implementation complete and documentation-reconciled.');
}
if (!contracts.includes('my-frontend-observer/visual-change-workflow') || !contracts.includes('my-frontend-observer/visual-change-agent-handoff')) {
  throw new Error('CONTRACTS.md must retain the canonical v0.10 workflow and handoff contract markers.');
}

console.log(`Documentation check passed (${required.length} required files).`);
