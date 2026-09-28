# opencode-go-limits-tracker

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenCode V2](https://img.shields.io/badge/OpenCode-V2-7c3aed)](https://opencode.ai)
[![Platform: macOS \| Linux \| WSL](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20WSL-lightgrey)](https://opencode.ai/docs)

An [OpenCode](https://opencode.ai) **V2** TUI plugin that tracks your **OpenCode Go** plan limits in the **sidebar footer** — the rolling **5h**, **weekly**, and **monthly** windows.

```text
  Opencode Go

  5-HOUR  ███░░░░░░░░░  1% 1h
  WEEKLY  █░░░░░░░░░░░  5% 6d
  MONTHLY ██████░░░░░░  52% 23d
```

Each row is a solid omarchy-style progress bar (with a boxed border in the TUI and a fine
partial-cell fill edge), tinted green, yellow, or red by that window's usage level, followed
by the exact percentage and a countdown until that window resets. The panel appears **only
while the active session's model runs on the OpenCode Go provider**; switch providers and it
disappears.

Prefer a single line? Set `COMPACT = true` in `tui.ts`:

```text
  Opencode Go
  5h 1% · wk 2% · mo 51% ↻3h12m
```

Tested against OpenCode **2.0.18**.

---

## Why

OpenCode's sidebar shows session-local stats (context tokens, cost spent), but Go plan
subscribers have no way to see their **account-wide** plan usage from the CLI. The only place it
was visible is the web dashboard — so you find out you're near a limit only when the gateway
starts throttling.

This plugin surfaces all three Go quota windows (the 5-hour rolling window, the weekly window,
and the monthly window) directly in the sidebar. The official upstream feature request is tracked
in [anomalyco/opencode#41293](https://github.com/anomalyco/opencode/issues/41293); until that
lands natively, this plugin fills the gap.

## Features

- Shows all three Go quota windows: **5h** (rolling), **week**, **month**
- Omarchy-style progress bars: 12-cell solid fill with a stepped partial-cell edge, boxed in the TUI
- Per-window coloring on the bar and its percent: 🟢 green (<50%), 🟡 yellow (50–89%), 🔴 red (≥90%)
- **Reset countdowns** — `3h12m` for the 5h window, days/weeks for the week and month windows
- **Compact single-line mode** — set `COMPACT = true` for `5h 1% · wk 2% · mo 51%`
- Auto-gating: hidden unless the current session's provider is `opencode-go`
- Refreshes every 60 seconds, plus after every completed session run
- Zero configuration — reuses the Go key OpenCode already stores locally
- Degrades silently: missing key, network failure, or rate limiting just hides the panel

## Install

### Option 1 — clone into the plugins directory (recommended)

OpenCode automatically discovers plugins under the global config directory:

```sh
mkdir -p ~/.config/opencode/plugins
git clone https://github.com/BL47E/opencode-go-limits-tracker.git \
  ~/.config/opencode/plugins/go-usage
```

> The folder name doesn't matter — what matters is that it sits under
> `~/.config/opencode/plugins/` and contains `tui.ts` / `package.json`.

### Option 2 — manual copy

Copy this folder to `~/.config/opencode/plugins/go-usage` (any method you like).

### Option 3 — install from npm (once published)

```sh
opencode plugin add opencode-go-limits-tracker
```

### Then restart the TUI

Plugins load on TUI startup. Exit any OpenCode TUI window (Ctrl+C) and relaunch `opencode`.
Verify it was discovered:

```sh
opencode plugin list
```

You should see `opencode-go-limits-tracker` listed with source `local`.

## Requirements

- OpenCode **V2** (tested on 2.0.18). Uses the V2 CLI plugin API
  (`Plugin.define` + `context.ui.slot`) — it will **not** load on V1 (1.x).
- OpenCode Go connected in OpenCode (`/connect` → OpenCode Go, or any auth flow that stores
  the `opencode-go` key in `~/.local/share/opencode/auth.json`).
- A sidebar-capable terminal width (`session.sidebar` is `auto` by default; widen the window
  if the sidebar is hidden).

## How it works

OpenCode stores your OpenCode Go API key locally in
`~/.local/share/opencode/auth.json` (under the `opencode-go` entry). The plugin reads that key
and calls the same JSON endpoint the OpenCode web console uses:

```sh
curl -s https://opencode.ai/zen/go/v1/usage \
  -H "Authorization: Bearer $OPENCODE_GO_KEY" \
  -H "Accept: application/json"
```

Response shape:

```json
{
  "usage": {
    "rolling":  { "status": "ok", "percent": 1, "resetsAt": "2026-09-28T16:31:37.949Z" },
    "weekly":   { "status": "ok", "percent": 2, "resetsAt": "2026-10-05T00:00:00.000Z" },
    "monthly":  { "status": "ok", "percent": 51, "resetsAt": "2026-10-21T15:16:37.000Z" }
  }
}
```

- `rolling` → the 5-hour rolling window
- `weekly` → resets at the start of each UTC week (`resetsAt` is a Monday 00:00 UTC)
- `monthly` → resets on your billing-cycle anchor date
- `resetsAt` on each window → shown next to the percent as a countdown (`3h12m`, `3d`, `21d`)

No browser cookies, no page scraping, no database. Nothing is sent anywhere except to
`opencode.ai`, and the key never leaves your machine.

## Colors

Each window's bar and percent value are colored by that window alone:

| Color  | Condition       |
| ------ | --------------- |
| Green  | usage < 50%     |
| Yellow | usage 50–89%    |
| Red    | usage ≥ 90%     |

## Configuration

There are no required options. The constants at the top of `tui.ts` are easy to tweak:

```ts
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage" // data source
const REFRESH_MS = 60_000                               // usage refresh interval
const COMPACT = false                                   // true = one-line layout
const TICK_MS = 30_000                                  // countdown recompute interval
const WINDOWS = [                                       // order + labels per window
  { key: "rolling", label: "5-HOUR", compact: "5h" },
  { key: "weekly", label: "WEEKLY", compact: "wk" },
  { key: "monthly", label: "MONTHLY", compact: "mo" },
]
const BAR_CELLS = 12                                    // bar width in cells
const LABEL_WIDTH = 7                                   // label column width (stacked mode)
```

The provider gate matches `providerID === "opencode-go"` in `activeProvider()` — if OpenCode
ever renames the Go provider ID, that's the one place to update.

## Troubleshooting

| Symptom                                  | Fix                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Banner never appears                     | Is OpenCode Go connected? Check `~/.local/share/opencode/auth.json` for an `opencode-go` entry. |
| Banner disappears after switching models | Expected — it only renders while the session model is on Go.        |
| Plugin shows as unsupported              | You're on OpenCode V1 (1.x). This plugin targets V2 only.           |
| Percentages look stale                   | Values refresh every 60s and after each session run; the endpoint also reports whole percents. |
| Plugin errors on startup                 | Check `~/.local/share/opencode/log/opencode.log`, filter for `role=cli`. |

## Removing

```sh
rm -rf ~/.config/opencode/plugins/go-usage
```

Then restart the TUI.

## Publishing notes (for maintainers)

The npm-required peers are already declared in `package.json`:

```json
{
  "peerDependencies": {
    "@opentui/core": ">=0.5.8",
    "@opentui/solid": ">=0.5.8",
    "solid-js": ">=1.9.0"
  }
}
```

`@opencode/plugin` stays a regular dependency; the rest are peers so that when the plugin is
installed into an OpenCode checkout the TUI runtime satisfies them itself. Bump `version` and
`npm publish` to make the plugin available via `opencode plugin add`.

## Credits

- Inspired by [and7ey/opencode-go-usage](https://github.com/and7ey/opencode-go-usage)
  (MIT), the community plugin that pioneered the same idea for OpenCode 1.18's bottom bar.
  This project is a from-scratch V2 implementation targeting the sidebar instead.
- Uses the official usage endpoint documented in OpenCode's Console API.

## Contributing

PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev workflow and the
manual test checklist.

## License

[MIT](./LICENSE)
