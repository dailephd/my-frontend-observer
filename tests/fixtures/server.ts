import { createServer, type Server } from 'node:http';

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
  /**
   * v0.2 Batch 3: test-only, in-process, synchronous control over the
   * `/disappearing` route's served content - lets a test prove actual
   * runtime target disappearance (same URL, same request, second
   * observation finds nothing) without the observer itself ever mutating
   * anything. Defaults to `true` (target present) on every fresh server.
   */
  setDisappearingTargetPresent: (present: boolean) => void;
}

/**
 * Deterministic geometry for `#cta-button` in the `/observation` fixture
 * below: absolutely positioned against the (unscrolled) viewport, so
 * `getBoundingClientRect()` always returns these exact values regardless of
 * platform font metrics or scrollbar rendering.
 */
export const OBSERVATION_FIXTURE_BUTTON_GEOMETRY = { x: 20, y: 500, width: 120, height: 32, right: 140, bottom: 532 };

/** Selectors exposed by the `/observation` fixture, for use by Batch 3 browser tests. */
export const OBSERVATION_FIXTURE_SELECTORS = {
  header: '#header',
  nav: '#nav',
  main: '#main',
  footer: '#footer',
  button: '#cta-button',
  hidden: '#hidden-target',
  duplicate: '.duplicate-item',
  missing: '#does-not-exist',
} as const;

/** v0.2 Batch 2: role/accessible-name locator fixture cases. */
export const OBSERVATION_FIXTURE_ROLE = {
  navRole: 'navigation',
  navName: 'Primary',
  buttonRole: 'button',
  buttonName: 'Submit',
  missingRole: 'alert',
  duplicateRole: 'button',
  duplicateName: 'Duplicate Button',
} as const;

/** v0.2 Batch 2: exact-`id` locator fixture cases. */
export const OBSERVATION_FIXTURE_IDS = {
  header: 'header',
  button: 'cta-button',
  hidden: 'hidden-target',
  workspaceRegion: 'workspace-region',
  missing: 'does-not-exist-id',
  duplicate: 'duplicate-id',
} as const;

/** v0.2 Batch 2: exact `data-*` attribute/value locator fixture cases. */
export const OBSERVATION_FIXTURE_DATA_ATTRIBUTE = {
  attribute: 'data-region',
  uniqueValue: 'workspace',
  missingValue: 'no-such-region',
  duplicateValue: 'duplicate-region',
} as const;

/** v0.2 Batch 2: semantic-element locator fixture cases (tags from the Batch 1 frozen set). */
export const OBSERVATION_FIXTURE_SEMANTIC_ELEMENT = {
  uniqueTag: 'aside',
  missingTag: 'dialog',
  duplicateTag: 'article',
} as const;

/** v0.2 Batch 2: exact-text locator fixture cases. */
export const OBSERVATION_FIXTURE_TEXT = {
  unique: 'Distinctive Exact Text',
  missing: 'Text That Does Not Appear Anywhere',
  duplicate: 'Duplicate Text',
} as const;

/** v0.2 Batch 3: configured-target-only DOM containment fixture regions. */
export const OBSERVATION_FIXTURE_CONTAINMENT = {
  appShell: 'app-shell',
  header: 'header',
  primaryNavigation: 'nav',
  mainContent: 'main-content',
  toolWorkspace: 'tool-workspace',
  footer: 'footer',
} as const;

/** v0.2 Batch 3: bounded semantic-state fixture cases (disabled/expanded/checked/selected/pressed/current). */
export const OBSERVATION_FIXTURE_SEMANTIC_STATE = {
  disabledButton: 'disabled-btn',
  enabledButton: 'enabled-btn',
  expandedButton: 'expanded-btn',
  collapsedButton: 'collapsed-btn',
  checkedCheckbox: 'checked-checkbox',
  uncheckedCheckbox: 'unchecked-checkbox',
  mixedCheckbox: 'mixed-checkbox',
  selectedOption: 'selected-option',
  unselectedOption: 'unselected-option',
  pressedButton: 'pressed-btn',
  unpressedButton: 'unpressed-btn',
  mixedPressedButton: 'mixed-pressed-btn',
  currentLink: 'current-link',
  noncurrentLink: 'noncurrent-link',
  plainDiv: 'plain-div',
} as const;

