# Codex Usage Monitor — Research

Research date: 2026-08-12 (Asia/Seoul)

## Scope

This document records the technical basis used by `codex-usage-monitor` before implementation. The goal is to read ChatGPT Codex rate-limit state without scraping the interactive `/status` screen or the ChatGPT website.

## Verified Codex CLI version

- Latest stable GitHub release checked on 2026-08-12: **0.147.0** (`rust-v0.147.0`, published 2026-08-07).
- The Docker image pins this verified version instead of installing an unbounded `latest` version.
- The npm wrapper package is `@openai/codex`; the release source declares Node.js `>=16` for the wrapper.

## Machine-readable rate-limit interface

### Decision

Use the first-party **Codex app-server stdio JSON-RPC interface** and call:

```json
{"method":"account/rateLimits/read","id":2}
```

after the required app-server initialization handshake.

Do **not** parse `/status` terminal text.

### Why this method

At `rust-v0.147.0`, the official `openai/codex` repository documents `codex app-server` and the `account/rateLimits/read` method and ships a JSON schema for its response. The CLI source also confirms that `codex app-server --stdio` is a real 0.147.0 option and is equivalent to `--listen stdio://`.

The response includes structured rate-limit windows with:

- `usedPercent`
- `windowDurationMins`
- `resetsAt` (Unix timestamp, seconds)
- `rateLimitReachedType` when provided by the backend
- `spendControlReached` when provided by the backend
- optional credits / reset-credit metadata
- optional `rateLimitsByLimitId` for multiple metered limit buckets

The Codex source also shows that rate-limit data originates as structured backend headers/events and is mapped into `RateLimitSnapshot`. `/status` is a display layer over those structured snapshots.

The app-server request processor performs a backend rate-limit fetch through `get_rate_limits_with_reset_credits()` when `account/rateLimits/read` is requested, rather than requiring a prior interactive Codex turn.

## Required windows

Codex does not require callers to assume that `primary` always means 5-hour and `secondary` always means weekly. The official TUI labels windows from their duration.

The monitor therefore identifies required windows from `windowDurationMins`:

- approximately `300` minutes -> 5-hour limit
- approximately `10080` minutes -> weekly limit

The current Codex TUI treats a duration within ±5% of the canonical duration as that label. The monitor uses the same tolerance.

If a required window is absent, it is reported as unavailable instead of inferred. If both required windows are absent, the monitor treats the collection as failed rather than recording fabricated usage data.

## Normalization

The backend/app-server reports **used percent**. The monitor needs **remaining percent**, so it calculates:

```text
remainingPercent = 100 - usedPercent
```

and clamps the result to `0..100`.

`resetsAt` is converted from Unix seconds to an ISO 8601 timestamp internally. Telegram formatting then renders it in the configured timezone (`Asia/Seoul` by default).

Target normalized shape:

```json
{
  "checkedAt": "2026-08-12T02:30:00.000Z",
  "fiveHour": {
    "usedPercent": 58,
    "remainingPercent": 42,
    "windowDurationMinutes": 300,
    "resetsAt": "2026-08-12T05:30:00.000Z"
  },
  "weekly": {
    "usedPercent": 82,
    "remainingPercent": 18,
    "windowDurationMinutes": 10080,
    "resetsAt": "2026-08-15T23:00:00.000Z"
  },
  "rateLimitReachedType": null,
  "spendControlReached": null
}
```

No missing value is fabricated. Missing fields remain `null` / unavailable.

## Reset detection

A percentage increase by itself is not considered a reset. The monitor requires all of the following for the relevant window:

1. the previous `resetsAt` boundary has passed,
2. the current `resetsAt` moved to a later boundary,
3. remaining percentage increased.

This intentionally favors avoiding false reset notifications.

## Availability recovery

The official response includes nullable `rateLimitReachedType`. Its 0.147.0 schema defines backend states such as `rate_limit_reached` and workspace credit/usage-limit exhaustion states.

