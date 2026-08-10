# 1. Executive Verdict

> Historical planning notice (2026-08-09): this reconnaissance predates the
> authoritative coding-agent critical-path revision. References below to the old
> Milestone 6–10 order are historical, not current planning authority. Current
> order is defined by `docs/PROJECT_MILESTONES.md` and `docs/ROADMAP.md`.

`READY_TO_START_GREENFIELD_BOOTSTRAP`

Use the published, version-pinned `@dailephd/my-dev-kit-orchestrator@1.3.0` package with Node.js 24 or later and the `typescript-cli` greenfield starter profile. The run must use the default run directory under `Z:\Users\newuser\Projects\my-frontend-observer\.my-dev-kit-orchestrator\runs`; do not use `--output-dir`, because current discovery/resume commands cannot rediscover a custom-output run.

The two authoritative forward-looking planning inputs are external to the repository:

- `Z:\Users\newuser\Downloads\my-frontend-observer - Project Description.md`
- `Z:\Users\newuser\Downloads\my-frontend-observer — Project Milestones.md`

The second filename contains an em dash (`—`), not a hyphen or question mark. The repository also contains the authoritative completed reconnaissance input `Z:\Users\newuser\Projects\my-frontend-observer\reports\ecosystem-architecture-reconnaissance.md`.

The CLI does not import any of these files. `start` stores only its request string. ChatGPT/coding agents must be explicitly instructed to read the three files during the early prompts, preserve milestone order and intent, and reconcile their conclusions into the greenfield artifacts and eventual repository documentation.

`project-docs` does **not** create repository files. It prepares and validates structured documentation content in memory and produces `artifacts/project-docs-report.txt`. Actual documentation and source files are created by the coding agent at `scaffold-implementation`, as authorized by `artifacts/scaffold-plan.txt`; the report `reports/scaffold-implementation-report.txt` must enumerate created files under `Files changed:`. Source scaffolding starts only at that implementation stage. The next stage, `first-vertical-slice`, adds the smallest useful runnable behavior.

There is no native greenfield roadmap stage, no `ROADMAP.md` artifact, and no automatic planning-file ingestion. `ROADMAP.md` should therefore be an explicit documentation target in the scaffold plan and be written during scaffold implementation. It must remain a high-level version specification—capabilities, constraints, acceptance expectations, dependencies, exclusions, and sequencing—with no implementation batches, command transcripts, file lists, or execution logs.

# 2. Evidence and Documentation Examined

## Observer inputs

| Evidence | Authority/use |
| --- | --- |
| `Z:\Users\newuser\Downloads\my-frontend-observer - Project Description.md` | Authoritative forward-looking product description: problem, users, capabilities, stack preferences, boundaries, and future direction. |
| `Z:\Users\newuser\Downloads\my-frontend-observer — Project Milestones.md` | Authoritative forward-looking ordered milestones. Milestone 1 is “Greenfield Foundation and First Browser Observation”; later viewer work is Milestone 7. |
| `Z:\Users\newuser\Projects\my-frontend-observer\reports\ecosystem-architecture-reconnaissance.md` | Authoritative completed reconnaissance evidence and recommendations; not a forward-looking replacement for Description, Milestones, or Roadmap. |

The observer repository otherwise contains only IDE metadata. It is not currently a Git repository.

## Required orchestrator documentation

| Document | Material facts used |
| --- | --- |
| `docs/USAGE.md` | Complete user-facing CLI syntax, `--root`, run discovery, `--output-dir` limitation, prompt/status/check/mark/export behavior. It declares itself the complete command reference. |
| `docs/WORKFLOWS.md` | Authoritative 13-stage greenfield order, stage purposes, profile-resolution timing, manual agent loop, and project-docs/scaffold boundary. |
| `docs/ARTIFACTS.md` | Exact run layout, artifact paths/formats, dependency/lifecycle rules, scaffold evidence sections, readiness checks, and persisted check-result files. |

## Additional targeted documentation and why it was needed