/** v0.2 Batch 3: same URL, same request - the target present at `/disappearing` until the test flips {@link FixtureServer.setDisappearingTargetPresent}. */
export const OBSERVATION_DISAPPEARING_FIXTURE_SELECTOR = '#disappearing-target';

/**
 * v0.3 Batch 2/3: deterministic fixture for the `/scroll` route. `body` is
 * 3000x3000px against an 800x600 test viewport, giving real, measurable
 * horizontal and vertical document overflow. `#above-target` starts inside
 * the viewport and leaves it after a large downward scroll; `#below-target`
 * starts below the viewport and enters it. `#no-overflow-box` deliberately
 * declares `overflow: auto` while its content fits exactly, proving actual
 * dimensional overflow is measured, never inferred from the CSS declaration
 * alone (also reused as Batch 3's non-scrollable `target-scroll-by` action
 * target). `#hidden-scroll-target` is `display: none`, for the hidden-vs-
 * offscreen viewport-relation case (also reused as Batch 3's hidden action
 * target). `#nested-v-container`/`#nested-h-container` are Batch 3's
 * independently-scrollable nested containers - each with its own
 * `overflow: auto` and content taller/wider than its own box, entirely
 * separate from the document's own scroll position.
 */
export const SCROLL_FIXTURE_SELECTORS = {
  aboveTarget: '#above-target',
  belowTarget: '#below-target',
  hiddenTarget: '#hidden-scroll-target',
  noOverflowBox: '#no-overflow-box',
  nestedVerticalContainer: '#nested-v-container',
  nestedVerticalChild: '#nested-v-child',
  nestedHorizontalContainer: '#nested-h-container',
  duplicateScrollTarget: '.duplicate-scroll-target',
  missingScrollTarget: '#does-not-exist-scroll-target',
} as const;

/** `above-target`'s initial (unscrolled) viewport-relative geometry against the fixture's own CSS. */
export const SCROLL_FIXTURE_ABOVE_TARGET_INITIAL_TOP = 20;
/** `below-target`'s initial (unscrolled) viewport-relative `top`, chosen to sit below an 800x600 test viewport. */
export const SCROLL_FIXTURE_BELOW_TARGET_INITIAL_TOP = 1400;
/** Total scrollable document height/width for the `/scroll` fixture body. */
export const SCROLL_FIXTURE_DOCUMENT_SIZE = 3000;

/** `#nested-v-container`'s own box size and total scrollable content height (independent of the document's own 3000x3000 scroll range). */
export const SCROLL_FIXTURE_NESTED_V_CONTAINER = { width: 300, height: 200 };
export const SCROLL_FIXTURE_NESTED_V_CONTENT_HEIGHT = 1000;
/** `#nested-v-child`'s offset from the top of `#nested-v-content`, chosen so the child sits below the browser viewport at container.scrollTop=0 and inside it once the container scrolls far enough. */
export const SCROLL_FIXTURE_NESTED_V_CHILD_CONTENT_OFFSET_TOP = 600;
export const SCROLL_FIXTURE_NESTED_V_CONTAINER_TOP = 20;
export const SCROLL_FIXTURE_NESTED_V_CONTAINER_LEFT = 200;

/** `#nested-h-container`'s own box size and total scrollable content width. */
export const SCROLL_FIXTURE_NESTED_H_CONTAINER = { width: 200, height: 100 };
export const SCROLL_FIXTURE_NESTED_H_CONTENT_WIDTH = 1000;

