/**
 * v0.7 Prompt 2 explicit reference-region geometry. A region is one
 * user/configuration-authored rectangle in the coordinate system of an
 * external reference image - origin at the image's top-left corner, x
 * increasing rightward, y increasing downward, unit is reference-image
 * pixels (never CSS pixels - this is a static image, not a rendered page).
 * Coordinates may be fractional. This module never infers a region from
 * pixel content: no OCR, no computer vision, no automatic segmentation.
 *
 * Only the rectangle {x, y, width, height} is canonical/authored; every
 * other geometric fact (right, bottom, centerX, centerY) is a pure
 * calculation over it (see deriveReferenceRegionGeometry) so that no
 * redundant, potentially-drifting copy of the same fact is ever persisted.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Same character/length convention as request/request.ts's target-name pattern (`^[A-Za-z0-9_-]{1,64}$`) - reused directly, not reinvented, for the same "stable, portable, log/path-safe identifier" reason. */
export const REFERENCE_REGION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Same numeric bound as request/request.ts's MAX_TARGETS (20) - a coincidentally equal, independently-owned constant: reference regions are design-authoring input, not runtime targets, so the two are not structurally coupled even though they share a value and the same "bound the O(n^2) pairwise-relationship explosion" rationale (see externalReferenceRegionRelationships.ts). */
export const MAX_REFERENCE_REGIONS = 20;

export interface ReferenceRegionRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReferenceRegion {
  id: string;
  rectangle: ReferenceRegionRectangle;
}

/** Pure derived geometry over one region's canonical rectangle - never persisted, always recomputed, so it can never drift from {x, y, width, height}. */
export interface ReferenceRegionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export function deriveReferenceRegionGeometry(rectangle: ReferenceRegionRectangle): ReferenceRegionGeometry {
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
    right: rectangle.x + rectangle.width,
    bottom: rectangle.y + rectangle.height,
    centerX: rectangle.x + rectangle.width / 2,
    centerY: rectangle.y + rectangle.height / 2,
  };
}

export type ReferenceRegionValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Structural + numeric validation of one rectangle only - does not know
 * about image bounds (see isValidReferenceRegions for the boundary check,
 * which needs the owning image's dimensions). Fails closed on non-finite,
 * negative, or zero width/height: authored design geometry is never
 * silently clamped into validity.
 */
export function isValidReferenceRegionRectangle(value: unknown): ReferenceRegionValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'rectangle must be an object' };
  if (!isFiniteNumber(value.x)) return { valid: false, reason: 'rectangle.x must be a finite number' };
  if (!isFiniteNumber(value.y)) return { valid: false, reason: 'rectangle.y must be a finite number' };
  if (!isFiniteNumber(value.width)) return { valid: false, reason: 'rectangle.width must be a finite number' };
  if (!isFiniteNumber(value.height)) return { valid: false, reason: 'rectangle.height must be a finite number' };
  if (value.x < 0) return { valid: false, reason: 'rectangle.x must not be negative' };
  if (value.y < 0) return { valid: false, reason: 'rectangle.y must not be negative' };
  if (value.width <= 0) return { valid: false, reason: 'rectangle.width must be greater than 0' };
  if (value.height <= 0) return { valid: false, reason: 'rectangle.height must be greater than 0' };
  return { valid: true };
}

export function isValidReferenceRegion(value: unknown): ReferenceRegionValidationResult {
  if (!isPlainObject(value)) return { valid: false, reason: 'region must be an object' };
  if (typeof value.id !== 'string' || value.id.length === 0) return { valid: false, reason: 'region.id must be a non-empty string' };
  if (!REFERENCE_REGION_ID_PATTERN.test(value.id)) return { valid: false, reason: `region.id "${value.id}" must match ${REFERENCE_REGION_ID_PATTERN}` };
  return isValidReferenceRegionRectangle(value.rectangle);
}

/**
 * Collection-level validation: bounded count, unique IDs (case-insensitive,
 * mirroring request/request.ts's target-name dedup convention), and every
 * region's rectangle contained within the owning image's own dimensions -
 * never silently clipped, rejected outright instead. `imageWidth`/
 * `imageHeight` come from the artifact's own already-validated image
 * metadata (ExternalReferenceImageReference or the approved artifact's
 * sourceReference.image), never re-parsed here.
 */
export function isValidReferenceRegions(value: unknown, imageWidth: number, imageHeight: number): ReferenceRegionValidationResult {
  if (!Array.isArray(value)) return { valid: false, reason: 'regions must be an array' };
  if (value.length > MAX_REFERENCE_REGIONS) return { valid: false, reason: `regions must contain at most ${MAX_REFERENCE_REGIONS} entries` };

  const seenIds = new Set<string>();
  for (const entry of value) {
    const regionValidation = isValidReferenceRegion(entry);
    if (!regionValidation.valid) return regionValidation;
    const region = entry as ReferenceRegion;

    const lowerId = region.id.toLowerCase();
    if (seenIds.has(lowerId)) return { valid: false, reason: `duplicate region id "${region.id}"` };
    seenIds.add(lowerId);

    const geometry = deriveReferenceRegionGeometry(region.rectangle);
    if (geometry.right > imageWidth || geometry.bottom > imageHeight) {
      return { valid: false, reason: `region "${region.id}" extends outside the reference image bounds (${imageWidth}x${imageHeight})` };
    }
  }
  return { valid: true };
}
