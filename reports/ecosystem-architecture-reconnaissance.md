# Ecosystem Architecture Reconnaissance for `my-frontend-observer`

## 1. Executive Verdict

`READY_TO_PLAN_FRONTEND_OBSERVER_V0_1`

The existing ecosystem documentation supplies a coherent responsibility model, mature evidence conventions, compatibility practices, and clear integration boundaries. It strongly supports a separate runtime-observation producer rather than extending `my-dev-kit` or embedding browser observation into the orchestrator or lab.

The proposed first vertical slice remains sound, but its planning documents should be corrected before implementation to make evidence provenance, boundedness, schema evolution, diagnostic behavior, deterministic artifact identity, and browser/network safety explicit. The absence of a shared cross-repository schema package and a formal orchestrator stage for runtime evidence does not block v0.1; those are later integration questions for which v0.1 should preserve clean seams.

No source or test files were inspected. No full-file source/test fallback was needed.

## 2. Documentation Examined

The three `docs/` trees were inventoried first. Selection then followed each repository's own authority map: current-state overview and architecture documents first, schema/command documents for exact contracts, workflow and artifact documents for handoffs, and development/release documents for validation expectations. Roadmaps were used only for responsibility boundaries or explicit exclusions, not as proof of current implementation.

### `my-dev-kit-v1`

| Path | Relevance | Authority assessment |
|---|---|---|
| `docs/PROJECT_OVERVIEW.md` | Product purpose, public command families, generated artifacts, conservative static-analysis posture, and boundaries with the orchestrator and lab. | Authoritative current product overview. |
| `docs/ARCHITECTURE.md` | Index-first design, manifest authority, CLI/domain separation, artifact layers, frontend static-analysis boundary, deterministic and bounded retrieval, and non-goals. | Authoritative current architecture. |
| `docs/GRAPH_SCHEMA.md` | Artifact envelopes, stable IDs, evidence references, analyzer status, warnings, context-capsule and retrieval-audit shapes, adequacy, truncation, and additive schema evolution. | Authoritative schema contract. |
| `docs/COMMANDS.md` | JSON/human output behavior, path conventions, diagnostics, exit behavior, search-to-source retrieval, context evidence, provenance, and explicit unsupported behavior. | Authoritative but very large command reference; only relevant command and contract sections were read. |
| `docs/WORKFLOWS.md` | Index/retrieval sequence, downstream consumption, context-stage roles, and companion-tool boundaries. | Authoritative supporting workflow guide. |
| `docs/DEVELOPMENT.md` | Test organization, build/typecheck/test commands, full validation, and contributor/release preparation. | Authoritative contributor guide. |
| `docs/RELEASE.md` | Documentation, validation, package-content, consumer, and publication gates. | Authoritative mixed current procedure and release policy. |
| `docs/DOCUMENTATION_PRESERVATION_POLICY.md` | Canonical document classes, authority hierarchy, anti-drift rules, and documentation checks. | Authoritative governance policy. |

### `my-dev-kit-orchestrator`

| Path | Relevance | Authority assessment |
|---|---|---|
| `docs/ARCHITECTURE.md` | Producer/orchestrator/lab ownership, stage and readiness responsibilities, contract versions, deterministic packet construction, supplied-evidence handling, lifecycle gates, and non-goals. | Authoritative current architecture. |
| `docs/ARTIFACTS.md` | Run artifacts, dependency/staleness model, artifact contract checks, issue severities, trace evidence, sidecars, and format limits. | Authoritative artifact/lifecycle contract. |
| `docs/WORKFLOWS.md` | Mode-specific stage order, stage contracts, context gates, prompt behavior, and completion flow. | Authoritative workflow guide. |
| `docs/USAGE.md` | Current CLI commands and operator-facing status/check/export behavior. | Authoritative supporting command guide. |
| `docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md` | Ecosystem-wide tool selection, architecture assimilation, producer retrieval, artifacts and handoffs, coordinated multi-repository validation, release sequencing, and planning ownership. | Canonical ecosystem workflow guide and the strongest cross-project authority found. |
| `docs/ecosystem/TOOL_ECOSYSTEM_REFERENCE.txt` | Implementation-grounded summary of all three tools, current command families, evidence flow, and explicit non-substitution rules. | Authoritative supporting ecosystem reference; it explicitly distinguishes implemented behavior from roadmap claims. |
| `docs/DEVELOPMENT.md` | Test categories, compatibility fixtures, validation, packaging, and extension discipline. | Authoritative contributor guide. |
| `docs/RELEASE_CHECKLIST.md` | Cross-platform CI, package dry-run, documentation consistency, forbidden behavior, and release evidence requirements. | Authoritative release procedure, with historical version-specific sections; only generally applicable/current gates were used. |
| `docs/ROADMAP.md` | Explicit ecosystem responsibility boundaries, shared-schema exclusion, and orchestrator/lab non-goals. | Authoritative for planned scope and explicit boundaries; historical release sections were not treated as current evidence. |
| `docs/DOCUMENTATION_PRESERVATION_POLICY.md` | Protected documentation structure, canonical ownership, and no-silent-reorganization rules. | Authoritative governance policy. |

