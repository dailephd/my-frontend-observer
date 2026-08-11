# Security

## Current controls

`my-frontend-observer` launches a real, sandboxed Chromium browser
(`src/browser/chromiumAdapter.ts`) and enforces a conservative, local-first,
credential-free, non-destructive browser/network boundary
(`src/safety/policy.ts`) as actual product behavior, covered by real-Chromium
tests:

- allowed schemes are `http`/`https` only;
- allowed hosts are loopback only (`localhost`, `127.0.0.1`, `::1`, and any
  `127.x.x.x` form) - no DNS resolution, no arbitrary "local dev host";
- credential-bearing URLs (`user:pass@host`) are rejected;
- the initial target, every navigation redirect, and every subresource
  request are independently classified against the same loopback policy and
  blocked before being contacted if unsafe;
- popups and downloads are never followed/saved (reported as non-fatal
  diagnostics);
- navigation and readiness are bounded by explicit, request-configured
  timeouts - no unbounded wait;
- the Chromium browser/context/page are reliably closed on every exit path
  (success, safety rejection, navigation/readiness failure, or an
  unexpected internal error);
- the observed target's own content/source is never modified by observation.

## Not yet addressed

Certificate-failure-specific handling, permission-prompt-specific handling
(Chromium's default deny-all applies; no permission is ever explicitly
granted), and any non-loopback/remote browsing mode remain unimplemented and
out of v0.1 scope. `my-frontend-observer@0.1.0` is published to npm, and a
pre-release readiness CI workflow (Windows/Linux/macOS packed-candidate
validation) already exists (see `docs/CI_CD.md`); these are no longer future
decisions. Those facts do not expand the security scope above: remote
browsing, certificate handling, and permission-prompt handling remain
separate, unimplemented concerns.
