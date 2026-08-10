# Commands

## Product command surface

No product observation command is implemented. The starter-profile package bin
builds from `src/cli.ts`, prints that roadmap v0.1 is not implemented, and exits
with status 1. It does not accept URLs, viewports, targets, or output paths.

## Foundation commands

- `npm install` — install current scaffold development dependencies.
- `npm run typecheck` — run TypeScript no-emit checking.
- `npm run lint` — lint the retained scaffold and scripts.
- `npm test` — run Vitest with no tests expected in the corrected foundation.
- `npm run build` — clean and compile the placeholder CLI/library entries.
- `npm run check:docs` — validate canonical documents and roadmap structure.
- `npm pack --dry-run` — inspect the private package inventory without
  publishing.

The historical `observe` and `test:browser` scripts were removed with the
premature v0.1 implementation.