const SCROLL_FIXTURE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>scroll fixture</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { width: ${SCROLL_FIXTURE_DOCUMENT_SIZE}px; height: ${SCROLL_FIXTURE_DOCUMENT_SIZE}px; }
  #above-target { position: absolute; top: ${SCROLL_FIXTURE_ABOVE_TARGET_INITIAL_TOP}px; left: 20px; width: 100px; height: 50px; background: #eee; }
  #below-target { position: absolute; top: ${SCROLL_FIXTURE_BELOW_TARGET_INITIAL_TOP}px; left: 20px; width: 100px; height: 50px; background: #ccc; }
  #hidden-scroll-target { display: none; }
  #no-overflow-box { position: absolute; top: 2000px; left: 20px; width: 200px; height: 100px; overflow: auto; }
  #no-overflow-content { width: 100px; height: 50px; }
  #nested-v-container {
    position: absolute;
    top: ${SCROLL_FIXTURE_NESTED_V_CONTAINER_TOP}px;
    left: ${SCROLL_FIXTURE_NESTED_V_CONTAINER_LEFT}px;
    width: ${SCROLL_FIXTURE_NESTED_V_CONTAINER.width}px;
    height: ${SCROLL_FIXTURE_NESTED_V_CONTAINER.height}px;
    overflow: auto;
    margin: 0;
    padding: 0;
    border: 0;
  }
  #nested-v-content { width: 280px; height: ${SCROLL_FIXTURE_NESTED_V_CONTENT_HEIGHT}px; margin: 0; padding: 0; }
  #nested-v-spacer { height: ${SCROLL_FIXTURE_NESTED_V_CHILD_CONTENT_OFFSET_TOP}px; }
  #nested-v-child { width: 100px; height: 50px; background: #ddd; }
  #nested-h-container {
    position: absolute;
    top: 250px;
    left: ${SCROLL_FIXTURE_NESTED_V_CONTAINER_LEFT}px;
    width: ${SCROLL_FIXTURE_NESTED_H_CONTAINER.width}px;
    height: ${SCROLL_FIXTURE_NESTED_H_CONTAINER.height}px;
    overflow: auto;
    margin: 0;
    padding: 0;
    border: 0;
  }
  #nested-h-content { width: ${SCROLL_FIXTURE_NESTED_H_CONTENT_WIDTH}px; height: 80px; margin: 0; padding: 0; }
  .duplicate-scroll-target { position: absolute; top: 400px; left: 500px; width: 40px; height: 20px; }
</style>
</head>
<body>
  <div id="above-target">Above</div>
  <div id="below-target">Below</div>
  <div id="hidden-scroll-target">Hidden</div>
  <div id="no-overflow-box"><div id="no-overflow-content"></div></div>
  <div id="nested-v-container">
    <div id="nested-v-content">
      <div id="nested-v-spacer"></div>
      <div id="nested-v-child">Nested Child</div>
    </div>
  </div>
  <div id="nested-h-container">
    <div id="nested-h-content">Wide nested content</div>
  </div>
  <div class="duplicate-scroll-target">Dup A</div>
  <div class="duplicate-scroll-target">Dup B</div>
