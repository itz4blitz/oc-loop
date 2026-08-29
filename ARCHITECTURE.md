# oc-loop Architecture

## Recommended model: workflow graph, loop-first UX

Use a small durable workflow runtime, not a timer-only loop and not a graph editor as the first product.

- **Loop** is a user-facing shorthand for a recurring workflow node.
- **Workflow** is a named collection of nodes, edges, triggers, guards, and policies.
- **Graph** is the internal representation that enables sequential steps, verification gates, conditional stop, retries, fan-out, and human approval later.

This keeps `/loop continue` delightful while avoiding a dead-end design when users ask for “implement, test, fix failures, repeat until green.”

## Core entities

```text
Workflow
  id, name, sessionBinding, status, createdAt, updatedAt
  nodes[], edges[], policy, revision

Node
  id, kind, prompt/action, trigger, guard, retryPolicy, limits

Run
  id, workflowId, nodeId, attempt, status, startedAt, endedAt, outcome

Event
  id, runId, type, timestamp, payload, hostVersion
```

Initial node kinds should be only `prompt` and `command`. Reserve `condition`, `approval`, `parallel`, and `handoff` for later, but design the discriminated union now.

Initial triggers:

- `idle`: after the current turn reaches a safe idle boundary.
- `interval`: due after a duration, then dispatched at the next safe boundary.
- `once`: one delayed dispatch.
- `watch`: file/path change marks the node due.
- `manual`: explicit Run now.

## Admission and safety

All triggers enqueue intent into one scheduler. Only the admission gate can call `session.prompt`, `session.command`, or shell actions.

The gate must verify:

1. The workflow is enabled and within run/time/failure limits.
2. No workflow-owned run is already active for the session.
3. The host session is not busy or retrying.
4. No active tool call or busy child session exists.
5. Status reads succeed; unknown status fails closed.
6. A user foreground turn is never interrupted.

Use one scheduler per session with an idempotency key `(workflowId, dueSequence)`. Missed interval ticks coalesce into one due run. Never stack missed turns.

## State and recovery

Persist project/session runtime state in `.opencode/itz4blitz/` or plugin storage with a unique `itz4blitz/` prefix. Prefer append-only event records plus compact snapshots so crashes are recoverable and logs are explainable.

Required recovery behavior:

- Rehydrate enabled workflows at plugin startup.
- Mark an orphaned `running` run as `unknown`, then reconcile against host session state before retrying.
- Never infer idle when the status API is unavailable.
- Back off infrastructure failures without consuming logical run limits.
- Make all writes atomic and serialize scheduler decisions per session.

## User experience

Chat bar:

- Add a compact loop affordance in `session_prompt_right` showing `Loop` and active count.
- Open a native dialog from click/command: prompt, schedule, limits, safety profile, progress file, and delivery mode.
- Preview the normalized meaning before creation: “Every idle boundary, send this prompt; max 20 runs; no overlap.”
- Support natural slash commands for power users: `/loop`, `/loop list`, `/loop pause`, `/loop resume`, `/loop stop`, `/loop now`.

Status surface:

- Sidebar/footer summary: active, due, blocked, last run, next due, and reason.
- Manager route for editing, pausing, cloning, inspecting runs, and viewing logs.
- Toast/attention notification only for meaningful completion, failure, or approval; never expose prompt contents in notifications.

Recommended defaults:

- No overlap.
- Idle-safe dispatch.
- One workflow per session by default for autonomous prompt loops.
- Explicit max runs or max runtime in the dialog, with a deliberate “unlimited” option.
- `ask` permissions by default; an explicit safe unattended profile can opt into `ask-never`.

## Server/TUI split

Keep the runtime in shared pure TypeScript modules:

- `domain/`: schemas, transitions, policies.
- `scheduler/`: clock, trigger evaluation, admission, retries.
- `persistence/`: event log and snapshots.
- `host/`: narrow OpenCode 2 client adapter.
- `ui/`: TUI components and commands only.

Ship separate entrypoints:

- `./server`: durable engine, commands/tools if useful, host events.
- `./tui`: chat-bar slot, dialogs, manager route, keymap.

The V2 server plugin is the sole scheduler and executor. The TUI renders state and issues intent commands; it must not own scheduling timers or execute prompts independently. TUI closure must not stop loops while the shared OpenCode service is alive. Service restart recovery is handled by durable state and reconciliation; a separate worker is only added when work must survive service shutdown or needs independent supervision.

Use a filesystem-backed event log and snapshots for canonical workflow state until the pinned V2 storage implementation proves transactional compare-and-swap, atomic multi-record updates, and cross-process lease support. V2 plugin storage remains appropriate for small UI preferences.

The runtime model is explicitly layered:

```text
Workflow revision -> Execution -> Node execution -> Attempt -> Dispatch
```

Loops are constrained single-node workflows. Existing executions pin an immutable workflow revision. Dispatches carry durable correlation and fencing identifiers, and uncertain host outcomes become `unknown` rather than being retried blindly.

## Why not a graph editor first?

Graph editing has high cognitive and implementation cost, while most first uses are “continue this until I stop it” or “run this every 10 minutes.” Build graph-capable state and APIs, but expose a loop dialog first. Add a visual graph only when conditional and parallel nodes have real demand.
