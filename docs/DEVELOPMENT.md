# Development

Install the current scaffold with `npm install`. Node.js 24+ is required.

The applicable foundation validation chain is:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run check:docs
npm pack --dry-run
```

`npm test` currently reports no tests and succeeds because no product behavior
exists. There is no Playwright dependency or browser-test command in the
corrected foundation.

ROADMAP v0.1 and Project Milestone 1 require browser-level validation once the
observation capability is planned and implemented. Static checks must not later
be substituted for that required browser evidence.