| Document | Question requiring the read |
| --- | --- |
| `docs/ARCHITECTURE.md` | Which behavior is at repository HEAD/current release, what the CLI versus agent owns, and whether indexing or implementation is automatic. |
| `docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md` | How the standardized Description/Milestones inputs enter greenfield, document conversion, roadmap preservation, initial indexing, post-greenfield work, and Architecture Assimilation apply. |
| `docs/DEVELOPMENT.md` | Node prerequisite, local/release validation expectations, and what qualifies as the complete orchestrator validation chain. |
| `docs/DOCUMENTATION_PRESERVATION_POLICY.md` | Authority hierarchy and the required separation of public forward-looking roadmap content from batch/execution bookkeeping. |
| `docs/ROADMAP.md` (only published greenfield sections) | Whether greenfield/initial-index behavior is shipped, whether v1.3.0 is published, and whether a native roadmap stage exists. Future roadmap material was not used as current behavior. |
| root `README.md` (current-release/quick-start sections) | Resolve the release-state contradiction and confirm the published-package workflow. |

No `COMMANDS.md` exists in the orchestrator root, so none was read. No source files were read. No `my-dev-kit` retrieval fallback was needed because the authoritative documentation plus read-only CLI help resolved the material questions.

Read-only corroboration: local `dist/cli.js --version` returned `1.3.0`; local command help confirmed all flags below; npm registry metadata on 2026-08-08 reported `@dailephd/my-dev-kit-orchestrator` `latest` = `1.3.0` and `@dailephd/my-dev-kit` `latest` = `1.12.1`.

# 3. Current Orchestrator Version / Execution Choice

**Documented current/published behavior:** README, Architecture, the published-v1.3.0 roadmap section, package metadata, local `--version`, and npm registry metadata agree on `@dailephd/my-dev-kit-orchestrator@1.3.0`. v1.3.0 includes profile/scaffold/readiness verification for all three profiles.

**Contradiction retained:** `WORKFLOWS.md` lines 416–424 and `ARCHITECTURE.md` lines 57–92 still call the strengthened readiness work “implemented but unpublished.” This conflicts with the newer/current-release statements and the published-v1.3.0 section dated 2026-08-04, as well as npm `latest`. The latter evidence is authoritative for publication state; the “unpublished” wording appears stale. Do not interpret it as a different local-only candidate.

**Recommendation:** pin the published package:

```powershell
npx @dailephd/my-dev-kit-orchestrator@1.3.0 <command>
```

This is preferable to the local build because the local repository directory has no `.git` metadata. Its executable and `package.json` say 1.3.0, but an exact local commit, clean-tree identity, CI run, or provenance-equivalence to the npm tarball cannot be established. Documentation gives commands to validate a local checkout, but no durable evidence proves that this exact directory ran the full suite. This uncertainty does not block bootstrap because the published package is explicit and current.

The orchestrator was not initialized and no run was started during this reconnaissance.

# 4. Exact Greenfield Command Surface

Use the explicit project root on every command:

```powershell
$projectRoot = 'Z:\Users\newuser\Projects\my-frontend-observer'

npx @dailephd/my-dev-kit-orchestrator@1.3.0 init --root $projectRoot
npx @dailephd/my-dev-kit-orchestrator@1.3.0 start --mode greenfield --root $projectRoot --name frontend-observer-bootstrap "<bounded request>"
npx @dailephd/my-dev-kit-orchestrator@1.3.0 prompt --root $projectRoot
npx @dailephd/my-dev-kit-orchestrator@1.3.0 prompt scaffold-plan --root $projectRoot --run <run-id>
npx @dailephd/my-dev-kit-orchestrator@1.3.0 status --root $projectRoot --run <run-id>
npx @dailephd/my-dev-kit-orchestrator@1.3.0 list --root $projectRoot --mode greenfield
npx @dailephd/my-dev-kit-orchestrator@1.3.0 check --artifacts --root $projectRoot --run <run-id>
npx @dailephd/my-dev-kit-orchestrator@1.3.0 check --all --root $projectRoot --run <run-id>
npx @dailephd/my-dev-kit-orchestrator@1.3.0 mark <artifact-filename> --state blocked --reason "<reason>" --root $projectRoot --run <run-id>
npx @dailephd/my-dev-kit-orchestrator@1.3.0 export --root $projectRoot --run <run-id> --out <handoff-file>
```

