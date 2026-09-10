/**
 * v0.8 Batch 2: conservative, deterministic bounds for evidence-root
 * discovery. Chosen after inspecting every current persisted artifact family
 * (src/artifacts/*Writer.ts): every family writes exactly one
 * `<outputLocation>/<id>/manifest.json` (plus, for observation and imported
 * external-reference artifacts, one sibling media file in that same
 * directory) - a shallow, bounded shape that does not require deep
 * recursion. These bounds are generous relative to that real shape while
 * still refusing to become an unbounded filesystem crawl.
 */

/** Maximum directory levels traversed below the supplied evidence root (root itself is depth 0). Typical shapes (`<root>/observations/<id>/manifest.json`) need depth 2; this leaves slack for an intentionally nested `--output` without allowing unbounded recursion. */
export const MAX_DISCOVERY_DEPTH = 6;

/** Maximum number of directories visited during one discovery walk. */
export const MAX_DIRECTORIES_VISITED = 2000;

/** Maximum number of candidate `manifest.json` files inspected (classified) during one discovery walk. */
export const MAX_MANIFEST_CANDIDATES = 1000;

/** Maximum number of metadata records returned in one index response. */
export const MAX_INDEX_RECORDS = 500;

/**
 * Maximum bytes read from a candidate `manifest.json` before classification.
 * Every real persisted manifest is small (identity/geometry/config JSON only
 * - screenshots and reference images are always separate sibling files), so
 * 2,000,000 bytes is generous headroom for a legitimately large observation
 * (many targets/relationships) while refusing to read an arbitrarily large
 * file into memory just because it happens to be named `manifest.json`.
 */
export const MAX_MANIFEST_CANDIDATE_BYTES = 2_000_000;
