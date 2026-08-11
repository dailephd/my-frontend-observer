import type { Page, Locator, ElementHandle } from 'playwright';
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
  TargetSemanticState,
  TargetLandmarkRole,
  TargetContainment,
} from '../domain/schema.js';
import { TARGET_LANDMARK_ROLES } from '../domain/schema.js';

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
  // No trailing `$` anchor: an element with no accessible name still produces
  // a role line with unquoted trailing content (e.g. `- banner: Site Header`,
  // verified empirically against real Chromium), which must still yield the
  // role even though there is no quoted, genuinely-computed accessible name
  // to report - trailing unquoted text is never treated as a name.
  const match = /^-\s+([A-Za-z][\w-]*)\s*(?:"([^"]*)")?:?/.exec(firstLine);
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

/** Builds the shared unresolved-target evidence record (not-found/ambiguous/unavailable) with the full ordered attempt history and no selected locator. Containment is reported separately by the caller (its own "self unresolved" reason differs from the measurement-unavailable reason used here). */
function unresolvedTargetRecord(
  selectionStatus: TargetResolution['selectionStatus'],
  attempts: TargetLocatorAttempt[],
  reason: string,
  containment: EvidenceField<TargetContainment>,
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
    semanticState: unavailableField(reason),
    landmark: unavailableField(reason),
    containment,
  };
}

const TARGET_LANDMARK_ROLE_SET = new Set<string>(TARGET_LANDMARK_ROLES);

/**
 * Reads the resolved element's own native form-control properties and
 * explicit `aria-*` attributes: bounded, target-local browser/ARIA state.
 * `ariaSnapshot()`'s bracket annotations were verified empirically (real
 * Chromium via the installed Playwright 1.62.1) to appear only for
 * true/mixed values - they cannot distinguish an explicit false from "not
 * applicable to this element", and they never expose `aria-current` at all.
 * This direct property/attribute read is the investigated, honest
 * alternative for exactly those two gaps; it still reads only real
 * browser-native/ARIA semantics (never class names, CSS, text content, or
 * source ownership). A key is present in the result only when the browser
 * exposes that state as applicable to this specific element.
 */
async function captureSemanticState(handle: ElementHandle<Element>): Promise<TargetSemanticState> {
  return handle.evaluate((el: Element) => {
    const result: Record<string, unknown> = {};

    const ariaDisabled = el.getAttribute('aria-disabled');
    const nativeDisabled = 'disabled' in el ? Boolean((el as unknown as { disabled?: boolean }).disabled) : false;
    if (nativeDisabled || ariaDisabled !== null) result.disabled = nativeDisabled || ariaDisabled === 'true';

    const ariaExpanded = el.getAttribute('aria-expanded');
    if (ariaExpanded !== null) result.expanded = ariaExpanded === 'true';

    const ariaChecked = el.getAttribute('aria-checked');
    const isNativeCheckable = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
    if (ariaChecked !== null) {
      result.checked = ariaChecked === 'mixed' ? 'mixed' : ariaChecked === 'true';
    } else if (isNativeCheckable) {
      result.checked = el.indeterminate ? 'mixed' : el.checked;
    }

    const ariaSelected = el.getAttribute('aria-selected');
    if (ariaSelected !== null) result.selected = ariaSelected === 'true';

    const ariaPressed = el.getAttribute('aria-pressed');
    if (ariaPressed !== null) result.pressed = ariaPressed === 'mixed' ? 'mixed' : ariaPressed === 'true';

    const ariaCurrent = el.getAttribute('aria-current');
    if (ariaCurrent !== null && ariaCurrent !== 'false' && ariaCurrent.length > 0) {
      result.current = ariaCurrent === 'true' ? true : ariaCurrent;
    }

    return result;
  }) as Promise<TargetSemanticState>;
}

/** Wraps the raw captured state: an empty object means no supported state applies to this target ("not-applicable"), never an unexplained empty available value. */
function semanticStateEvidence(raw: TargetSemanticState): EvidenceField<TargetSemanticState> {
  if (Object.keys(raw).length === 0) {
    return { state: 'not-applicable', reason: 'no supported semantic state is exposed for this target' };
  }
  return { state: 'available', source: 'computed-browser', value: raw };
}

