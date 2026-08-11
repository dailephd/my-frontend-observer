import type { Page, Locator } from 'playwright';
import type { EvidenceField } from '../domain/evidence.js';
import type { Diagnostic, DiagnosticCode } from '../domain/diagnostics.js';
import { DIAGNOSTIC_SEVERITY } from '../domain/diagnostics.js';
import type { NamedTarget, TargetLocator, Viewport } from '../request/request.js';
import type {
  TargetEvidenceRecord,
  TargetGeometry,
  TargetComputedStyle,
  TargetLayoutMetrics,
  TargetLocatorAttempt,
  TargetResolution,
} from '../domain/schema.js';

function diagnostic(code: DiagnosticCode, message: string, targetName?: string): Diagnostic {
  const base: Diagnostic = { code, severity: DIAGNOSTIC_SEVERITY[code], message };
  return targetName === undefined ? base : { ...base, targetName };
}

function browserField<T>(value: T): EvidenceField<T> {
  return { state: 'available', source: 'browser', value };
}

function derivedField<T>(value: T, derivedFrom: string[]): EvidenceField<T> {
  return { state: 'available', source: 'derived', value, derivedFrom };
}

function computedField<T>(value: T): EvidenceField<T> {
  return { state: 'available', source: 'computed-browser', value };
}

function unavailableField<T>(reason: string): EvidenceField<T> {
  return { state: 'unavailable', reason };
}

interface RawDocumentMetrics {
  title: string;
  windowScrollX: number;
  windowScrollY: number;
  documentScrollWidth: number;
  documentScrollHeight: number;
  documentClientWidth: number;
  documentClientHeight: number;
}

/**
 * Captures the v0.1 minimum page evidence (docs/PROJECT_MILESTONES.md
 * "Minimum page evidence") from the already-navigated, already-ready page.
 * `documentWidth`/`documentHeight` are the one explicitly *derived* pair -
 * max(scroll, client) in each axis - everything else is a direct browser
 * read, per the Batch 1 evidence-source model.
 */
export async function capturePageEvidence(
  page: Page,
  requestedUrl: string,
  viewport: Viewport,
): Promise<Record<string, EvidenceField<unknown>>> {
  const raw: RawDocumentMetrics = await page.evaluate(() => ({
    title: document.title,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentScrollHeight: document.documentElement.scrollHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentClientHeight: document.documentElement.clientHeight,
  }));

  const documentWidth = Math.max(raw.documentScrollWidth, raw.documentClientWidth);
  const documentHeight = Math.max(raw.documentScrollHeight, raw.documentClientHeight);

  return {
    requestedUrl: browserField(requestedUrl),
    finalUrl: browserField(page.url()),
    title: browserField(raw.title),
    viewportWidth: browserField(viewport.width),
    viewportHeight: browserField(viewport.height),
    devicePixelRatio: browserField(await page.evaluate(() => window.devicePixelRatio)),
    documentScrollWidth: browserField(raw.documentScrollWidth),
    documentScrollHeight: browserField(raw.documentScrollHeight),
    documentClientWidth: browserField(raw.documentClientWidth),
    documentClientHeight: browserField(raw.documentClientHeight),
    documentWidth: derivedField(documentWidth, ['documentScrollWidth', 'documentClientWidth']),
    documentHeight: derivedField(documentHeight, ['documentScrollHeight', 'documentClientHeight']),
    windowScrollX: browserField(raw.windowScrollX),
    windowScrollY: browserField(raw.windowScrollY),
  };
}

/**
 * Extracts only the target element's own role/name from a Playwright
 * `ariaSnapshot()` string (e.g. `- button "Click me"`), never its
 * descendants - bounded, target-local semantic evidence, not an
 * accessibility-tree dump. A generic `- text: ...` line (no distinct ARIA
 * role) or an empty snapshot both mean "no reliable role/name", not a role
 * of "text".
 */
function parseAriaSnapshotFirstLine(snapshot: string): { role?: string; name?: string } | undefined {
  const firstLine = snapshot.split('\n')[0]?.trim();
  if (!firstLine) return undefined;
  const match = /^-\s+([A-Za-z][\w-]*)\s*(?:"([^"]*)")?:?$/.exec(firstLine);
  if (!match) return undefined;
  const role = match[1];
  const name = match[2];
  if (role === undefined || role === 'text') return undefined;
  return name !== undefined && name.length > 0 ? { role, name } : { role };
}

interface RawTargetMeasurement {
  tag: string;
  geometry: TargetGeometry;
  style: TargetComputedStyle;
  layout: TargetLayoutMetrics;
  computedVisibility: string;
}

/** Builds the shared unresolved-target evidence record (not-found/ambiguous/unavailable) with the full ordered attempt history and no selected locator. */
function unresolvedTargetRecord(
  selectionStatus: TargetResolution['selectionStatus'],
  attempts: TargetLocatorAttempt[],
  reason: string,
): TargetEvidenceRecord {
  const resolution: TargetResolution = {
    selectionMethod: 'ordered-locators',
    selectionStatus,
    usedFallback: false,
    confidence: 'none',
    attempts,
  };
  return {
    resolution: { state: 'available', source: 'derived', value: resolution, derivedFrom: ['locator-attempts'] },
    tag: unavailableField(reason),
    geometry: unavailableField(reason),
    style: unavailableField(reason),
    layout: unavailableField(reason),
    visibility: unavailableField(reason),
    semantics: unavailableField(reason),
  };
}

