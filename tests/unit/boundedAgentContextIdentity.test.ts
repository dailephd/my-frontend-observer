import { describe, expect, it } from 'vitest';
import {
  buildBoundedAgentContextRequestIdentity,
  buildBoundedAgentContextInstanceIdentity,
} from '../../src/domain/boundedAgentContextIdentity.js';
import type { BoundedAgentContextSourceReferences } from '../../src/domain/boundedAgentContext.js';

const sources: BoundedAgentContextSourceReferences = { observationIds: ['obs-1'] };

describe('buildBoundedAgentContextRequestIdentity', () => {
  it('is deterministic and insensitive to object-key insertion order (TST-022)', () => {
    const a = buildBoundedAgentContextRequestIdentity(sources, ['t-1', 't-2'], 'frontend-change-review');
    const differentlyOrderedSources: BoundedAgentContextSourceReferences = { comparisonId: undefined, observationIds: ['obs-1'] };
    const b = buildBoundedAgentContextRequestIdentity(differentlyOrderedSources, ['t-1', 't-2'], 'frontend-change-review');
    expect(a).toBe(b);
  });

  it('is insensitive to target id array ordering, since the target set (not its authoring order) is what identifies a request (TST-023)', () => {
    const a = buildBoundedAgentContextRequestIdentity(sources, ['t-1', 't-2'], 'frontend-change-review');
    const b = buildBoundedAgentContextRequestIdentity(sources, ['t-2', 't-1'], 'frontend-change-review');
    expect(a).toBe(b);
  });

  it('changes when the target id set itself differs', () => {
    const a = buildBoundedAgentContextRequestIdentity(sources, ['t-1', 't-2'], 'frontend-change-review');
    const b = buildBoundedAgentContextRequestIdentity(sources, ['t-1', 't-3'], 'frontend-change-review');
    expect(a).not.toBe(b);
  });

  it('is insensitive to observationIds array ordering (sorted before hashing)', () => {
    const a = buildBoundedAgentContextRequestIdentity({ observationIds: ['obs-1', 'obs-2'] }, ['t-1'], 'frontend-change-review');
    const b = buildBoundedAgentContextRequestIdentity({ observationIds: ['obs-2', 'obs-1'] }, ['t-1'], 'frontend-change-review');
    expect(a).toBe(b);
  });

  it('changes when a source reference field differs', () => {
    const a = buildBoundedAgentContextRequestIdentity({ observationIds: ['obs-1'] }, ['t-1'], 'frontend-change-review');
    const b = buildBoundedAgentContextRequestIdentity({ observationIds: ['obs-1'], comparisonId: 'cmp-1' }, ['t-1'], 'frontend-change-review');
    expect(a).not.toBe(b);
  });

  it('is unaffected by unrelated operational context, since no path parameter exists to include (TST-021)', () => {
    const a = buildBoundedAgentContextRequestIdentity(sources, ['t-1'], 'frontend-change-review');
    const b = buildBoundedAgentContextRequestIdentity(sources, ['t-1'], 'frontend-change-review');
    expect(a).toBe(b);
  });
});

describe('buildBoundedAgentContextInstanceIdentity', () => {
  it('is fresh and never collides across 1000 calls with the same requestIdentity (TST-024)', () => {
    const requestIdentity = buildBoundedAgentContextRequestIdentity(sources, ['t-1'], 'frontend-change-review');
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(buildBoundedAgentContextInstanceIdentity(requestIdentity));
    }
    expect(ids.size).toBe(1000);
  });

  it('always incorporates the supplied requestIdentity as a prefix (TST-024)', () => {
    const requestIdentity = buildBoundedAgentContextRequestIdentity(sources, ['t-1'], 'frontend-change-review');
    const instanceId = buildBoundedAgentContextInstanceIdentity(requestIdentity);
    expect(instanceId.startsWith(requestIdentity)).toBe(true);
  });

  it('is never derived from a timestamp alone', () => {
    const requestIdentity = buildBoundedAgentContextRequestIdentity(sources, ['t-1'], 'frontend-change-review');
    const isoTimestampRe = /^\d{4}-\d{2}-\d{2}T/;
    const id = buildBoundedAgentContextInstanceIdentity(requestIdentity);
    expect(isoTimestampRe.test(id)).toBe(false);
  });
});