Important syntax and behavior:

- `init --root <path>` creates `.my-dev-kit-orchestrator/`, `runs/`, and `config.json` if absent.
- `start --mode greenfield [--root <path>] [--name <run-name>] <request>` initializes the workspace if necessary, creates a timestamped run ID with the readable suffix, and writes `00-request.txt`, `run.json`, all prompts, and instruction-packet sidecars.
- `--name` names the run; it does not select a profile. There is no public `--profile`, `--description`, `--milestones`, or brief-file flag.
- Do **not** use `start --output-dir`. It is placement-only. `prompt`, `status`, `list`, `mark`, `check`, and `export` search only `<root>\.my-dev-kit-orchestrator\runs` and cannot rediscover a custom-output run, even with `--run`.
- `prompt` selects the first gate-aware non-complete stage of the newest discoverable run. `prompt <stage>` prints a supported specific stage but does not bypass missing predecessors or lifecycle/readiness gates. `--run <id>` selects a discoverable run.
- Run discovery defaults to the newest run; use `--run` consistently once the ID exists. `list` has no `--run` because it lists runs.
- `status` is human-readable only; there is no JSON option.
- `mark <artifact-filename> --state incomplete|blocked|complete`: reason is mandatory for `incomplete` and `blocked`; `missing` and `stale` are computed and cannot be marked. Marking changes `artifact-state.json`. File presence normally means complete when there is no manual state, but canonical readiness/judge gates cannot be bypassed by marking.
- `check --artifacts` validates all stage contracts/gates. `check --all` adds contracts, stage gates, traces, DesignMap if present, correction state, readiness, and judge/final-report integrity. Add `--strict` to make warnings exit nonzero. Findings on an unfinished run are expected.
- `export` prints to stdout by default. `--out <file>` writes a file and refuses an existing target; `--overwrite` permits replacement. It rejects parent traversal, symlinks, directories, and nonexistent parent directories.

Mutation classification:

| Operation | Effect |
| --- | --- |
| `init`, `start` | Create/modify orchestrator workspace/run state. |
| coding-agent artifact save | Modifies run state by creating the required artifact. |
| `mark` | Modifies run lifecycle metadata. |
| `prompt`, `status`, `list` | Read-only; prompt rendering does not advance or mutate a run. |
| `check*` | Does not change lifecycle or project files, but some forms persist run-local result files such as `artifact-check-results.json` and `trace-check-results.json`. Treat as an inspection with recorded check evidence, not strictly zero-write. |
| `export` | Read-only when printed; writes/overwrites only when `--out`/`--overwrite` is used. |

# 5. Greenfield Stage and Artifact Map

All required artifacts are linearly ordered dependencies: a later stage requires all prior stage artifacts. “Immediate consumer” below highlights the principal next use, not the only dependency.