### `my-dev-kit-lab`

| Path | Relevance | Authority assessment |
|---|---|---|
| `docs/PROJECT_OVERVIEW.md` | Lab purpose, users, evidence model, companion relationships, evaluation boundary, and non-goals. | Authoritative current product overview. |
| `docs/CURRENT_STATE.md` | Current package/release baseline, implemented experiment/evaluation state, exact compatibility baselines, and limitations. | Authoritative operational current-state record; time-sensitive by nature but internally current. |
| `docs/ARCHITECTURE.md` | Plugin runner, exact upstream readers, one-way stage-context flow, additive metrics, bounded report layer, fixture assurance, adapters, and extension points. | Authoritative current architecture. |
| `docs/COMMANDS.md` | Experiment/audit/report commands, output locations and formats, invalid-input behavior, partial outcomes, and validation command composition. | Authoritative command reference. |
| `docs/METRICS.md` | Availability semantics, observed-versus-derived interpretation, provenance recall, bounded evidence, agreement outcomes, and non-invention rules. | Authoritative metric semantics. |
| `docs/context-integrity-report-schema.md` | Versioned report model, bounded-list wrapper, contradiction evidence, sanitization, additive compatibility, and limitations. | Authoritative schema description for the v0.4.5 report. |
| `docs/context-integrity-fixtures.md` | Frozen upstream identity, byte-exact versus derived artifacts, derivation sources, exclusions, hashes, and checkout portability. | Canonical fixture provenance reference; manifest files remain the machine-readable authority. |
| `docs/WORKFLOWS.md` | Controlled experiment and validation procedures, outputs, failure handling, and completion states. | Authoritative supporting workflow guide. |
| `docs/PUBLIC_RELEASE_CHECKLIST.md` | Release validation and artifact-hygiene precedent. | Historical/supporting: its concrete release identity is for v0.1.0, so only durable release-hygiene principles were used. |
| `docs/DOCUMENTATION_PRESERVATION_POLICY.md` | Canonical document roles, lifecycle vocabulary, authority, and protected safety/evidence distinctions. | Authoritative governance policy. |

## 3. Current Ecosystem Architecture

### Documented facts

| Project | Current responsibility | Explicit exclusions |
|---|---|---|
| `my-dev-kit` | Local, deterministic static repository indexing and bounded retrieval. It owns structural and semantic artifacts, symbols, static ownership/dependency evidence, graph relationships, context capsules, retrieval audits, and source slices. | It does not execute or render applications, prove runtime UI state, run agents, edit targets, own workflow progression, perform lab evaluation, or establish runtime/security conclusions. Its frontend evidence is explicitly static source evidence. |
| `my-dev-kit-orchestrator` | Staged, artifact-backed development workflows. It owns workflow catalogs and stable IDs, stage ordering, prompt/instruction packets, run state, artifact dependencies and staleness, supplied-context readiness, judge/correction routing, checks, and export. | It does not automatically run `my-dev-kit`, execute agents, edit source, run product tests, own static indexing, or embed lab evaluation. Repository evidence is supplied data. |
| `my-dev-kit-lab` | Controlled experiments, evaluation, benchmarks, reports, audits, security validation, fixtures, and compatibility assessment. It consumes exact producer/orchestrator evidence and adds evaluation without redefining upstream policy. | It is not the production retrieval engine, normal implementation orchestrator, product test suite, or owner of upstream readiness/adequacy logic. It does not normalize incompatible contracts into invented equivalence. |

Current information flow is manual and artifact-based:

1. `my-dev-kit` indexes a target and writes a manifest plus registered static-evidence artifacts.
2. Its retrieval commands produce bounded query evidence, context capsules, and optional retrieval audits.
3. A developer or coding agent places relevant findings into an orchestrator run's appropriate artifact or supplemental evidence files. The orchestrator does not claim to have refreshed or produced that evidence.
4. The orchestrator evaluates the supplied evidence for the applicable stage, renders prompts, tracks artifact lifecycle, and exposes status/check/export results.
5. The lab consumes pinned producer/orchestrator artifacts through exact readers and frozen fixtures, computes additive metrics/agreement, and emits bounded reports. It does not replace the producer or orchestrator verdicts.

### Inference for the new project

The ecosystem is a federation of separately versioned tools connected by explicit artifacts, exact identities, and consumer-side compatibility fixtures—not a shared runtime or monolithic API. A fourth evidence producer fits this model if it publishes its own honest artifact contract and remains independently executable. This is an inference from the documented separation and current manual handoffs; no document currently names `my-frontend-observer` or defines its integration contract.

## 4. Ecosystem Contracts a New Project Should Preserve

