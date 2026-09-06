import { describe, expect, it } from 'vitest';
import {
  deriveReferenceRegionGeometry,
  isValidReferenceRegionRectangle,
  isValidReferenceRegion,
  isValidReferenceRegions,
  MAX_REFERENCE_REGIONS,
} from '../../src/domain/externalReferenceRegions.js';

function region(id: string, x: number, y: number, width: number, height: number) {
  return { id, rectangle: { x, y, width, height } };
}

describe('externalReferenceRegions', () => {
  // Behavior A: single valid region - canonical rectangle preserved, derived edges/center correct.
  it('derives correct right/bottom/centerX/centerY from the canonical rectangle', () => {
    const geometry = deriveReferenceRegionGeometry({ x: 28, y: 92, width: 424, height: 82 });
    expect(geometry).toEqual({ x: 28, y: 92, width: 424, height: 82, right: 452, bottom: 174, centerX: 240, centerY: 133 });
  });

  it('derived geometry never contradicts the canonical rectangle (x + width === right, y + height === bottom)', () => {
    const geometry = deriveReferenceRegionGeometry({ x: 10.5, y: 3.25, width: 100.25, height: 50.5 });
    expect(geometry.right).toBe(geometry.x + geometry.width);
    expect(geometry.bottom).toBe(geometry.y + geometry.height);
  });

  it('accepts a valid rectangle', () => {
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: 10, height: 10 })).toEqual({ valid: true });
  });

  // Behavior J: non-finite geometry rejected.
  it('rejects non-finite x/y/width/height', () => {
    expect(isValidReferenceRegionRectangle({ x: NaN, y: 0, width: 10, height: 10 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: Infinity, width: 10, height: 10 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: NaN, height: 10 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: 10, height: -Infinity }).valid).toBe(false);
  });

  it('rejects negative x/y', () => {
    expect(isValidReferenceRegionRectangle({ x: -1, y: 0, width: 10, height: 10 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: -1, width: 10, height: 10 }).valid).toBe(false);
  });

  // Behavior I: zero-size region rejected. Negative width/height rejected too.
  it('rejects zero and negative width/height', () => {
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: 0, height: 10 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: 10, height: 0 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: -5, height: 10 }).valid).toBe(false);
    expect(isValidReferenceRegionRectangle({ x: 0, y: 0, width: 10, height: -5 }).valid).toBe(false);
  });

  it('accepts a valid region id/rectangle pair, and rejects a missing/empty id', () => {
    expect(isValidReferenceRegion(region('current-page-card', 0, 0, 10, 10))).toEqual({ valid: true });
    expect(isValidReferenceRegion({ rectangle: { x: 0, y: 0, width: 10, height: 10 } }).valid).toBe(false);
    expect(isValidReferenceRegion({ id: '', rectangle: { x: 0, y: 0, width: 10, height: 10 } }).valid).toBe(false);
  });

  it('rejects an id with unsupported characters or over the length bound', () => {
    expect(isValidReferenceRegion(region('bad id!', 0, 0, 10, 10)).valid).toBe(false);
    expect(isValidReferenceRegion(region('a'.repeat(65), 0, 0, 10, 10)).valid).toBe(false);
    expect(isValidReferenceRegion(region('a'.repeat(64), 0, 0, 10, 10)).valid).toBe(true);
  });

  // Behavior B: multiple valid regions accepted.
  it('accepts multiple valid, non-overlapping-by-id regions within image bounds', () => {
    const regions = [region('header', 0, 0, 100, 40), region('current-page-card', 28, 92, 424, 82)];
    expect(isValidReferenceRegions(regions, 800, 600)).toEqual({ valid: true });
  });

  // Duplicate region ID rejected, case-insensitively (mirrors target-name dedup convention).
  it('rejects duplicate region ids, case-insensitively', () => {
    const regions = [region('Header', 0, 0, 10, 10), region('header', 20, 20, 10, 10)];
    expect(isValidReferenceRegions(regions, 800, 600).valid).toBe(false);
  });

  // Behavior H: out-of-bounds region rejected, no silent clipping.
  it('rejects a region extending outside the image bounds, and accepts one exactly at the boundary', () => {
    const outOfBounds = [region('overflow', 750, 0, 100, 50)];
    expect(isValidReferenceRegions(outOfBounds, 800, 600).valid).toBe(false);

    const atBoundary = [region('exact', 700, 500, 100, 100)];
    expect(isValidReferenceRegions(atBoundary, 800, 600)).toEqual({ valid: true });
  });

  // Behavior K: region limit is a bounded explicit failure, not partial silent acceptance.
  it('accepts exactly MAX_REFERENCE_REGIONS and rejects one over', () => {
    const maxRegions = Array.from({ length: MAX_REFERENCE_REGIONS }, (_, i) => region(`r${i}`, i, 0, 1, 1));
    expect(isValidReferenceRegions(maxRegions, 1000, 1000)).toEqual({ valid: true });

    const overMax = [...maxRegions, region('one-more', MAX_REFERENCE_REGIONS, 0, 1, 1)];
    expect(isValidReferenceRegions(overMax, 1000, 1000).valid).toBe(false);
  });

  it('rejects a non-array regions value and a non-object region entry', () => {
    expect(isValidReferenceRegions({ id: 'x' }, 100, 100).valid).toBe(false);
    expect(isValidReferenceRegions(['not-an-object'], 100, 100).valid).toBe(false);
  });

  // Immutability: validation never mutates the input.
  it('never mutates the input regions array or its entries', () => {
    const regions = [region('a', 0, 0, 10, 10)];
    const snapshot = JSON.parse(JSON.stringify(regions));
    isValidReferenceRegions(regions, 100, 100);
    expect(regions).toEqual(snapshot);
  });
});
