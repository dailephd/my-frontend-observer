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

console.log(`Documentation check passed (${required.length} required files).`);