The recommendations below apply where suitable to runtime browser evidence. They are precedents to reuse semantically, not instructions to copy another project's schema names.

### Artifact and evidence conventions

1. **Use a stable, tool-owned artifact discriminator and explicit schema version.** Every structured observation artifact should carry an observer-specific `artifactKind` (for example, an eventual canonical name owned by this project) and `schemaVersion`. Do not use a `my-dev-kit-v1-*` kind for runtime evidence. Precedent: `my-dev-kit` graph/context artifacts and lab `ContextIntegrityReportV1`.
2. **Separate the compact run/observation envelope from heavy evidence.** A small observation manifest should reference screenshots and detailed page/element evidence instead of embedding image bytes or unbounded records. Precedent: the producer manifest as artifact registry, compact graph references, and the distinction between orchestrator packets and raw evidence.
3. **Make every artifact discoverable from an authoritative manifest or root result.** Consumers should not need to assume every optional filename exists. Precedent: `my-dev-kit` consumers read `manifest.json`, whose analyzer and artifact registry is authoritative.
4. **Preserve exact observed evidence and label derived facts.** Screenshot bytes, browser-reported rectangles, computed styles, scroll dimensions, URLs, and browser/environment facts are direct observations. A conclusion such as “element is clipped,” “page has a nested primary scrollbar,” or “regression detected” is derived and must record its derivation inputs/rule. Precedent: lab manifests distinguish `byteExact` artifacts from `derived: true` artifacts and require `derivationSources`; producer confidence and evidence references distinguish explicit/static-inferred/partial/unknown evidence.
5. **Keep evidence domains distinct in identifiers and artifacts.** Runtime DOM/geometry IDs should not pretend to be static symbol or graph IDs. Optional correlation references can point to external artifacts later. Precedent: `my-dev-kit` keeps separate artifact layers/ID spaces and uses `artifactRefs`/`evidenceRefs` as bridges.
6. **Represent omissions explicitly.** An unsupported selector, inaccessible frame, browser error, target not found, limit reached, or omitted record must become a status/diagnostic, not a guessed empty result. Precedent: producer warnings and analyzer statuses; lab availability outcomes and limitation lists.

### Schema and versioning conventions

1. **Start the public observation schema at an explicit semantic version such as `1.0.0`, independent of the package version.** Precedent: producer context/audit schema `1.0.0`, orchestrator contract versions `1.0.0`, and lab report schema `1.0.0` across different package releases.
2. **Evolve the same major version additively.** New optional fields and status values should preserve existing field meaning; removals, reinterpretations, and required-field breaks require an intentional compatibility decision. Precedent: `my-dev-kit` additive schema-major-1 evolution and lab's additive reports/readers.
3. **Define canonical ordering and stable serialization where artifacts are compared or hashed.** Sort targets and diagnostics deterministically; canonicalize keys if byte stability is promised. Avoid volatile timestamps in identities. Precedent: orchestrator canonical JSON ordering/stable arrays and lab repeated-evaluation determinism.
4. **Keep package, schema, browser, and producer versions distinct.** Record all rather than conflating them. Precedent: lab fixtures pin repository commit and package version separately; producer manifests record analyzer/schema versions.

### Provenance

Every observation run should record at minimum:

- observer name and package version;
- schema version and artifact kind;
- invocation/run ID and creation time (metadata, not logical identity);
- requested URL, final URL, and navigation outcome;
- browser engine and exact browser version;
- operating system/runtime where material;
- viewport width, height, scale factor, and other configured emulation facts;
- explicit observation target ID and selector/locator definition;
- observation method for each fact (screenshot, DOM API, computed-style API, layout metric, scroll metric, etc.);
- artifact-relative paths, hashes for binary evidence where relied upon, and parent/run identity;
- limits, truncation, warnings, errors, and excluded evidence;
- derivation rule/version and source evidence references for any derived interpretation.

Precedent: producer provenance/evidence references, lab frozen upstream identities and SHA-256 manifests, and ecosystem handoff rules requiring producer, candidate identity, command, schema/version, validation, limitations, and consumer.

### Diagnostics, errors, and exit status

Adopt stable diagnostic codes, deterministic order, a severity/status field, a human reason, and—where actionable—a corrective suggestion. The initial vocabulary can be small. Unsupported or partial observation should remain distinguishable from invalid invocation or total run failure.

Suggested semantics based on existing precedents:

- invalid arguments/configuration, navigation failure that prevents required evidence, malformed required artifacts, or unwritable output: nonzero exit;
- optional target absent or unsupported optional evidence: structured warning/partial status, with exit behavior governed by a documented strict/fail-on policy rather than silently failing or succeeding;
- successful observation with warnings: normally exit zero while preserving warnings;
- machine output on stdout and progress/diagnostics on stderr, so stdout remains parseable.