/** Derives landmark identity from the already-captured browser-exposed role only - never from locator kind or HTML tag (Section 15). */
function landmarkEvidence(role: string | undefined): EvidenceField<TargetLandmarkRole> {
  if (role === undefined) return unavailableField('no distinct accessible role is exposed for this target');
  if (TARGET_LANDMARK_ROLE_SET.has(role)) {
    return { state: 'available', source: 'derived', value: role as TargetLandmarkRole, derivedFrom: ['semantics.role'] };
  }
  return { state: 'not-applicable', reason: `role "${role}" is not a recognized landmark role` };
}

/**
 * Wraps a computed configured-target-only containment result into the
 * persisted EvidenceField. `selfUnresolvedReason` covers the case where the
 * current target itself never resolved (Section 18: containment is
 * `unavailable`, not partial, when there is no resolved element to check
 * containment for). A computed result with any `unresolvedTargetIds` is
 * `partial` (already-proven relationships are preserved, never dropped);
 * with none, it is `available`.
 */
function containmentEvidence(computed: TargetContainment | undefined, selfUnresolvedReason: string | undefined): EvidenceField<TargetContainment> {
  if (selfUnresolvedReason !== undefined) return { state: 'unavailable', reason: selfUnresolvedReason };
  if (!computed) return { state: 'unavailable', reason: 'containment could not be computed' };
  if (computed.unresolvedTargetIds.length > 0) {
    return {
      state: 'partial',
      source: 'browser',
      value: computed,
      reason: `containment could not be evaluated against: ${computed.unresolvedTargetIds.join(', ')}`,
    };
  }
  return { state: 'available', source: 'browser', value: computed };
}

/**
 * Captures the full target evidence for one resolved (single-match) target
 * element, from the same live page/readiness state as the page evidence and
 * screenshot: tag/geometry/style/layout/visibility (v0.1), role/name
 * semantics (v0.1, via `ariaSnapshot()`), and semantic state/landmark
 * (Batch 3). Takes an already-resolved `{ locator, handle }` pair - not a
 * raw CSS selector, and never re-resolves - so every locator kind converges
 * on this one measurement path and containment (computed once by the caller
 * across every resolved target before this runs) is simply passed through.
 */
async function captureResolvedTargetRecord(
  target: Locator,
  handle: ElementHandle<Element>,
  attempts: TargetLocatorAttempt[],
  selectedLocatorIndex: number,
  containment: EvidenceField<TargetContainment>,
): Promise<{ record: TargetEvidenceRecord; visible: boolean }> {
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
  let resolvedRole: string | undefined;
  try {
    const snapshot = await target.ariaSnapshot();
    const parsed = parseAriaSnapshotFirstLine(snapshot);
    semantics = parsed ? computedField(parsed) : unavailableField('no distinct accessible role/name is exposed for this target');
    resolvedRole = parsed?.role;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    semantics = unavailableField(`accessibility snapshot failed: ${message}`);
  }

  let semanticState: EvidenceField<TargetSemanticState>;
  try {
    semanticState = semanticStateEvidence(await captureSemanticState(handle));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    semanticState = unavailableField(`semantic-state evaluation failed: ${message}`);
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
      semanticState,
      landmark: landmarkEvidence(resolvedRole),
      containment,
    },
    visible,
  };
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

interface ResolvedTargetInfo {
  name: string;
  attempts: TargetLocatorAttempt[];
  status: TargetResolution['selectionStatus'];
  selectedIndex?: number;
  locator?: Locator;
  handle?: ElementHandle<Element>;
  unavailableReason?: string;
}

/**
 * Observes every explicitly configured target from the same live page,
 * honoring the frozen ordered-locator resolution contract: 0 matches tries
 * the next locator; exactly 1 match selects and stops; more than 1 match is
 * ambiguous and stops (never falls through); an unevaluable locator is
 * unavailable and stops (never falls through). Ambiguity never triggers
 * fallback.
 *
 * Batch 3 restructures this into three phases over one resolved set: (1)
 * resolve every configured target exactly once, keeping a live
 * `{locator, handle}` for each match; (2) compute bounded pairwise DOM
 * containment among only the resolved configured targets, reusing those
 * same handles (never re-resolving, never a second/independent resolution
 * algorithm); (3) measure every resolved target and assemble its evidence,
 * attaching the phase-2 containment result. Every handle is disposed once,
 * after all three phases, regardless of outcome.
 */
