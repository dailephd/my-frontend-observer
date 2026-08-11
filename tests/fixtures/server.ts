import { createServer, type Server } from 'node:http';

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
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
  <header id="header">Site Header</header>
  <nav id="nav" aria-label="Primary"><a href="#home">Home</a></nav>
  <main id="main"><div id="main-content">workspace content</div></main>
  <footer id="footer">Site Footer</footer>
  <button id="cta-button" type="button">Submit</button>
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
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';

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
  };
}