Precedent: producer `--json` stdout plus bounded progress diagnostics on stderr, warnings that do not fail by themselves, invalid inputs/non-readable required artifacts failing nonzero; orchestrator `check` warning-versus-failure behavior; lab invalid configuration and configurable `--fail-on` thresholds.

### Machine-readable output and CLI behavior

- Provide JSON-first output plus a concise human representation if a CLI is the v0.1 entry point.
- Use explicit `--out` and project/run-relative artifact references; never make machine-specific absolute paths the logical evidence identity.
- Validate enumerated values and required combinations before browser work.
- Keep CLI parsing/formatting separate from the observation engine so a future orchestrator adapter can call a programmatic boundary without scraping console text.
- Do not claim a stable public library API until one is documented and compatibility-tested.

Precedent: producer CLI/domain separation and JSON modes, lab programmatic strategy inputs alongside commands, and orchestrator's stable command/stage/contract identifiers.

### Bounded context and evidence

- Require explicitly configured observation targets in v0.1; do not crawl the DOM or auto-discover “interesting” elements.
- Bound target count, per-target properties, screenshot dimensions/bytes, diagnostic details, and serialized lists.
- Every bounded list should expose total, emitted, and omitted counts or an equivalent visible truncation record.
- Adequacy must not mean merely “some evidence exists.” Report whether all required configured targets and required evidence kinds were satisfied.
- Separate `unavailable`, `not-applicable`, an observed zero/false, and partial evidence.

Precedent: producer context limits, required-evidence-loss semantics and adequacy; lab bounded wrappers (`items`, `totalCount`, `displayedCount`, `omittedCount`) and explicit availability vocabulary.

### Validation and compatibility

- Test deterministic schema serialization, required-field validation, path safety, clean failure, and no mutation outside the chosen output directory.
- Use local deterministic HTML fixtures for browser observations rather than depending on a live public site in the canonical test suite.
- Pin browser/runtime identity in fixture expectations and distinguish semantic evidence tests from pixel-sensitive platform tests.
- Hash-verify any tracked binary/reference artifacts and record whether each is captured or derived.
- Validate on Windows and Linux at minimum if this will join the current cross-platform ecosystem; add macOS when release policy requires parity.
- When a downstream project adopts observer artifacts, freeze exact observer-version fixtures there and test additive/legacy compatibility before coordinated release.

Precedent: producer development/release matrices, orchestrator compatibility fixtures and cross-platform gates, and lab's hash-verified, version-pinned, upstream-independent fixture corpus.

### Documentation

The new repository should establish canonical responsibilities from the beginning:

- `PROJECT_OVERVIEW.md` or equivalent for purpose, users, evidence domain, companions, and boundaries;
- `ARCHITECTURE.md` for ownership, flow, invariants, adapters, failure boundaries, and extension seams;
- a schema document for observation artifacts and evolution rules;
- `COMMANDS.md` for exact flags/output/exit behavior once implemented;
- `WORKFLOWS.md` for capture and consumption procedures;
- testing/development and release/readiness documents;
- a roadmap only after planner-owned version decisions;
- explicit limitations, especially browser/network safety and what runtime observation cannot prove.

Precedent: the canonical document-role tables and preservation policies in all three repositories. Future documentation automation should preserve architecture domains, command families, safety boundaries, limitations, and planned versions rather than compressing them silently.

## 5. Correct Responsibility Boundary for `my-frontend-observer`

The proposed split is correct and is strongly supported by the ecosystem documentation:

```text
my-dev-kit
  -> static repository/source evidence

my-frontend-observer
  -> rendered browser/runtime evidence

my-dev-kit-orchestrator / developer / LLM
  -> coordinates or combines separately produced evidence

my-dev-kit-lab
  -> evaluates frozen/candidate evidence and compatibility without becoming production runtime
```

The strongest supporting fact is that `my-dev-kit` explicitly classifies frontend evidence as static and denies runtime React rendering, browser state, runtime route behavior, UI visibility, device/emulator execution, and runtime proof. The orchestrator explicitly treats repository evidence as externally supplied and does not automatically run its producer. The lab explicitly preserves upstream contracts and computes additive evaluation rather than rebuilding producer or orchestrator policy.

### Functionality that must not be duplicated in `my-frontend-observer`

- repository crawling for source files;
- language parsing, symbol indexes, code graphs, call graphs, dependency graphs, or static ownership inference;
- static framework/route/component discovery intended to replace `my-dev-kit`;
- bounded source retrieval (`search`, `lookup`, `slice`, `source`, context capsules, retrieval audits);
- architecture adequacy or edit-owner selection;
- orchestrator workflow catalogs, stage order, run lifecycle, prompt assembly, readiness gates, judge/correction routing, or publication state;
- lab experiment comparison, security verdicts, audit ownership, release evaluation, or report-wide rankings;
- direct LLM interpretation inside the evidence producer;
- inferred mapping from a DOM element to a source owner unless supplied by an external correlation artifact and clearly recorded as externally sourced/derived.

