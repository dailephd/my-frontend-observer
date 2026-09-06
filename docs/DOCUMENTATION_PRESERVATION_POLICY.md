# Documentation Preservation Policy

Current explicit user decisions have highest authority. The complete
repository-local Project Description then owns durable product intent, and the
complete repository-local Project Milestones owns capability ordering, major
requirements, acceptance expectations, and cross-milestone rules. ROADMAP
derives version-level direction from both. Actual repository evidence is the
authority for claims about current implementation and release state. Accepted
greenfield artifacts may prove an approved design decision but do not alone
prove implementation. Reconnaissance informs decisions but does not replace
intent.

Responsibilities are distinct:

- `PROJECT_DESCRIPTION.md` contains complete durable product intent, the three
  primary jobs, long-term product model, principles, and ecosystem boundaries.
- `PROJECT_MILESTONES.md` contains the complete ordered capability design,
  acceptance expectations, and cross-milestone rules.
- `ROADMAP.md` owns version-level goals, constraints, dependencies, exclusions,
  ecosystem implications, acceptance, and unresolved planning decisions.
- `docs/plans/<version>-implementation-plan.md`, when present, owns the frozen
  concrete implementation plan produced at version start after the roadmap and
  current repository state have been inspected. It may contain implementation
  architecture decisions, batch structure, sequencing, batch acceptance gates,
  validation expectations, explicit exclusions, and the post-implementation
  handoff into documentation reconciliation and release-readiness workflows.
  It is a planning authority only and never proves that a batch or version was
  actually implemented.
- `CURRENT_STATE.md` describes only actual implementation, scaffold, validation,
  and release state.
- `ARCHITECTURE.md` describes implemented architecture and may include clearly
  labeled durable or planned extension constraints.
- `PROJECT_OVERVIEW.md` is concise navigation and orientation; it does not
  replace the complete authorities.

Once a version-specific implementation plan is explicitly frozen, coding-agent
prompts for that version must preserve its scope and batch order unless the user
explicitly revises the plan. Batch execution reports may document what happened
but do not silently rewrite the plan. If implementation evidence requires a
change, record the explicit plan revision in the version plan before subsequent
batches are treated as governed by the new sequence.

ROADMAP must not override Project Description or Project Milestones on durable
intent, and it must never contain prewritten implementation batches, command
transcripts, or execution bookkeeping. A version plan must not promote a
future-version capability into the current version or contradict the roadmap's
version-level scope. Current-state documents do not override future product
intent merely because implementation is incomplete. Before deleting,
relocating, or replacing a source document, verify that all unique information
and useful historical provenance remain.