</body>
</html>`;

const OBSERVATION_FIXTURE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>observation fixture</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { width: 2000px; height: 1200px; }
  #header { width: 800px; height: 60px; background: #eee; }
  #nav { width: 800px; height: 40px; }
  #main { width: 800px; height: 300px; overflow-x: hidden; overflow-y: auto; }
  #main-content { width: 1600px; height: 900px; }
  #footer { width: 800px; height: 50px; overflow-x: hidden; overflow-y: scroll; }
  #cta-button { position: absolute; top: 500px; left: 20px; width: 120px; height: 32px; }
  #hidden-target { display: none; }
</style>
</head>
<body>
  <div id="app-shell">
    <header id="header">Site Header</header>
    <nav id="nav" aria-label="Primary"><a href="#home">Home</a></nav>
    <main id="main"><div id="main-content"><div id="tool-workspace">Workspace Tool</div></div></main>
    <footer id="footer">Site Footer</footer>
  </div>
  <button id="cta-button" type="button">Submit</button>
  <button id="disabled-btn" disabled>Disabled Button</button>
  <button id="enabled-btn">Enabled Button</button>
  <button id="expanded-btn" aria-expanded="true">Expanded Button</button>
  <button id="collapsed-btn" aria-expanded="false">Collapsed Button</button>
  <input id="checked-checkbox" type="checkbox" checked aria-label="Checked checkbox">
  <input id="unchecked-checkbox" type="checkbox" aria-label="Unchecked checkbox">
  <div id="mixed-checkbox" role="checkbox" aria-checked="mixed" tabindex="0">Mixed Checkbox</div>
  <div id="selected-option" role="option" aria-selected="true">Selected Option</div>
  <div id="unselected-option" role="option" aria-selected="false">Unselected Option</div>
  <button id="pressed-btn" aria-pressed="true">Pressed Toggle</button>
  <button id="unpressed-btn" aria-pressed="false">Unpressed Toggle</button>
  <button id="mixed-pressed-btn" aria-pressed="mixed">Mixed Toggle</button>
  <a id="current-link" href="#current" aria-current="page">Current Link</a>
  <a id="noncurrent-link" href="#noncurrent">Noncurrent Link</a>
  <div id="plain-div">Plain div, no special semantics</div>
  <div class="duplicate-item">Item A</div>
  <div class="duplicate-item">Item B</div>
  <div id="hidden-target">Hidden content</div>
  <div id="workspace-region" data-region="workspace">Workspace</div>
  <div data-region="duplicate-region">Duplicate Region A</div>
  <div data-region="duplicate-region">Duplicate Region B</div>
  <aside id="sidebar">Sidebar</aside>
  <article>Article A</article>
  <article>Article B</article>
  <p id="exact-text-target">Distinctive Exact Text</p>
  <p>Duplicate Text</p>
  <p>Duplicate Text</p>
  <button type="button">Duplicate Button</button>
  <button type="button">Duplicate Button</button>
  <span id="duplicate-id">Duplicate ID A</span>
  <span id="duplicate-id">Duplicate ID B</span>
</body>
</html>`;

/**
 * One deterministic loopback-only HTTP server for Batch 2 browser fixtures.
 * Every route is bounded and local: no real outbound network I/O ever
 * happens, since the adapter's safety enforcement aborts any request to
 * "example.invalid" (RFC 2606 reserved, guaranteed non-resolving) before
 * Playwright would otherwise attempt it.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  let disappearingTargetPresent = true;

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/disappearing') {
      res.writeHead(200, { 'content-type': 'text/html' });
      const body = disappearingTargetPresent
        ? '<div id="disappearing-target">Present</div>'
        : '<div id="still-here">The disappearing target is gone from this response.</div>';
      res.end(`<!doctype html><html><head><title>disappearing fixture</title></head><body>${body}</body></html>`);
      return;
    }

    if (url === '/normal') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>normal fixture</title></head><body><h1>normal</h1></body></html>');
      return;
    }

    if (url === '/redirect-remote') {
      res.writeHead(302, { location: 'http://example.invalid/remote-target' });
      res.end();
      return;
    }

    if (url === '/subresource-remote') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body><img src="http://example.invalid/pixel.png" alt=""></body></html>');
      return;
    }

    if (url === '/hang') {
      // Intentionally never responds: proves finite, bounded readiness-timeout behavior.
      return;
    }

    if (url === '/connection-reset') {
      // Destroys the TCP connection without sending any response: a deterministic,
      // fixture-owned way to trigger a genuine navigation failure (distinct from a
      // readiness timeout and from a pre-launch safety rejection).
      req.socket.destroy();
      return;
    }

    if (url === '/observation') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(OBSERVATION_FIXTURE_HTML);
      return;
    }

    if (url === '/scroll') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(SCROLL_FIXTURE_HTML);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server failed to bind a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    setDisappearingTargetPresent: (present: boolean) => {
      disappearingTargetPresent = present;
    },
  };
}