Runtime observation may use selectors and DOM structure because those are its native observation domain. It must not turn selector processing into a competing static source analyzer. Similarly, it may calculate runtime relationships such as clipping from measured rectangles, but that interpretation must remain traceable to observed browser facts.

## 6. Integration Architecture

### `my-frontend-observer` ↔ `my-dev-kit`

**Likely direction:** sibling producers whose outputs are combined by a consumer. Neither should normally invoke or import the other.

**Artifact/API boundary:** observer artifacts can later carry optional external correlation references such as a static index identity, source evidence ID, route evidence ID, or an opaque consumer-supplied target correlation ID. `my-dev-kit` artifacts can remain unchanged unless a future static/runtime correlation contract is separately approved. A coordinator should resolve the references and report agreement/uncertainty.

**v0.1 coupling:** none required. Architecturally prepare with stable observation IDs, run identity, optional opaque metadata/correlation fields, and relative artifact references. Do not add `my-dev-kit` as a dependency or run it automatically.

**Must remain independent:** static parsing, ownership, source retrieval, browser launch, runtime capture, and each tool's schema namespace/versioning.

### `my-frontend-observer` ↔ `my-dev-kit-orchestrator`

**Likely direction:** the observer produces evidence; a future orchestrator workflow/stage or a developer supplies references/projections to the orchestrator. The orchestrator consumes only what a documented stage requirement needs.

**Artifact/API boundary:** a future adapter should read the observer's public observation manifest/artifact and build a bounded orchestrator-side projection or supplemental evidence reference. The raw screenshot and full detailed evidence should remain external artifacts, not be embedded wholesale in instruction packets.

**v0.1 coupling:** no orchestrator package/runtime dependency and no new orchestrator stage. The observer should expose a clean CLI/programmatic result and stable artifact contract so later integration does not require scraping logs or rewriting capture logic.

**Must remain independent:** workflow mode/stage decisions, readiness, prompt rendering, artifact lifecycle, correction routing, and evidence production. The orchestrator documentation says current integrations are manual and that no shared cross-repository schema package exists; that absence should be respected rather than bypassed with an undocumented import.

### `my-frontend-observer` ↔ `my-dev-kit-lab`

**Likely direction:** observer is the production evidence producer; lab is a downstream evaluator and compatibility/experiment consumer.

**Artifact/API boundary:** a future lab exact reader should preserve the observer artifact's names, nesting, optionality, nullability, ordering, additive unknown fields, and explicit statuses. Lab fixtures should pin observer commit/package/schema/browser identities and distinguish byte-exact capture from lab-derived test evidence. Lab metrics may compare expected and observed runtime evidence without reimplementing the observer's capture or derivation rules.

**v0.1 coupling:** none. It is useful to provide deterministic local fixtures and schema samples that the lab can later freeze. Do not add the lab as a runtime dependency or make lab reports the observer's production artifact model.

**Must remain independent:** live capture execution versus evaluation, observer diagnostics versus lab findings, observer artifact adequacy versus lab comparison outcomes, and product tests versus ecosystem evaluation.

There is no reason to create a symmetric four-way plugin framework. The documented ecosystem favors explicit producer/consumer contracts and exact adapters where a real consumption need exists.

## 7. Implications for the First `my-frontend-observer` Version

The proposed vertical slice remains the correct first implementation scope:

```text
target URL + viewport + explicit observation targets
  -> Chromium observation
  -> screenshot
  -> structured page evidence
  -> structured element evidence
  -> local observation artifact set
```

### Must implement in v0.1

1. **One explicit Chromium browser adapter.** It owns launch/navigation/capture mechanics and exposes browser identity. Do not generalize to multiple browsers before a second implementation exists.
2. **A small observation engine independent of the CLI.** It validates the request, coordinates one page observation, asks the adapter for raw facts, produces explicit diagnostics, and returns a typed result.
3. **Explicit target configuration.** Each target needs a stable caller-supplied ID and locator/selector. Required versus optional target status must be represented if optional targets are supported.
4. **Structured request, page, and element evidence.** At minimum include navigation result/final URL, viewport/environment, screenshot reference, document and viewport dimensions, scroll/overflow facts needed by the promised slice, target match status, element rectangle/visibility-related raw facts, and the observation method.
5. **A versioned local artifact set.** Use a compact run/observation manifest plus referenced screenshot and structured evidence. Paths in the manifest should be relative to the artifact root and path-safe.
6. **Provenance and observed/derived separation.** Every derived field must identify its rule/basis. No unexplained “pass,” “healthy,” or “regression” verdict belongs in the first capture artifact.
7. **Boundedness and adequacy.** Apply deterministic limits, visible omission counts, target-level statuses, run summary, and an explicit statement of whether required configured evidence was captured.
8. **Stable diagnostics and exit behavior.** Provide machine-readable codes/statuses and a documented distinction between invalid/fatal, partial/warning, unavailable, and successful observations.
9. **A CLI or equally concrete programmatic entry point.** A CLI is the strongest ecosystem precedent. JSON stdout and diagnostic stderr should be separable; artifact output must be explicit.
10. **Deterministic local fixture/test infrastructure.** Serve or load controlled pages with fixed geometry, overflow, scroll, missing-target, and error cases. Validate schemas, artifacts, hashes where applicable, and no writes outside the output root.
11. **Browser/network safety policy.** Before implementation, specify allowed URL schemes, redirect handling, timeouts, certificate/error behavior, downloads, popups, permissions, request/network policy, and secret-bearing output redaction. Runtime browsing creates a threat boundary the three static/local tools do not answer for this project.