When a previous structured snapshot has a non-null `rateLimitReachedType` and a later snapshot returns `null`, the monitor can report that the official usage-limit state cleared. It does not infer availability from percentage changes alone.

## Authentication for Docker / Synology

Use normal **ChatGPT Codex authentication**, persisted outside the image through `CODEX_HOME`.

Verified in the 0.147.0 source/tests and CLI definitions:

- `CODEX_HOME` selects the Codex state directory.
- `cli_auth_credentials_store = "file"` stores credentials in `CODEX_HOME/auth.json`.
- `codex login --device-auth` supports device-code authentication suitable for a headless/container environment.
- `codex login status` is an explicit CLI subcommand for checking the current login state.
- The stored ChatGPT auth includes refresh-token state and can survive container recreation when `CODEX_HOME` is bind-mounted.

Container layout:

```text
host ./codex-data  -> /root/.codex
host ./data        -> /app/data
```

`./codex-data` and real credentials must never be committed.

## Official support / stability assessment

### Strong points

- First-party `openai/codex` implementation and documentation.
- Structured JSON-RPC response; no ANSI, locale, PTY, or terminal-layout parsing.
- The exact method, response schema, stdio option, and login commands are present in the verified 0.147.0 release tag.
- No browser automation or ChatGPT website scraping is required.

### Compatibility risk

The **`app-server` CLI command itself is explicitly marked experimental in Codex 0.147.0**. Although the method is documented and schema-backed in the first-party repository, it must not be treated as a version-independent stable public web API. Future Codex CLI releases can change commands, methods, or schemas.

Mitigation:

1. Pin Codex CLI to `0.147.0` initially.
2. Keep the app-server interaction isolated in `src/codex.js`.
3. Validate the method/schema before changing the pinned Codex version.
4. Keep this research document updated when the version changes.

This risk is lower than parsing interactive `/status` terminal output, because the chosen path remains structured and first-party, but version pinning is required.

## Data availability

| Data | Status | Source |
|---|---|---|
| 5-hour used/remaining percentage | Available when backend returns the 5-hour window | `RateLimitWindow.usedPercent`, duration-based classification |
| 5-hour reset | Available when `resetsAt` is present | `RateLimitWindow.resetsAt` |
| Weekly used/remaining percentage | Available when backend returns the weekly window | `RateLimitWindow.usedPercent`, duration-based classification |
| Weekly reset | Available when `resetsAt` is present | `RateLimitWindow.resetsAt` |
| Backend rate-limit reached state | Available when provided | `rateLimitReachedType` |
| Spend-control reached state | Available when provided | `spendControlReached` |
| Purchased/earned credit details | Only when backend provides them | credits / reset-credit fields; not required for the initial monitor |

## Sources checked

Official OpenAI / Codex sources only for the implementation decision:

- `openai/codex` release `rust-v0.147.0`
- `codex-rs/cli/src/main.rs`
- `codex-rs/app-server/README.md`
- `codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json`
- `codex-rs/app-server/src/request_processors/account_processor.rs`
- `codex-rs/codex-api/src/rate_limits.rs`
- `codex-rs/tui/src/status/rate_limits.rs`
- `codex-rs/tui/src/chatwidget/rate_limits.rs`
- `codex-rs/cli/tests/login.rs`
- OpenAI Help / Codex getting-started documentation for ChatGPT sign-in and plan usage context

## Implementation decision

Proceed using:

1. Node.js monitor process.
2. Spawn pinned `codex app-server --stdio` for a rate-limit read.
3. Complete `initialize` -> `initialized` handshake.
4. Request `account/rateLimits/read`.
5. Normalize the Codex rate-limit snapshot into 5-hour / weekly windows by duration.
6. Compare against persisted state and emit only meaningful Telegram notifications.
7. No `/status` text parser and no browser automation.