| # | Stage | Purpose | Required output | Format/location | Immediate downstream use | Work type |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `idea-brief` | Capture and normalize idea, name, goal, users, workflow, constraints, profile/stack preferences, docs/testing expectations. | `artifacts/idea-brief.json` | JSON artifact | `product-boundary` and all later stages | Planning only |
| 2 | `product-boundary` | Fix goals, users, constraints, non-goals, ecosystem responsibility, and first-slice scope. | `artifacts/product-boundary.txt` | Text artifact | stack/profile/bundle; vertical slice must tie back to it | Planning only |
| 3 | `stack-decision` | Record the platform-neutral technology and validation decision. | `artifacts/stack-decision.txt` | Text artifact | `starter-profile`, bundle, scaffold plan | Planning only |
| 4 | `starter-profile` | Resolve one supported profile and its required targets/commands. | `artifacts/starter-profile.json` | JSON artifact | `bootstrap-bundle`; readiness validates profile identity | Planning only |
| 5 | `bootstrap-bundle` | Assemble deterministic brief, selected profile, template targets, documentation instructions, scaffold inputs, and validation rules. | `artifacts/bootstrap-bundle.json` | JSON artifact | `project-docs` and scaffold planning | Planning only |
| 6 | `project-docs` | Prepare and validate structured **in-memory** starter-document content. | `artifacts/project-docs-report.txt` | Text artifact | `scaffold-plan` documentation expectations | Planning/validation only; no repository docs written |
| 7 | `scaffold-plan` | Authorize bounded target paths, setup/validation commands, runnable behavior, tests, docs, unresolved decisions, acceptance, and non-goals. | `artifacts/scaffold-plan.txt` | Text artifact with parseable `Profile`, `Target paths`, `Setup commands`, `Validation commands` sections | coding agent at `scaffold-implementation` | Planning only; last gate before file creation |
| 8 | `scaffold-implementation` | Coding agent creates the approved repository scaffold and planned documentation. | `reports/scaffold-implementation-report.txt` | Text report; `Profile:` and `Files changed:` evidence | vertical slice and readiness checker | **Actual project file creation begins** |
| 9 | `first-vertical-slice` | Implement the smallest useful runnable behavior tied to the product boundary. | `artifacts/first-vertical-slice.txt` | Text artifact with `Profile`, `Minimal behavior`, `Entry point`, `Tied to product boundary` | verification | **Actual implementation** |
| 10 | `verification` | Run/record real profile-required implementation checks and evidence. | `artifacts/verification-report.txt` | Text artifact; `Commands verified:` entries | initial index and judge | Evidence-producing execution; not new planning |
| 11 | `initial-index` | Hand the now-existing codebase to `my-dev-kit`; record first index/retrieval evidence. | `reports/initial-index-report.txt` | Text report | judge and later normal development | Agent/user runs producer; orchestrator itself does not index |
| 12 | `judge` | Compare implementation and evidence with the greenfield plan and issue a supported verdict. | `artifacts/judge-report.txt` | Text artifact | correction route or final report | Evaluation only unless it routes correction |
| 13 | `final-report` | Summarize result, accepted verdict, risks, and next action. | `artifacts/final-report.txt` | Text artifact | completed run/export/handoff | Reporting only |

# 6. Project Documentation Behavior

Documented current behavior:

- The bootstrap bundle has in-memory documents named `product-boundary`, `stack-decision`, `starter-profile-summary`, `development-workflow`, `testing-expectations`, `validation-expectations`, `scaffold-planning-notes`, `unresolved-decisions`, and `non-goals`. Component documents are empty unless the brief supplies module/component hints.
- `project-docs` asks the agent to prepare/validate that content and save only `artifacts/project-docs-report.txt`. The runtime does not write template files or finished docs.
- Repository doc paths must be listed in `scaffold-plan.txt` under `Target paths:` and described under `Documentation expectations:`. This is how planned documentation files enter the approved file set.
- At `scaffold-implementation`, the coding agent—not the orchestrator—creates those files. `reports/scaffold-implementation-report.txt` proves the claimed output using `Profile:` and one normalized relative path per `Files changed:` line.
- v1.3.0 readiness parses the persisted scaffold plan, verifies its profile/target/command contract, matches claimed generated files against profile-required targets, parses verification command results, requires a complete profile-identified first slice, and bridges profile documentation findings. It may optionally corroborate files read-only on disk and rejects directories/symlinks as file evidence.
- Current readiness does **not** mean every recommended project-specific document below is natively required by name. “Docs match scaffold shape” and an explicit greenfield-to-feature handoff are still planned v1.4.0 work. Therefore the scaffold plan and human review must require the intended docs explicitly.

# 7. Use of Existing my-frontend-observer Planning Documents

Use a combination of all proposed roles:

1. **Run-creation source:** the request should summarize their identity, first milestone, profile, principal exclusions, and exact paths. Do not paste both full files into the request.
2. **Explicit early-stage reads:** every coding-agent execution for at least `idea-brief`, `product-boundary`, `stack-decision`, `starter-profile`, `bootstrap-bundle`, `project-docs`, and `scaffold-plan` should be told to read all three authoritative inputs. The CLI does not do this automatically.
3. **Inputs to project-docs:** their facts should populate and validate the in-memory starter docs. The ecosystem report’s required corrections must be reconciled without deleting Description/Milestones intent.
4. **Retained scaffold inputs:** plan repository-local preserved copies (or exact hashes plus protected external locations), and create complete canonical derived forward-looking docs. Because local future-LLM comprehension is a goal, repository-local preserved copies are preferable.
5. **Authority order:** current explicit user decisions; preserved Description/Milestones; accepted architecture decisions; current Roadmap; implementation evidence for current-state claims. Suggestions and reconnaissance recommendations do not silently override agreed scope.