### Must architect for in v0.1 but can implement later

1. **Optional external correlation metadata.** Preserve a namespace for opaque correlation IDs/artifact references without teaching the observer to resolve source ownership.
2. **Exact-reader compatibility.** Keep the public artifact model separate from internal browser objects and console output so orchestrator/lab adapters can consume it without normalization.
3. **Additive schema evolution.** Reserve clear extension points for new evidence kinds, additional browser adapters, comparison metadata, and richer diagnostics; do not predeclare speculative fields as current facts.
4. **Repeatable run identity.** Separate logical request/config identity from volatile capture time so later comparisons can decide whether two observations are comparable.
5. **Screenshot integrity.** Record media type, dimensions, relative path, and hash if screenshots will serve as regression witnesses later.
6. **Comparison eligibility inputs.** Capture enough environment/config identity to let a future comparison engine reject incomparable runs. Do not implement comparison yet.
7. **Programmatic seam.** Keep CLI concerns outside the typed observation use case so a future orchestrator adapter can invoke or wrap it without browser logic duplication. Whether this becomes a public package API remains unresolved.
8. **Fixture portability.** Separate semantic observation assertions from platform-sensitive pixel assertions so lab/cross-platform integration remains feasible.

### Must defer

- static source ownership, source maps-to-owner inference, repository indexing, symbol/dependency analysis, or any `my-dev-kit` replacement;
- automatic `my-dev-kit` execution or a combined static/runtime super-artifact;
- orchestrator stages, prompt/context packaging, readiness policy, or automatic workflow advancement;
- lab plugins, comparative scoring, security/release verdicts, or benchmark rankings;
- baseline management, screenshot diffing, regression verdicts, multi-run comparison, or trend history;
- LLM context packaging, summarization, annotation, or natural-language interpretation;
- visual annotation/editor UI;
- target auto-discovery, full-page crawling, route enumeration, or source-derived selector generation;
- Firefox/WebKit or a speculative browser-provider plugin framework;
- multi-page journeys, authentication orchestration, user-flow recording, or product test replacement;
- remote artifact stores, hosted services, telemetry, or ecosystem-wide schema packages;
- automatic mapping of runtime elements to repository components.

Source ownership belongs to `my-dev-kit`; orchestration and LLM context belong to the coordinator/orchestrator; lab integration belongs after a stable artifact exists; comparison/regression and visual annotation are later observer capabilities, not requirements of a first observation slice.

## 8. Recommended v0.1 Architecture Boundary

The smallest justified architecture is:

```text
CLI/config parser
  -> observation application service
       -> BrowserAdapter (one Chromium implementation)
       -> observation domain records and diagnostic policy
       -> ArtifactWriter

deterministic fixture host/pages
  -> browser-adapter integration tests
  -> observation/schema/artifact contract tests
```

### Ownership

**Browser adapter**

- Own browser process/context/page lifecycle, navigation, timeouts, browser identity, screenshot capture, and direct DOM/browser measurements.
- Return typed raw observations and adapter errors; do not decide ecosystem adequacy, regression, or source ownership.
- Begin with one `ChromiumBrowserAdapter`. An interface is justified because browser mechanics should not leak into the domain and future adapters are plausible, but a registry/plugin system is not justified in v0.1.

**Observation engine/application service**

- Own one run's orchestration, deterministic target ordering, required/optional completion, limits, diagnostic aggregation, and result assembly.
- Accept an already validated domain request or return explicit validation diagnostics.
- Remain free of CLI formatting, filesystem layout details, and static repository analysis.

**Observation domain/schema**

- Own request and result types, page/element evidence, provenance, availability/status vocabulary, observed-versus-derived records, artifact references, limits/truncation, and schema version.
- Keep raw browser-library objects private.
- Avoid a universal “evidence framework”; define only the records required by the first slice plus small, documented additive seams.

**Selector/target model**

- Own stable target IDs, locator kind/value, cardinality expectation if needed, required/optional status, and per-target requested evidence.
- Do not auto-discover targets or infer source components.

**Artifact writer**

- Own path-safe output creation, deterministic JSON serialization, relative artifact references, screenshot filenames/hashes, manifest-last completion behavior, and cleanup/partial-write policy.
- It must not compute observation meaning. A manifest-last approach is supported by the producer precedent because consumers should never mistake an incomplete directory for a complete run.