export async function captureTargetEvidence(page: Page, targets: readonly NamedTarget[]): Promise<TargetEvidenceCaptureResult> {
  const targetEvidence: Record<string, TargetEvidenceRecord> = {};
  const diagnostics: Diagnostic[] = [];
  const infos: ResolvedTargetInfo[] = [];

  // Phase 1: resolve every configured target exactly once.
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
        const handles = await matchedPlaywrightLocator.elementHandles();
        const handle = handles[0];
        if (handle) {
          infos.push({
            name: target.name,
            attempts,
            status: 'matched',
            selectedIndex: matchedIndex,
            locator: matchedPlaywrightLocator,
            handle: handle as ElementHandle<Element>,
          });
        } else {
          infos.push({ name: target.name, attempts, status: 'not-found' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        infos.push({ name: target.name, attempts, status: 'unavailable', unavailableReason: `target evaluation failed: ${message}` });
      }
    } else if (stopStatus === 'ambiguous') {
      infos.push({ name: target.name, attempts, status: 'ambiguous' });
    } else if (stopStatus === 'unavailable') {
      infos.push({ name: target.name, attempts, status: 'unavailable' });
    } else {
      infos.push({ name: target.name, attempts, status: 'not-found' });
    }
  }

  try {
    // Phase 2: bounded pairwise DOM containment among the configured targets
    // only (never unconfigured ancestors), in configured target order.
    const containmentByName = new Map<string, EvidenceField<TargetContainment>>();
    for (const info of infos) {
      if (info.status !== 'matched' || !info.handle) continue;
      const selfHandle = info.handle;
      const containedByTargetIds: string[] = [];
      const evaluatedTargetIds: string[] = [];
      const unresolvedTargetIds: string[] = [];
      for (const other of infos) {
        if (other.name === info.name) continue;
        if (other.status === 'matched' && other.handle) {
          evaluatedTargetIds.push(other.name);
          const contains = await other.handle.evaluate((elOther: Element, elSelf: Element) => elOther !== elSelf && elOther.contains(elSelf), selfHandle);
          if (contains) containedByTargetIds.push(other.name);
        } else {
          unresolvedTargetIds.push(other.name);
        }
      }
      containmentByName.set(info.name, containmentEvidence({ containedByTargetIds, evaluatedTargetIds, unresolvedTargetIds }, undefined));
    }

    // Phase 3: measure resolved targets and assemble every target's evidence.
    for (const info of infos) {
      if (info.status === 'matched' && info.locator && info.handle && info.selectedIndex !== undefined) {
        try {
          const containment = containmentByName.get(info.name) ?? containmentEvidence(undefined, 'containment could not be computed');
          const { record, visible } = await captureResolvedTargetRecord(info.locator, info.handle, info.attempts, info.selectedIndex, containment);
          targetEvidence[info.name] = record;
          if (!visible) {
            diagnostics.push(diagnostic('target-hidden', `target "${info.name}" resolved but is not visible`, info.name));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const reason = `target evaluation failed: ${message}`;
          targetEvidence[info.name] = unresolvedTargetRecord(
            'unavailable',
            info.attempts,
            reason,
            containmentEvidence(undefined, `target itself could not be measured: ${reason}`),
          );
          diagnostics.push(diagnostic('browser-evidence-unavailable', reason, info.name));
        }
        continue;
      }

      const selfUnresolvedReason = `target itself did not resolve (status: ${info.status})`;
      if (info.status === 'ambiguous') {
        const lastAttempt = info.attempts[info.attempts.length - 1];
        const matchCount = lastAttempt?.matchCount ?? 0;
        targetEvidence[info.name] = unresolvedTargetRecord(
          'ambiguous',
          info.attempts,
          `target locator matched ${matchCount} elements; expected exactly one`,
          containmentEvidence(undefined, selfUnresolvedReason),
        );
        diagnostics.push(diagnostic('target-ambiguous', `${matchCount} elements matched a locator for target "${info.name}"`, info.name));
      } else if (info.status === 'unavailable') {
        const reason = info.unavailableReason ?? `target locator could not be evaluated reliably for "${info.name}"`;
        targetEvidence[info.name] = unresolvedTargetRecord('unavailable', info.attempts, reason, containmentEvidence(undefined, selfUnresolvedReason));
        diagnostics.push(diagnostic('browser-evidence-unavailable', reason, info.name));
      } else {
        targetEvidence[info.name] = unresolvedTargetRecord(
          'not-found',
          info.attempts,
          'no configured locator matched an element',
          containmentEvidence(undefined, selfUnresolvedReason),
        );
        diagnostics.push(diagnostic('target-missing', `no locator matched an element for target "${info.name}"`, info.name));
      }
    }
  } finally {
    await Promise.all(infos.filter((info) => info.handle).map((info) => info.handle!.dispose()));
  }

  return { targetEvidence, diagnostics };
}
