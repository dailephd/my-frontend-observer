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
console.log(`Documentation check passed (${required.length} required files).`);
