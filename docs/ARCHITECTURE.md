# Architecture

## Current scaffold architecture

The current repository is one private TypeScript ESM package:

- `src/cli.ts` is a transparent not-implemented placeholder required by the
  TypeScript CLI starter profile and package bin.
- `src/index.ts` is an empty library entry-point placeholder required by the
  starter profile.
- `scripts/clean.mjs` safely removes only the project `dist/` directory.
- `scripts/check-docs.mjs` validates the canonical documentation foundation,
  roadmap version presence, and the no-batches rule.
- TypeScript, ESLint, Vitest, and package configuration provide foundation
  validation; no product tests currently exist.

There is no implemented observation engine, browser adapter, observation
domain/schema, target configuration, safety layer, artifact writer, or browser
fixture/test boundary.

## Planned v0.1 architecture constraints

v0.1 planning must preserve these approved boundaries without treating module
names from the historical run as mandatory:

```text
thin command-line boundary
        ↓
reusable observation engine/application layer
        ↓
browser automation boundary
        ↓
observer-owned runtime evidence

observer-owned domain/schema
        ↓
artifact ownership boundary

deterministic fixture/test boundary
        ↓
browser-level validation
```

Use one browser engine implementation, keep browser logic out of presentation,
avoid speculative plugin/multi-browser abstractions, and keep observed
applications external. Before v0.6, versions must not add runtime coupling to
sibling ecosystem projects. v0.6 may add only explicit bounded context,
correlation/export, orchestrator-consumption, and lab-compatibility contracts
while preserving independent ownership.

The text/config-driven coding-agent workflow must be operational before the
viewer and annotation layers are added. Those interfaces consume the same
canonical observation, relationship, comparison, contract, change-scope,
correlation, and context boundaries rather than creating parallel engines.
The concrete implementation plan and module layout must be designed only after
the relevant version planning workflow inspects the current repositories.