/**
 * Captures the v0.1 minimum target evidence for one resolved (single-match)
 * target element, from the same live page/readiness state as the page
 * evidence and screenshot. Role/name come from Playwright's real
 * accessibility tree (`page.accessibility.snapshot`), not a hand-rolled
 * approximation; when the browser cannot supply them reliably for this
 * element, they are reported `unavailable` rather than guessed. Takes a
 * resolved Playwright `Locator` rather than a raw CSS selector so every
 * locator kind (role/id/data-attribute/semantic-element/css/text) converges
 * on this one measurement path - there is no per-kind measurement function.
 */
async function captureResolvedTargetRecord(
  target: Locator,
  attempts: TargetLocatorAttempt[],
  selectedLocatorIndex: number,
): Promise<{ record: TargetEvidenceRecord; visible: boolean | undefined }> {
  // Already known to match exactly one element (the caller checked cardinality),
  // so elementHandles() resolves immediately without waiting for actionability.
  const handles = await target.elementHandles();
  const handle = handles[0];
  try {
    if (!handle) return { record: unresolvedTargetRecord('not-found', attempts, 'target locator matched no element'), visible: undefined };

    const raw: RawTargetMeasurement = await handle.evaluate((el: Element) => {
      const rect = el.getBoundingClientRect();
      const computed = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        geometry: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        style: { display: computed.display, position: computed.position, overflowX: computed.overflowX, overflowY: computed.overflowY },
        layout: {
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
        },
        computedVisibility: computed.visibility,
      };
    });

    const visible = raw.style.display !== 'none' && raw.computedVisibility !== 'hidden' && raw.geometry.width > 0 && raw.geometry.height > 0;

    let semantics: EvidenceField<{ role?: string; name?: string }>;
    try {
      const snapshot = await target.ariaSnapshot();
      const parsed = parseAriaSnapshotFirstLine(snapshot);
      semantics = parsed ? computedField(parsed) : unavailableField('no distinct accessible role/name is exposed for this target');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      semantics = unavailableField(`accessibility snapshot failed: ${message}`);
    }

    const resolution: TargetResolution = {
      selectionMethod: 'ordered-locators',
      selectionStatus: 'matched',
      selectedLocatorKind: attempts[selectedLocatorIndex]?.locatorKind ?? 'css',
      selectedLocatorIndex,
      usedFallback: selectedLocatorIndex > 0,
      confidence: 'exact',
      attempts,
    };

    return {
      record: {
        resolution: { state: 'available', source: 'derived', value: resolution, derivedFrom: ['locator-attempts'] },
        tag: browserField(raw.tag),
        geometry: browserField(raw.geometry),
        style: computedField(raw.style),
        layout: browserField(raw.layout),
        visibility: derivedField({ visible }, ['style.display', 'computed-visibility', 'geometry.width', 'geometry.height']),
        semantics,
      },
      visible,
    };
  } finally {
    await Promise.all(handles.map((h) => h.dispose()));
  }
}

export interface TargetEvidenceCaptureResult {
  targetEvidence: Record<string, TargetEvidenceRecord>;
  diagnostics: Diagnostic[];
}

interface LocatorAttemptOutcome {
  status: TargetLocatorAttempt['status'];
  matchCount?: number;
}

/**
 * A CSS quoted-string literal for an attribute selector value (`[attr="..."]`).
 * Only backslash and double-quote need escaping inside a CSS quoted string;
 * this keeps the configured id/data-attribute value literal - it is never
 * reinterpreted as selector syntax (e.g. a value containing `#`, `.`, `[`,
 * or `"` still matches exactly, it cannot escape the attribute-value
 * position it was placed in).
 */
function cssAttributeValueLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Maps one frozen v0.2 TargetLocator to the Playwright `Locator` that
 * resolves it - the single point where locator kind becomes a real browser
 * query. `role`/`text` use Playwright's own semantic locators (real
 * accessibility-tree/text resolution, not a hand-rolled approximation);
 * `id`/`data-attribute` use an exact CSS attribute-equals selector (never
 * `#id`/bare-value syntax, so the configured value can never be
 * reinterpreted as selector syntax); `semantic-element` uses a plain tag
 * selector from the Batch 1 frozen tag set; `css` is unchanged v0.1
 * behavior. Every kind converges on the same Playwright `Locator` type, so
 * cardinality/measurement downstream never branches on locator kind again.
 */