No automatic filename watcher, import command, or file flag exists. Missing detail remains unresolved; it must not be invented.

The initial `start --mode greenfield` request should contain:

- project name and greenfield status;
- identity: independent local-first rendered browser/runtime evidence producer;
- ecosystem split among observer, static producer, orchestrator, and lab;
- exact Milestone 1 objective and small vertical slice;
- explicit preferred profile `typescript-cli`, TypeScript, Node.js, Playwright/Chromium, CLI-first reusable engine;
- Windows support and deterministic local fixture/testing expectation;
- documentation expectations, including Description/Milestones preservation and high-level Roadmap rule;
- major exclusions (viewer/annotation/comparison/contracts/source mapping/cloud/auth/cross-browser and ecosystem runtime dependencies);
- exact paths to all authoritative inputs and an instruction that agents must read/reconcile them.

At run creation this information is stored only as text. Detailed schema, safety, module ownership, exact file layout, commands, and acceptance decisions belong in their later stages after the agent reads the source documents; they should not be prematurely converted into implementation batches in the request.

# 8. Recommended Starter Profile

Select `typescript-cli` explicitly in the `idea-brief`/`starter-profile` artifacts.

Reason: Milestone 1 is TypeScript + Node.js, command-line first, launches Chromium through Playwright, writes local artifacts, and requires the observation engine to remain independent of presentation. `nextjs-app` is a web-application scaffold and would incorrectly make the later Milestone 7 viewer shape the initial repository. `android-compose` is unrelated. A future local viewer can be added around the same engine in its scheduled later milestone without changing the bootstrap profile.

There is no `--profile` CLI option and `start` does not resolve the profile. The coding agent records `preferredProfile: typescript-cli` in the normalized brief and resolves it at `starter-profile`.

# 9. Recommended Standardized Initial Documents

## Required immediately as bootstrap authority

| Document | Purpose |
| --- | --- |
| preserved Project Description | Retain full problem, users, capabilities, stack direction, ecosystem identity, constraints, and long-term intent locally. |
| preserved Project Milestones | Retain all ten milestones, exact order, dependencies, cross-milestone rules, acceptance expectations, and exclusions. |
| `PROJECT_OVERVIEW.md` (or clearly designated equivalent) | Concise canonical product/evidence-domain overview and companion boundaries; link to the full Description/Milestones rather than replacing them. |
| `ROADMAP.md` | High-level version specifications derived from milestone order: capability requirements, architectural constraints, acceptance expectations, dependencies, exclusions, and forward-looking design. No batches. |
| `ARCHITECTURE.md` | Set ownership boundaries before files are scaffolded: CLI/application engine/browser adapter/schema/artifact writer/fixtures, external targets, and non-dependencies. |
| observation artifact/schema document | Own artifact kind/version, manifest/completion semantics, provenance, page/element evidence, observed/derived status, diagnostics, boundedness, paths, evolution, and compatibility. Exact schema is a greenfield design decision. |
| safety/limitations document | Define local/browser/network boundary, schemes/redirects/timeouts/certificates/downloads/popups/permissions/secrets, target immutability, unsupported cases, and claim limits before navigation implementation. |
| `DEVELOPMENT.md` (possibly with `TESTING.md`) | Local setup plus deterministic fixture, unit, integration, browser, CLI, schema, path-safety, and validation strategy. |
| documentation preservation/governance policy | Declare canonical ownership, current-state versus planning authority, no silent milestone reordering/compression, and keep batch bookkeeping out of Roadmap. |

## Useful immediately

