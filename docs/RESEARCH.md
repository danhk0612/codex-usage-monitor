# Codex Usage Monitor — Research

Research date: 2026-08-12 (Asia/Seoul)

## Scope

This document records the technical basis used by `codex-usage-monitor` before implementation. The goal is to read ChatGPT Codex rate-limit state without scraping the interactive `/status` screen or the ChatGPT website.

## Verified Codex CLI version

- Latest stable GitHub release checked on 2026-08-12: **0.147.0** (`rust-v0.147.0`, published 2026-08-07).
- The implementation should pin this verified version instead of installing an unbounded `latest` version.
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

At `rust-v0.147.0`, the official `openai/codex` repository documents `codex app-server` as the interface used to power rich Codex clients. Its default stdio transport is newline-delimited JSON. The same release documents `account/rateLimits/read` and ships a JSON schema for its response.

The response includes structured rate-limit windows with:

- `usedPercent`
- `windowDurationMins`
- `resetsAt` (Unix timestamp, seconds)
- `rateLimitReachedType` when provided by the backend
- `spendControlReached` when provided by the backend
- optional credits / reset-credit metadata
- optional `rateLimitsByLimitId` for multiple metered limit buckets

The Codex source also shows that rate-limit data originates as structured backend headers/events and is mapped into `RateLimitSnapshot`. `/status` is only a display layer over those structured snapshots.

The app-server request processor performs a backend rate-limit fetch through `get_rate_limits_with_reset_credits()` when `account/rateLimits/read` is requested, rather than requiring a prior interactive Codex turn.

## Required windows

Codex does not require callers to assume that `primary` always means 5-hour and `secondary` always means weekly. The official TUI labels windows from their duration.

The monitor will therefore identify required windows from `windowDurationMins`:

- approximately `300` minutes -> 5-hour limit
- approximately `10080` minutes -> weekly limit

The current Codex TUI treats a duration within ±5% of the canonical duration as that label. The monitor will use the same tolerance.

If a required window is absent, it will be reported as unavailable instead of inferred.

## Normalization

The backend/app-server reports **used percent**. The monitor needs **remaining percent**, so it will calculate:

```text
remainingPercent = 100 - usedPercent
```

and clamp the result to `0..100`.

`resetsAt` will be converted from Unix seconds to an ISO 8601 timestamp internally. Telegram formatting can then render it in the configured timezone (`Asia/Seoul` by default).

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

No missing value will be fabricated. Missing fields stay `null` / unavailable.

## Authentication for Docker / Synology

Use normal **ChatGPT Codex authentication**, persisted outside the image through `CODEX_HOME`.

Verified in the 0.147.0 source/tests:

- `CODEX_HOME` selects the Codex state directory.
- `cli_auth_credentials_store = "file"` stores credentials in `CODEX_HOME/auth.json`.
- `codex login --device-auth` supports device-code authentication suitable for a headless/container environment.
- The stored ChatGPT auth includes refresh-token state and can therefore survive container recreation when `CODEX_HOME` is bind-mounted.

Planned container layout:

```text
host ./codex-data  -> /root/.codex
host ./data        -> /app/data
```

`./codex-data` and real credentials must never be committed.

## Official support / stability assessment

### Strong points

- First-party `openai/codex` implementation and documentation.
- Structured JSON-RPC response; no ANSI, locale, PTY, or terminal-layout parsing.
- The exact interface and response schema are present in the verified 0.147.0 release tag.
- App-server stdio is the normal supported transport; the repository explicitly marks websocket transport experimental, so this project will not use websocket transport.

### Compatibility risk

`codex app-server` is versioned together with the Codex CLI and is not treated here as an independently stable public web API. Future CLI releases can change methods or schemas.

Mitigation:

1. Pin Codex CLI to `0.147.0` initially.
2. Keep the app-server interaction isolated in `src/codex.js`.
3. Validate the schema before changing the pinned Codex version.
4. Keep this research document updated when the version changes.

## Data availability

| Data | Status | Source |
|---|---|---|
| 5-hour used/remaining percentage | Available when the backend returns the 5-hour window | `RateLimitWindow.usedPercent`, duration-based classification |
| 5-hour reset | Available when `resetsAt` is present | `RateLimitWindow.resetsAt` |
| Weekly used/remaining percentage | Available when the backend returns the weekly window | `RateLimitWindow.usedPercent`, duration-based classification |
| Weekly reset | Available when `resetsAt` is present | `RateLimitWindow.resetsAt` |
| Backend rate-limit reached state | Available when provided | `rateLimitReachedType` |
| Spend-control reached state | Available when provided | `spendControlReached` |
| Purchased/earned credit details | Only when backend provides them | credits / reset-credit fields; not required for the initial monitor |

## Sources checked

Official OpenAI / Codex sources only for the implementation decision:

- `openai/codex` release `rust-v0.147.0`
- `codex-rs/app-server/README.md`
- `codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json`
- `codex-rs/app-server/src/request_processors/account_processor.rs`
- `codex-rs/codex-api/src/rate_limits.rs`
- `codex-rs/tui/src/status/rate_limits.rs`
- `codex-rs/tui/src/chatwidget/rate_limits.rs`
- `codex-rs/cli/tests/login.rs`
- OpenAI Help / Codex getting-started documentation for ChatGPT sign-in and plan usage context

## Implementation decision

Proceed with Phase 2 using:

1. Node.js monitor process.
2. Spawn pinned `codex app-server --stdio` for a rate-limit read.
3. Complete `initialize` -> `initialized` handshake.
4. Request `account/rateLimits/read`.
5. Normalize the `codex` rate-limit snapshot into 5-hour / weekly windows by duration.
6. No `/status` text parser and no browser automation.
