# oc-loop

A safe autonomous loop/workflow plugin for **OpenCode 2**, registered as an `oc_loop` agent tool. Loops are durable, event-sourced jobs with triggers, admission gating, budgets, and an audit trail — never an unsafe "keep pinging the model" loop.

## Install (local dev)

```json
// ~/.config/opencode/opencode.json → "plugins"
"/home/blitz/Development/itz4blitz/oc-loop"
```

Restart OpenCode. The plugin registers:

- the **`oc_loop` tool** (list, create, now, pause, resume, stop, show, logs, timeline, doctor, template, set, export, import)
- an **idle + clock trigger source** per session (idle-boundary and 1s clock ticks)

## Usage

Ask the agent — the model calls `oc_loop`:

```text
/loop create Fix the failing tests
/loop list
/loop now <id>          force one dispatch
/loop pause <id>        park it (resumable)
/loop stop <id>         terminal
/loop doctor [id]       diagnostics
/loop timeline <id>     event audit trail
/loop template watch    clone the 60s watch-and-respond template
/loop set <id> --every-ms 30000
```

## Guarantees

- **Fail-closed admission**: dispatch requires an observed idle host, no active tool, no busy child, no foreground turn, no active lease. Unknown status blocks.
- **No overlap**: one in-flight run per loop; `steer` never interrupts; delivery is queued.
- **Budgets**: `maxRuns`, `maxRuntimeMs`, `maxFailures` are enforced per loop.
- **Dispatch floor**: a loop cannot re-dispatch within 30s; rapid-fire blocks surface as `dispatch-floor` in the timeline and doctor.
- **Durable state**: fsync'd atomic writes, per-stream locks, compare-and-set appends, snapshot-aware replay.
- **Crash recovery**: runs persisted `running` when the server dies become `unknown` and are never retried automatically.

## State

- Catalog: `<project>/.opencode/itz4blitz/oc-loop/catalog.json`
- Event streams: `<project>/.opencode/itz4blitz/oc-loop/streams/`
- Snapshots: `<project>/.opencode/itz4blitz/oc-loop/snapshots/`

Override the root with `OC_LOOP_ROOT` (useful for tests).

## Docs

- [Architecture](./ARCHITECTURE.md) — design and entity model
- [Plan](./PLAN.md) — phased implementation plan and acceptance criteria
- [Coordination](./COORDINATION.md) — multi-session working agreement (delete when solo)

## Quality bar

100% line/statement/function/branch coverage on domain, persistence, scheduler, host, and app layers; **zero surviving Stryker mutants** with a 100% break threshold; live-artifact smoke test (`npm run smoke`) wired into `prepublishOnly`.