- `WORKFLOWS.md`: document the initial capture/fixture/artifact-consumption workflow and later before/after workflow only as future scope. This helps agents use artifacts consistently.
- A small unresolved-decisions record: isolate decisions not yet accepted so placeholders do not become invented commitments.

## Wait until implementation exists

- `COMMANDS.md`: create once actual flags, stdout/stderr, JSON, exit codes, and failures exist. During scaffold planning, put the intended interface contract in architecture/scaffold artifacts without claiming commands are implemented.
- Release/readiness guide, changelog, compatibility matrix, current-state document, viewer guide, and adapter guides: add when corresponding implementation/release surfaces exist.

Do not copy every companion-project document. Add a document only when this repository owns the corresponding contract.

# 10. Pre-Scaffold Design Decisions

Before `scaffold-implementation`, these decisions must be represented in completed upstream artifacts:

| Decision | Stage where it should be settled |
| --- | --- |
| CLI-first initial product interface; graphical viewer deferred | `idea-brief` and `product-boundary` |
| Runtime evidence producer identity; separate versioning/execution; no static-index/orchestrator/lab runtime ownership | `product-boundary` |
| TypeScript/Node/Playwright/Chromium and `typescript-cli` profile | `stack-decision`, then `starter-profile` |
| Reusable observation engine separated from CLI and browser-specific adapter | architecture content in `bootstrap-bundle`/`project-docs`, made concrete in `scaffold-plan` |
| Artifact owner and initial schema direction, completion/provenance/boundedness/diagnostics | `project-docs`, finalized enough for target files and acceptance in `scaffold-plan` |
| Browser/network safety and target-immutability boundary | `product-boundary` and safety documentation content; executable implications in `scaffold-plan` |
| Deterministic local fixtures and test layers | `stack-decision`/`project-docs`; exact targets and commands in `scaffold-plan` |
| First vertical slice: supplied local URL + viewport + explicit target → Chromium observation + screenshot + structured evidence + local artifact/result | `product-boundary`, then exact acceptance in `scaffold-plan` |
| Ecosystem non-dependency rules and later opaque correlation seam | `product-boundary`/architecture docs; enforce in scaffold non-goals |
| Exact planned repository docs and preservation treatment | `project-docs` and `scaffold-plan` target paths/documentation expectations |

These are decisions the greenfield analysis must settle, not architecture designs supplied by this reconnaissance. Any unresolved implementation-blocking item must be marked unresolved/blocked rather than guessed.

# 11. ROADMAP.md Placement and Role

The current 13-stage workflow has no native `roadmap` stage or roadmap artifact. The bootstrap bundle’s default in-memory document names also do not include `roadmap`. Starting a run does not create it.

Recommendation:

1. During `project-docs`, derive a reviewed high-level roadmap specification from the preserved Milestones and user convention.
2. During `scaffold-plan`, list `ROADMAP.md` explicitly in `Target paths:` and state its complete content/authority contract in `Documentation expectations:`.
3. During `scaffold-implementation`, create the file and list it under `Files changed:`.
4. Review it manually because current profile readiness does not guarantee this project-specific filename/content contract.

Required semantic rule:

```text
ROADMAP.md
→ high-level version specification
→ enough capability, architectural constraint, acceptance, dependency,
  exclusion, sequencing, and forward-looking design information for a future
  planner to construct an implementation plan after repository inspection
→ no implementation batches or prewritten batch-by-batch instructions
```

Implementation plans and batch decomposition are created later, after reading the selected roadmap version, inspecting current repository state, and doing required retrieval/architecture work. They belong in run artifacts or local execution plans, not Roadmap.

# 12. Initial Index and Post-Greenfield Transition

`initial-index` is stage 11, after scaffold implementation, first vertical slice, and implementation verification. Before it begins, the project should have its intended repository boundary, source/configuration, documentation, deterministic fixtures/tests, a working minimal observation, and recorded successful required validation.

The orchestrator does not run `my-dev-kit`. A user/coding agent runs the producer. Current ecosystem documentation and npm metadata identify `@dailephd/my-dev-kit@1.12.1`; the orchestrator’s older adequacy baseline was 1.10.4 but schema-major-1 remains compatible. A representative documented command is:

```powershell
npx @dailephd/my-dev-kit@1.12.1 index --root 'Z:\Users\newuser\Projects\my-frontend-observer' --src <SOURCE_ROOT> --out 'Z:\Users\newuser\Projects\my-frontend-observer\.my-dev-kit' --call-graph --json
```

Repeat `--src` if architecture establishes multiple source roots. Then use current bounded retrieval as needed:

```text
search → lookup → slice → source symbol → bounded source range
```

The producer’s `.my-dev-kit\manifest.json` is authority for generated index artifacts. `reports/initial-index-report.txt` must record command, producer version, repository/candidate identity if Git exists by then, source roots, index/manifest path, representative retrieval evidence, limitations/truncation, and result. The report—not stage name alone—proves indexing occurred.

After an accepted `PASS` judge and final report/export, the repository is an established project. Later version/feature work uses `feature`, `repair`, `test`, `refactor`, or `harden`, with fresh `my-dev-kit` evidence as applicable. A dedicated automated greenfield-to-feature handoff is planned for orchestrator v1.4.0 and is not current behavior; this transition is manual in v1.3.0.

Architecture Assimilation is a manual onboarding gate for an unfamiliar **established** repository before later implementation planning. It is not a native greenfield stage. It is unnecessary during the initial greenfield run, and the existing ecosystem reconnaissance already establishes companion boundaries. After greenfield, a future agent unfamiliar with the now-established observer should perform Architecture Assimilation before planning implementation; targeted cross-project assimilation is especially appropriate when an actual orchestrator/lab adapter is proposed.

# 13. Recommended Bootstrap Sequence

Do not execute this sequence as part of reconnaissance.

1. **Manual preservation, before CLI mutation:** confirm the three input paths; plan repository-local verbatim copies (or exact hashes/external locations); record unresolved decisions separately. Do not edit the sources.
2. **User terminal:** verify Node.js 24+, then run `npx @dailephd/my-dev-kit-orchestrator@1.3.0 init --root $projectRoot`. This creates only orchestrator workspace state.
3. **User terminal:** run pinned `start --mode greenfield --root $projectRoot --name frontend-observer-bootstrap "<bounded request>"`. Omit `--output-dir`. Capture `<run-id>` from output/status.
4. **For stages 1–7:** user runs `prompt --root $projectRoot --run <run-id>`; the orchestrator prints a bounded prompt; ChatGPT augments the execution instruction with the exact authoritative file reads; the coding agent performs documentation/design work only; the required JSON/text artifact is saved in the run folder; user runs `check --artifacts`/`status`; use `mark` only for an explicit incomplete/block/complete lifecycle decision.
5. **At `project-docs`:** coding agent prepares/validates in-memory content and saves only `artifacts/project-docs-report.txt`; no repository documentation is created yet.
6. **At `scaffold-plan`:** coding agent produces `artifacts/scaffold-plan.txt` with `Profile: typescript-cli`, safe normalized target paths (including approved initial docs and `ROADMAP.md`), profile commands, first behavior, tests, documentation expectations, unresolved decisions, and non-goals. ChatGPT reviews it before authorizing implementation. No batches are written into Roadmap.
7. **At `scaffold-implementation`:** only now does the coding agent create actual repository documentation/configuration/scaffold files authorized by the plan. It saves `reports/scaffold-implementation-report.txt` with exact `Profile:` and `Files changed:` evidence. Run readiness checks.
8. **At `first-vertical-slice`:** coding agent implements only the Milestone 1 bounded observation flow and saves `artifacts/first-vertical-slice.txt`. This is implementation, not a future-version batch plan.
9. **At `verification`:** coding agent runs actual required TypeScript/test/browser/build commands and records every required/optional result and evidence in `artifacts/verification-report.txt`. Run `check --all --strict` when artifacts are mature.
10. **Manual Git transition, only when separately authorized:** after explicit ignore rules and verified scaffold exist, initialize this repository, inspect explicit files, and create the initial independently versioned commit. The orchestrator does not do this. Do not mix generated `.my-dev-kit`, orchestrator run state, credentials, or browser output into Git accidentally.
11. **At `initial-index`:** coding agent/user runs pinned `my-dev-kit` indexing and bounded retrieval; producer writes `.my-dev-kit`; agent saves `reports/initial-index-report.txt` with evidence.
12. **At `judge` and `final-report`:** agent saves the judge report; correct any routed stage; only accepted `PASS` with all gates complete permits the final report. Save `artifacts/final-report.txt`, run `check --all --strict`, inspect `status`, and export a portable handoff.
13. **Immediately before first implementation-version planning:** treat greenfield as complete, read the preserved forward-looking documents and the now-current repository docs, inspect Git/index/current implementation, perform Architecture Assimilation if the planner is unfamiliar with the established repository, select the first Roadmap version, retrieve architecture evidence, and only then design its implementation steps/batches outside `ROADMAP.md`.

