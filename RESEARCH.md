# oc-loop Research

## OpenCode Plugin Surface

We target the latest OpenCode 2 beta installed in the development environment. Because the beta moves faster than published documentation, the installed `@opencode-ai/plugin` and `@opencode-ai/plugin/tui` type surfaces are authoritative for each build.

- The current V2 server target uses `@opencode-ai/plugin` and `Plugin.define({ id, setup })`.
- The TUI target is version-sensitive: current V2 documentation shows `Plugin.define({ id, setup(context) })`, while the latest checked runtime types/spec may expose the target-exclusive `default { id, tui(api, options, meta) }` surface. We will implement against the installed beta and isolate this adapter.

The TUI API currently provides the pieces needed for a native terminal experience:

- Current documented V2 slots include `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`, `session.composer.top`, `sidebar.content`, and `sidebar.footer`.
- V2 `context.ui` dialogs, slots, routes, and toasts; `context.keymap` commands and bindings; `context.data` state/events; and `context.storage` persistence.
- Routes, keymap layers, command-palette commands, mode-aware bindings, and lifecycle cleanup.
- `api.client` for session operations and `api.state` for synchronized session status, messages, todos, permissions, and paths.
- `api.event.on(...)` for the TUI event stream and `api.kv` for persisted UI state.

Important constraints:

- The API is beta and changes quickly. Pin a compatible OpenCode/plugin version and isolate host calls behind an adapter.
- Loading and packaging behavior varies by host release, so compatibility smoke tests are mandatory.
- A module cannot be both a server and TUI module. A package targeting both needs separate `./server` and `./tui` entrypoints.
- The current TUI has slots and routes, but no stable arbitrary desktop/web frontend plugin API. Do not couple the core engine to Solid/OpenTUI.
- V2 storage is plugin-scoped; legacy KV requires an explicit `oc-loop/` namespace.
- External TUI loading and OpenTUI dependency identity have had release regressions; pin and test exact versions.

## Existing loop patterns

`@bybrawe/opencode-loop` validates the important scheduling semantics:

- Separate **due time** from **safe dispatch**.
- Never inject a turn over a busy model, tool, retry, or child session.
- Treat timer, idle, one-shot, and file-watch triggers as different modes.
- Persist jobs per session and expose status, logs, doctor, pause, resume, stop, clear, and now controls.
- Use bounded retries and conservative failure-closed behavior for network/status uncertainty.
- Support a daemon for work that must survive the interactive TUI.

We should learn from it, not duplicate it blindly. Its stable package currently targets the v1 server plugin range and does not claim full OpenCode 2 parity, which makes an adapter and our own tests necessary.

## Product implications

The chat bar is the right primary control surface because a loop is usually created in the context of a current session and prompt. A persistent manager is still required for visibility and control. The UI must make these distinct facts obvious:

- `waiting`: trigger has not fired.
- `due`: trigger fired, waiting for admission.
- `blocked`: safety guard prevented dispatch.
- `running`: this job owns a turn.
- `paused`, `completed`, `failed`, `cancelled`.

Sources consulted: [OpenCode V2 CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli), [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins/), [TUI plugin specification](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/specs/tui-plugins.md), [current TUI types](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/plugin/src/tui.ts), and OpenCode issue reports about external TUI loading. The compatibility spike records the exact installed binary, SDK version, and git commit used for every smoke test.
