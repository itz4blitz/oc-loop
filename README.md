<div align="center">

# oc-loop

**Safe autonomous loops for OpenCode 2.**

Durable, event-sourced workflow loops with fail-closed admission, budgets, and a full audit trail — registered as an `oc_loop` agent tool your model drives.

[![CI](https://github.com/itz4blitz/oc-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/itz4blitz/oc-loop/actions/workflows/ci.yml)
[![Mutation](https://img.shields.io/badge/mutation-100%25%20(0%20survived)-brightgreen)](stryker.config.mjs)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)](vitest.config.ts)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Loops are how you get an agent to keep working: *fix the tests, review the diff, watch the logs, continue the task.* The hard part isn't starting the loop — it's stopping it from misfiring. `oc-loop` is the engine that makes loops safe:

- **Fail-closed admission** — a run dispatches only when the host is verified idle with no active tool, busy child, foreground turn, or lease. Anything unknown blocks.
- **No overlap, no runaway** — one in-flight run per loop, a 30s dispatch floor between runs, and hard `maxRuns` / `maxFailures` / `maxRuntimeMs` budgets.
- **Durable and crash-safe** — fsync'd atomic writes, exclusive per-stream locks, compare-and-set appends. If the server dies mid-run, the run is marked `unknown` and never silently retried.
- **Auditable** — every state change is an event in a per-loop stream; `timeline` and `doctor` render it.

## Quick start

**Requirements:** Node ≥ 22, OpenCode ≥ `0.0.0-beta-18155`.

```sh
git clone https://github.com/itz4blitz/oc-loop.git
cd oc-loop && npm install && npm run build
```
Register the built entry in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["@itz4blitz/oc-loop"]
}
```

**npm install:** `npm install -g @itz4blitz/oc-loop` (or build from source: `npm install && npm run build`, then register by path `"/path/to/oc-loop/dist/src/server.js"`).

Restart OpenCode and ask:

> *Create a loop that keeps the tests green.*
> *List my loops.*
> *Run the test-fix loop now.*

The model calls the **`oc_loop`** tool — you get structured results, not prompt spam.

> State lives per project under `.opencode/itz4blitz/oc-loop/` (`catalog.json`, event `streams/`, `snapshots/`). Override with `OC_LOOP_ROOT`.

## Slash commands

Every action also has a palette command with an instant synthetic reply (server-side, no model round-trip):

| Command | Does |
|---|---|
| `/loop` | Create an idle loop bound to the current session (`/loop <prompt>`, `--session <id>`, `--worktree <path>`) |
| `/loop-list` | List loops in this project |
| `/loop-now <id>` | Force one dispatch immediately |
| `/loop-pause <id>` · `/loop-resume <id>` | Park / continue a loop |
| `/loop-stop <id>` | Terminate a loop |
| `/loop-show <id>` | Status and event count |
| `/loop-logs <id>` | Raw event log |
| `/loop-timeline <id>` | Rendered event timeline |
| `/loop-doctor [id]` | Diagnose one loop or all |
| `/loop-template [name] [--worktree <path>]` | Clone `continuation`, `test-fix`, `review`, or `watch` |
| `/loop-export` | Export all loops as JSON |
| `/loop-import <json>` | Import loops (skips existing ids) |

## The `oc_loop` tool

One tool, 15 actions:

| Action | Does |
|---|---|
| `create` | New loop — prompt, session/worktree binding, optional template |
| `list` · `show` · `logs` · `timeline` | Inspect loops and their audit trails |
| `now` | Force one dispatch immediately |
| `pause` · `resume` · `stop` | Lifecycle: park, continue, terminate |
| `doctor` | Diagnose a loop — status, trigger cursor, host health, dispatch rate |
| `template` | Clone a template: `continuation`, `test-fix`, `review`, `watch` |
| `set` | Update fields: name, prompt, trigger kind and params, budgets, permissions |
| `export` · `import` | Versioned JSON transfer; import never overwrites existing ids |

## Triggers and nodes

| Trigger | Fires |
|---|---|
| `idle` | When the host reports an idle boundary |
| `manual` | Only on explicit `now` |
| `once` | At/after `atMs`, exactly once |
| `interval` | Every `everyMs`; missed periods coalesce |

| Node kind | Behavior |
|---|---|
| `prompt` | Sends a prompt to the bound session |
| `command` | Runs a shell verification (default timeout 10 min) — gates on exit code |
| `condition` | Runs a command, dispatches `passPrompt` or `failPrompt` on the result |
| `approval` | Parks the loop until explicitly resumed |

Templates give you a starting point: **continuation** (idle, keep going), **test-fix** (condition node gated on `pnpm test`), **review**, **watch** (60s interval).

## Safety guarantees

- **Fail-closed admission** — dispatch requires verified idle host; unknown/failed status reads block. Duplicate-prompt protection via idempotency keys.
- **Dispatch floor** — 30s minimum between dispatches per loop; rapid-fire triggers block with `dispatch-floor` (visible in timeline + doctor).
- **Budgets** — `run-budget` and `failure-budget` blocks when `maxRuns` / `maxFailures` are hit.
- **No overlap** — per-loop event processing is serialized; triggers coalesce while work is pending.
- **Orphan recovery** — a server crash mid-run marks the run `unknown`; it is never retried without explicit reconciliation.
- **Crash-safe persistence** — temp file → fsync → atomic rename; `O_EXCL` lock files serialize appends; expected-sequence CAS on streams; `0600` files in `0700` dirs.
- **Self-validating store** — schema-validated appends and replays, strict sequence continuity, corrupt input throws instead of corrupting state.

## Quality gates

CI runs five gates on every push:

```text
typecheck (tsc --noEmit, strict)
tests      (173, vitest)
coverage   (100% lines / statements / functions / branches — hard bar)
mutation   (Stryker, ~1,500 mutants, 0 survivors — break threshold 100)
smoke      (live-artifact: built plugin driven end-to-end in isolation)
```

`prepublishOnly` re-runs all of them plus the build.

## Docs

- [Architecture](ARCHITECTURE.md) — entity model and design decisions
- [Plan](PLAN.md) — phased plan and acceptance criteria
- [Research](RESEARCH.md) — OpenCode 2 beta capability findings
- [Coordination](COORDINATION.md) — multi-session working agreement

## License

[MIT](LICENSE)