**Command-line interface**

- Own option registration, config parsing, input validation presentation, stdout/stderr format, and process exit code.
- Call the application service and writer; do not contain browser/evidence logic.
- A public programmatic API can be considered later. Internally exported types/functions should not be advertised as stable until compatibility requirements exist.

**Fixture/test infrastructure**

- Own deterministic local pages for geometry, page scroll, nested local overflow, missing/duplicate targets, viewport changes, and navigation failure.
- Keep fixtures network-independent, immutable during tests, and versioned when they become cross-project compatibility evidence.
- Use unit tests for schema/diagnostic/serialization logic, adapter integration tests against local fixtures, CLI contract tests, and package/output hygiene checks. Do not treat screenshot pixel identity across operating systems as the only proof of semantic correctness.

No event bus, dependency-injection container, general plugin host, shared ecosystem SDK, remote service, or multi-producer merger is justified for v0.1.

## 9. Ecosystem Integration Requirements to Add to Project Planning

### Required corrections before implementation

1. State explicitly that `my-frontend-observer` is a runtime evidence producer and never a static repository/source-analysis engine.
2. Add a canonical artifact contract: artifact kind, schema version, manifest/root result, page/element evidence, screenshot references, limits, diagnostics, provenance, and observed/derived distinction.
3. Define required/optional target semantics and what makes an observation complete, partial, inadequate, or failed.
4. Define CLI machine-output, stderr, and exit-status behavior.
5. Add deterministic ordering, stable target/run identity, relative path, atomic/manifest-last, and artifact-hash requirements.
6. Define browser/network safety and sensitive-output rules before accepting arbitrary URLs.
7. Define v0.1 limits: one Chromium page, explicit targets, local artifacts, no comparison/regression, no static analysis, no orchestrator/lab runtime dependency.
8. Add test architecture covering local fixtures, schema/serialization, browser integration, CLI failures, path safety, and no mutation outside output.

### Useful clarifications

1. Clarify which page facts are direct observations and which are derived classifications. Provide examples such as browser-returned `scrollHeight` versus a derived “document scrolls” conclusion.
2. Clarify selector cardinality and behavior when zero or multiple elements match.
3. Clarify screenshot mode (viewport/full page), timing/readiness condition, animations, fonts, device scale, and environmental metadata.
4. Clarify whether the first artifact is one JSON document plus screenshot or a manifest plus separate page/element JSON. The ecosystem precedent favors the latter once multiple artifacts exist.
5. Clarify support for redirects, frames, shadow DOM, pseudo-elements, and cross-origin frames. Unsupported cases can be explicit v0.1 limitations.
6. Clarify package/public API intent: CLI-only initially versus a supported programmatic API.
7. Add a documentation ownership map modeled on the companion projects so architecture, commands, schema, workflows, testing, release, and roadmap facts do not drift.

### Future integration notes

1. A coordinator may combine observer artifact references with `my-dev-kit` index/context identities; neither producer should absorb the other's evidence domain.
2. A future orchestrator integration should use a bounded adapter/projection and preserve raw artifact references rather than embedding screenshots or full observation documents in prompts.
3. A future lab reader should mirror the observer schema exactly, preserve unknown additive fields, and use pinned/hash-verified fixtures.
4. Cross-repository changes need an explicit dependency map, exact candidate packages/commits, coordinated fixtures, consumer validation, and separate releases in dependency order.
5. Comparison/regression contracts should be designed only after capture identity and comparability facts are stable.
6. A shared schema package is not current ecosystem architecture. Introduce one only through a separately approved cross-project design, not as a v0.1 shortcut.

## 10. Risks of Implementing Milestone 1 Without Ecosystem Alignment

1. **An unversioned JSON dump would force a retrofit at the first consumer.** Orchestrator/lab adapters would have no way to distinguish schema changes or legacy artifacts.
2. **Embedding screenshots or unlimited DOM/style data would violate bounded-evidence expectations.** Prompt consumers would either truncate silently or need a second ad hoc projection format.
3. **Using volatile DOM order or timestamps as identity would make comparisons and fixture compatibility unstable.** Later regression evidence could not reliably correlate observations.
4. **Mixing direct measurements with “bad layout” conclusions would erase provenance.** The lab could not determine whether it was evaluating a browser fact or observer policy.
5. **Treating missing targets as empty/false would fabricate evidence.** This conflicts directly with producer adequacy and lab availability semantics.
6. **A console-only interface would couple future integrations to human text.** The orchestrator or lab would need brittle parsing rather than exact readers.
7. **Absolute paths and environment-specific browser objects would make artifacts non-portable.** Frozen fixtures and cross-platform consumers would fail or leak local identities unnecessarily.
8. **Direct `my-dev-kit` imports or source scanning would create duplicated ownership logic.** Static/runtime disagreements would have no canonical owner and would require a major extraction later.
9. **Embedding orchestrator stage logic would duplicate lifecycle/readiness authority.** The observer would cease to be independently usable and would violate current manual producer integration.
10. **Embedding lab scoring/reporting would confuse production evidence with evaluation.** A capture result could be mistaken for a release or quality verdict.
11. **A premature generic browser/plugin framework would enlarge v0.1 without evidence.** The ecosystem uses extension registries where real multiple implementations exist, not as a substitute for a concrete first adapter.
12. **Live-internet-only tests would undermine deterministic compatibility.** Upstream pages, fonts, ads, timing, and network behavior would make fixtures untrustworthy.
13. **Pixel-only golden tests would conflate rendering-environment drift with semantic regression.** Cross-platform release validation would become noisy and hard to interpret.
14. **No URL/network policy would expose a new security boundary.** Arbitrary navigation, redirects, downloads, credentials, and captured page data are outside the safety assumptions of the existing static/local tools.
15. **Writing a single partial artifact before failure without completion semantics would let consumers ingest incomplete evidence.** Manifest-last or explicit run status is needed from the start.

