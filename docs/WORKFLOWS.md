# Workflows

## Current greenfield foundation workflow

```text
install scaffold dependencies
→ validate types and lint
→ run the empty foundation test runner
→ build placeholder CLI/library entries
→ validate documentation
→ inspect package inventory when needed
```

This workflow validates project infrastructure only. It does not validate any
browser/runtime evidence capability.

## Planned v0.1 observation workflow

ROADMAP v0.1 requires a future workflow that accepts a local target URL,
viewport, explicit observation targets, and output location; runs real Chromium;
captures a screenshot and bounded page/target evidence; and writes one versioned
observer-owned artifact. That workflow is not executable today.

The future dependency order after observation is:

```text
stable targets and bounded runtime behavior
→ relationships, comparison, and safe-change contracts
→ bounded agent context plus runtime/static ecosystem integration
→ text/config-driven coding-agent change review
→ interactive viewer
→ structured visual annotation
→ full visual human–LLM workflow
```

None of these later workflows is implemented. The v0.7 coding-agent workflow
must work without the v0.8 viewer or v0.9 annotation system.