function buildPlaywrightLocator(page: Page, locator: TargetLocator): Locator {
  switch (locator.kind) {
    case 'css':
      return page.locator(locator.selector);
    case 'id':
      return page.locator(`[id=${cssAttributeValueLiteral(locator.value)}]`);
    case 'data-attribute':
      return page.locator(`[${locator.attribute}=${cssAttributeValueLiteral(locator.value)}]`);
    case 'semantic-element':
      return page.locator(locator.tag);
    case 'role':
      return page.getByRole(
        locator.role as Parameters<Page['getByRole']>[0],
        locator.name === undefined ? undefined : { name: locator.name, exact: true },
      );
    case 'text':
      return page.getByText(locator.text, { exact: true });
  }
}

/**
 * Evaluates one locator against the live page: builds its real Playwright
 * `Locator` and measures cardinality via `.count()` (no waiting, no
 * `.first()`/`.nth(0)` shortcut that would silently resolve an ambiguous
 * match). A locator that cannot be constructed or counted reliably is
 * `unavailable`, never silently treated as zero matches.
 */
async function evaluateLocatorAttempt(page: Page, locator: TargetLocator): Promise<{ playwrightLocator: Locator | undefined; outcome: LocatorAttemptOutcome }> {
  try {
    const playwrightLocator = buildPlaywrightLocator(page, locator);
    const matchCount = await playwrightLocator.count();
    if (matchCount === 0) return { playwrightLocator, outcome: { status: 'not-found', matchCount: 0 } };
    if (matchCount > 1) return { playwrightLocator, outcome: { status: 'ambiguous', matchCount } };
    return { playwrightLocator, outcome: { status: 'matched', matchCount: 1 } };
  } catch {
    return { playwrightLocator: undefined, outcome: { status: 'unavailable' } };
  }
}

/**
 * Observes every explicitly configured target from the same live page,
 * honoring the frozen ordered-locator resolution contract: 0 matches tries
 * the next locator; exactly 1 match selects and stops; more than 1 match is
 * ambiguous and stops (never falls through); an unevaluable locator is
 * unavailable and stops (never falls through). Ambiguity never triggers
 * fallback.
 */
export async function captureTargetEvidence(page: Page, targets: readonly NamedTarget[]): Promise<TargetEvidenceCaptureResult> {
  const targetEvidence: Record<string, TargetEvidenceRecord> = {};
  const diagnostics: Diagnostic[] = [];

  for (const target of targets) {
    const attempts: TargetLocatorAttempt[] = [];
    let stopStatus: 'matched' | 'ambiguous' | 'unavailable' | undefined;
    let matchedIndex: number | undefined;
    let matchedPlaywrightLocator: Locator | undefined;

    for (let index = 0; index < target.locators.length; index += 1) {
      const locator = target.locators[index] as TargetLocator;
      const { playwrightLocator, outcome } = await evaluateLocatorAttempt(page, locator);
      attempts.push({
        locatorIndex: index,
        locatorKind: locator.kind,
        status: outcome.status,
        ...(outcome.matchCount !== undefined ? { matchCount: outcome.matchCount } : {}),
      });

      if (outcome.status === 'matched' && playwrightLocator) {
        stopStatus = 'matched';
        matchedIndex = index;
        matchedPlaywrightLocator = playwrightLocator;
        break;
      }
      if (outcome.status === 'ambiguous') {
        stopStatus = 'ambiguous';
        break;
      }
      if (outcome.status === 'unavailable') {
        stopStatus = 'unavailable';
        break;
      }
      // 'not-found': fall through to the next configured locator.
    }

    if (stopStatus === 'matched' && matchedPlaywrightLocator && matchedIndex !== undefined) {
      try {
        const { record, visible } = await captureResolvedTargetRecord(matchedPlaywrightLocator, attempts, matchedIndex);
        targetEvidence[target.name] = record;
        if (visible === false) {
          diagnostics.push(diagnostic('target-hidden', `target "${target.name}" resolved but is not visible`, target.name));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason = `target evaluation failed: ${message}`;
        targetEvidence[target.name] = unresolvedTargetRecord('unavailable', attempts, reason);
        diagnostics.push(diagnostic('browser-evidence-unavailable', reason, target.name));
      }
      continue;
    }

    if (stopStatus === 'ambiguous') {
      const lastAttempt = attempts[attempts.length - 1];
      const matchCount = lastAttempt?.matchCount ?? 0;
      targetEvidence[target.name] = unresolvedTargetRecord('ambiguous', attempts, `target locator matched ${matchCount} elements; expected exactly one`);
      diagnostics.push(diagnostic('target-ambiguous', `${matchCount} elements matched a locator for target "${target.name}"`, target.name));
      continue;
    }

    if (stopStatus === 'unavailable') {
      const reason = `target locator could not be evaluated reliably for "${target.name}"`;
      targetEvidence[target.name] = unresolvedTargetRecord('unavailable', attempts, reason);
      diagnostics.push(diagnostic('browser-evidence-unavailable', reason, target.name));
      continue;
    }

    // Every configured locator was tried and none matched.
    targetEvidence[target.name] = unresolvedTargetRecord('not-found', attempts, 'no configured locator matched an element');
    diagnostics.push(diagnostic('target-missing', `no locator matched an element for target "${target.name}"`, target.name));
  }

  return { targetEvidence, diagnostics };
}
