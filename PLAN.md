# oc-loop Implementation Plan

## Phase 0: compatibility spike and product contract

- Record the exact latest installed `opencode2` binary, SDK package versions, and commit/build metadata; inspect installed server and TUI types rather than relying on docs alone.
- Build minimal V2 and legacy probes that register a current prompt/footer slot, palette command, dialog, route, and cleanup handler.
- Verify lifecycle disposal, hot reload behavior, session status events, and config installation.
- Verify that execution survives TUI closure through the shared OpenCode service; durable restart recovery is required, while an external worker is deferred until service-shutdown durability is needed.
- Define versioned schemas for workflows, executions, attempts, events, policies, and migrations.

## Phase 1: safe single-loop foundation

- Implement idle, interval, once, and manual triggers.
- Add durable workflow/run state, atomic persistence, and structured logs.
- Add the admission gate with no-overlap and busy/child/retry checks.
- Add `/loop`, `/loop list`, `/loop show`, `/loop pause`, `/loop resume`, `/loop stop`, `/loop now`, `/loop logs`, and `/loop doctor`.
- Add chat-bar affordance and a minimal manager dialog.

Acceptance: a loop can be created from the current session, survives TUI reload, never overlaps a live turn, and can always be stopped.

## Phase 2: premium operations

- Add backoff, failure limits, max runtime, max runs, coalescing, orphan recovery, and doctor diagnostics.
- Add progress-file support and privacy-safe notifications.
- Add tests with a fake clock and fake host adapter for every state transition and race.
- Add a daemon/worker only if session-bound execution cannot meet the required “survive closed TUI” use case.
- Add durable leases/fencing, orphan reconciliation, crash-safe dispatch identifiers, privacy redaction, resource budgets, and structured diagnostics.
- Add templates for test/fix, review, implementation continuation, and watch/respond workflows.

## Phase 3: workflow primitives

- Add explicit verification command nodes.
- Add conditions based on command result and structured model outcome.
- Add approval nodes and pause/resume handoff.
- Add a session/worktree binding selector.
- Add import/export of versioned workflow JSON.

## Phase 4: graph UX and packaging

- Add a read-only run graph/timeline before a graph editor.
- Add cloneable templates: dev continuation, test/fix, review loop, watch-and-respond.
- Publish separate server/TUI package exports with `engines.opencode` compatibility.
- Add migration/version handling for persisted state and a beta API compatibility matrix.
- Add visual composition only after read-only timelines demonstrate real demand; graph editing is not a prerequisite for graph-capable execution.

## Quality Gates

- Red-green-refactor for every behavior and regression.
- Strict TypeScript, lint, formatting, and dependency audit.
- 100% core line, statement, function, and branch coverage.
- Zero surviving Stryker mutants in domain, scheduler, persistence, and host normalization.
- Property-based and model/state-machine tests with retained seeds.
- Persistence crash/recovery and duplicate-dispatch tests.
- Host adapter contract tests against fakes and every pinned OpenCode version.
- Real plugin load, slot, command, dialog, route, disposal, and reload smoke tests.

## Locked Decisions

- Primary target is the latest OpenCode 2 beta, not V1.
- V2 server `Plugin.define` is authoritative for execution.
- TUI API compatibility is isolated behind a thin adapter and proven against installed types.
- Server runtime owns scheduling, persistence, admission, and dispatch.
- TUI owns presentation and user intents only.
- Canonical runtime state uses crash-safe filesystem persistence; host storage is not assumed transactional.
- A loop is a constrained single-node workflow, not a separate engine.
- No automatic retry after an uncertain prompt submission without reconciliation or explicit user policy.
- Autonomous execution defaults to queue delivery, bounded budgets, no overlap, safe worktree isolation, and approval for side effects.
- Premium completion requires evidence, not a model claim: configured tests/checks and an explainable audit trail.

## Test matrix

- Idle, busy, retrying, active tool, busy child, unknown status, and status API failure.
- Timer expires during a turn; confirm one deferred run, not two.
- Concurrent manual run and timer run; confirm idempotent admission.
- Crash during dispatch; restart and reconcile without duplicate prompt.
- Stop/pause while due, blocked, and running.
- Permission ask/deny and unattended safe profile.
- Session deletion, worktree change, plugin deactivate/reactivate.
- TUI slot unavailable or API drift; engine remains usable through commands.