# 14. Risks and Unresolved Questions

| Classification | Issue | Required handling |
| --- | --- | --- |
| blocks bootstrap | None found. | Published 1.3.0, profile, inputs, and workflow are identifiable. |
| must be decided during greenfield | Exact observer artifact kind/schema, manifest/completion model, and observed-vs-derived vocabulary. | Resolve before scaffold implementation in project-docs/scaffold-plan architecture work. |
| must be decided during greenfield | Browser/network/security policy, screenshot/readiness behavior, target cardinality, and sensitive-output handling. | Navigation implementation must not start until bounded policy/acceptance is explicit. |
| must be decided during greenfield | Exact CLI contract and whether any public programmatic API is promised. | Keep CLI first and internal reusable seam; defer public API unless explicitly accepted. |
| must be decided during greenfield | Exact initial file layout, package manager, validation commands, fixture host, and project document paths. | Set in stack/profile/scaffold plan; do not infer from profile name alone. |
| must be decided during greenfield | Preservation layout for the two external authoritative planning files. | Prefer repository-local verbatim copies plus complete canonical derived docs; record hashes if location remains external. |
| must be decided during greenfield | Screenshot mode/timing and cross-platform pixel expectations. | Separate semantic evidence from pixel-sensitive evidence and state what v0.1 requires. |
| safe to defer until later version planning | Viewer/UI, comparison, regression contracts, annotations, cross-browser, source ownership, orchestrator adapter, lab reader, shared schema package. | Preserve milestone order and explicit exclusions; do not scaffold them now. |
| safe to defer until later version planning | Full Architecture Assimilation across companion repositories. | Existing reconnaissance is enough for v0.1 boundaries; run targeted assimilation when integration is proposed. |
| safe operational limitation | v1.3.0 has no automatic greenfield-to-feature handoff. | Use the manual post-greenfield transition described above. |
| safe operational limitation | Custom-output runs are not resumable/discoverable. | Never use `--output-dir` for this run. |
| safe evidence ambiguity | Local repository build has no identifiable Git commit or durable full-validation record. | Use published pinned 1.3.0 instead. |
| safe documentation contradiction | Two current docs still say v1.3 readiness is “implemented but unpublished,” contradicting README/Architecture current-release text, published roadmap, package metadata, and npm. | Treat it as stale prose; record rather than hide it. |
| safe current-check limitation | Current readiness does not natively require every project-specific recommended doc by filename, and check commands can persist result files despite being lifecycle-read-only. | Put exact docs in scaffold target paths and manually review; understand checks may write run-local evidence. |

# 15. Recommended Next Action for ChatGPT

In a new explicitly authorized bootstrap task, ChatGPT should:

1. reread this report and the three authoritative observer inputs;
2. construct a bounded `start --mode greenfield` request containing identity, Milestone 1, `typescript-cli`, documentation/roadmap rules, exclusions, and exact source paths;
3. show the proposed request and planned pinned commands for user approval if the user has not already authorized workspace initialization;
4. then execute the 13-stage manual prompt/artifact loop, refusing scaffold implementation until stages 1–7 settle the pre-scaffold decisions in Section 10.

Do not create `ROADMAP.md`, repository planning documents, Git state, source scaffolding, or an orchestrator run as part of this reconnaissance.

FINAL_STATUS: READY_TO_START_GREENFIELD_BOOTSTRAP
