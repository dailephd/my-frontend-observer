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
- `CURRENT_STATE.md` describes only actual implementation, scaffold, validation,
  and release state.
- `ARCHITECTURE.md` describes implemented architecture and may include clearly
  labeled durable or planned extension constraints.
- `PROJECT_OVERVIEW.md` is concise navigation and orientation; it does not
  replace the complete authorities.

ROADMAP must not override Project Description or Project Milestones on durable
intent, and it must never contain prewritten implementation batches, command
transcripts, or execution bookkeeping. Current-state documents do not override
future product intent merely because implementation is incomplete. Before
deleting, relocating, or replacing a source document, verify that all unique
information and useful historical provenance remain.