## 11. Unresolved Questions

| Question | Why it matters | Answer owner | Blocking effect |
|---|---|---|---|
| What is the exact canonical observer artifact kind/name and v1 schema shape? | It determines v0.1 persistence and every future adapter. Existing docs provide conventions, not the new tool's schema. | `my-frontend-observer` architecture owner. | Blocks implementation, not planning. Resolve in `ARCHITECTURE.md`/schema design. |
| What URL/network/browser security policy applies to arbitrary targets? | Browser execution can access networks, redirects, credentials, downloads, and sensitive rendered content—risks not covered by the static producer's defaults. | `my-frontend-observer`, with later lab security validation. | Blocks implementation of navigation; does not block version planning. |
| Is v0.1 CLI-only publicly, or must it promise a stable programmatic API? | A public API expands compatibility commitments. A clean internal application seam is still required. | `my-frontend-observer` product/API owner. | Does not block a CLI-first v0.1 if explicitly deferred. |
| Will the first screenshot be viewport-only, full-page, or configurable, and what readiness/timing contract controls capture? | It changes artifact meaning, dimensions, determinism, and fixture design. | `my-frontend-observer` design owner. | Blocks detailed v0.1 acceptance criteria. |
| Who will own a future cross-domain correlation contract? | Static symbol/route evidence and runtime element evidence have different identities. An owner is needed before standardizing references across repositories. | Ecosystem planner, likely coordinated through orchestrator documentation rather than either producer alone. | Later integration only. |
| Will the orchestrator add a runtime-observation evidence type/stage or accept observer evidence only as supplemental input? | It affects bounded projection, readiness, lifecycle, and stale propagation. Current docs define no such stage. | `my-dev-kit-orchestrator` roadmap/architecture owner. | Later integration only. |
| Which observer versions/schemas/browser baselines will the lab freeze and support? | Exact readers and compatibility fixtures need an explicit matrix. | `my-dev-kit-lab` roadmap/evaluation owner after observer artifacts stabilize. | Later lab integration only. |
| Is cross-platform screenshot byte identity a requirement, or are screenshots evidentiary while geometry/schema assertions are canonical? | The answer materially changes CI and fixture strategy. Existing ecosystem docs require determinism but do not establish cross-OS browser pixel identity. | `my-frontend-observer` test/release owner. | Must be decided for test planning; not an ecosystem-context blocker. |
| Is a shared cross-repository schema package desired eventually? | Current orchestrator documentation explicitly says none exists. Adding one would change versioning and release dependency order. | Ecosystem planner across all affected repositories. | Later only; must not be assumed in v0.1. |

No unresolved question requires source inspection. The documentation is explicit enough about current tool boundaries; the remaining questions are new-project design decisions or future cross-project planning decisions.

## 12. Recommended Next Step

Before creating a version plan or implementing code, ChatGPT should perform one bounded documentation-design step in `my-frontend-observer`:

1. reconcile the current project description and milestone text with the required corrections in Section 9;
2. write a canonical `ARCHITECTURE.md` defining the v0.1 ownership boundary, browser safety boundary, component flow, and non-goals;
3. write the initial observation artifact/schema contract, including provenance, boundedness, diagnostics, observed-versus-derived fields, compatibility evolution, and artifact completion semantics;
4. define the local fixture/test architecture and CLI/exit contract;
5. only then perform planner-owned v0.1 scope and acceptance-criteria planning.

This is a documentation/design prerequisite, not a request to create a roadmap now. Complete Architecture Assimilation against the existing projects is unnecessary for the first slice because this reconnaissance has established the relevant documented boundaries, and no source ownership integration belongs in v0.1. A targeted cross-project architecture check should be run later when an actual orchestrator or lab adapter is proposed.

`FINAL_STATUS: READY_TO_PLAN_FRONTEND_OBSERVER_V0_1`
