import { jsx } from "@opentui/solid/jsx-runtime"
import { Show, createRoot, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const REFRESH_MS = 60_000
// Single-line layout ("Go 5h 1% · wk 2% · mo 51%") instead of the stacked
// bar meter. Toggle if the stacked layout doesn't fit a narrow sidebar.
const COMPACT = false
// Recompute the reset countdowns this often so they stay accurate
// between usage refreshes.
const TICK_MS = 30_000
const WINDOWS = [
  { key: "rolling", label: "5-HOUR", compact: "5h" },
  { key: "weekly", label: "WEEKLY", compact: "wk" },
  { key: "monthly", label: "MONTHLY", compact: "mo" },
]
const BAR_CELLS = 20
const PARTIAL_STEPS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]
const LABEL_WIDTH = 7

function readGoKey() {
  try {
    const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
    const auth = JSON.parse(readFileSync(join(dataHome, "opencode", "auth.json"), "utf8"))
    const entry = auth?.["opencode-go"]
    const key = typeof entry === "string" ? entry : entry?.key
    return typeof key === "string" && key.length > 0 ? key : null
  } catch {
    return null
  }
}

async function fetchUsage(apiKey, signal) {
  const res = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal,
  })
  if (!res.ok) throw new Error(`usage endpoint returned ${res.status}`)
  const data = await res.json()
  return data?.usage ?? null
}

function meter(percent) {
  // Flat omarchy-style bar: solid `█` fill on an empty track, with a
  // stepped partial-block character at the fill frontier so the edge
  // resolves finer than one cell. Plain string child on a single text
  // node — no nested text spans.
  const cells = ((percent ?? 0) / 100) * BAR_CELLS
  const full = Math.floor(cells)
  const rem = cells - full
  const step = rem > 0 ? Math.max(1, Math.round(rem * (PARTIAL_STEPS.length - 1))) : 0
  return "█".repeat(full) +
    (step ? PARTIAL_STEPS[step] : "") +
    " ".repeat(Math.max(0, BAR_CELLS - full - (step ? 1 : 0)))
}

function colorFor(theme, percent) {
  if (typeof percent !== "number") return theme?.text?.muted
  if (percent >= 90) return theme?.text?.feedback?.error?.base ?? theme?.text?.base
  if (percent >= 50) return theme?.text?.feedback?.warning?.base ?? theme?.text?.base
  return theme?.text?.feedback?.success?.base ?? theme?.text?.base
}

function activeProvider(context, sessionID) {
  const fromSession = context.data.session.get(sessionID)?.model?.providerID
  return fromSession ?? context.ui.model.current()?.providerID
}

function countdown(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return "now"
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export default Plugin.define({
  id: "go-usage.sidebar",
  setup(context) {
    const apiKey = readGoKey()
    if (!apiKey) return

    const dispose = createRoot((rootDispose) => {
      const [usage, setUsage] = createSignal(null)
      const [tick, setTick] = createSignal(0)
      const controller = new AbortController()

      const refresh = async () => {
        try {
          setUsage(await fetchUsage(apiKey, controller.signal))
        } catch {}
      }

      void refresh()
      const timer = setInterval(() => void refresh(), REFRESH_MS)
      // Keep countdown text fresh between usage refreshes.
      const tickTimer = setInterval(() => setTick((n) => n + 1), TICK_MS)

      try {
        context.data.on("session.execution.succeeded", () => void refresh())
      } catch {}

      const resetText = (key) => {
        void tick()
        return countdown(usage()?.[key]?.resetsAt)
      }

      const stackedRow = (window) => {
        return jsx("box", {
          flexDirection: "row",
          gap: 1,
          children: [
            jsx("box", {
              width: LABEL_WIDTH,
              height: 3,
              justifyContent: "center",
              alignItems: "flex-start",
              children: [
                jsx("text", {
                  children: window.label,
                  get fg() {
                    return context.theme?.text?.muted
                  },
                }),
              ],
            }),
            jsx("box", {
              border: true,
              width: BAR_CELLS + 2,
              children: [
                jsx("text", {
                  get children() {
                    return meter(usage()?.[window.key]?.percent)
                  },
                  get fg() {
                    return colorFor(context.theme, usage()?.[window.key]?.percent)
                  },
                }),
              ],
            }),
            jsx("text", {
              get children() {
                const pct = usage()?.[window.key]?.percent ?? "–"
                const until = resetText(window.key) ?? ""
                return `${pct}%${until ? ` ${until}` : ""}`
              },
              get fg() {
                return colorFor(context.theme, usage()?.[window.key]?.percent)
              },
            }),
          ],
        })
      }

      const compactRow = (window, last) => {
        return [
          jsx("text", {
            get children() {
              return `${window.compact} ${usage()?.[window.key]?.percent ?? "–"}%`
            },
            get fg() {
              return colorFor(context.theme, usage()?.[window.key]?.percent)
            },
          }),
          jsx("text", {
            get children() {
              return last ? (resetText(window.key) ? `↻${resetText(window.key)}` : "") : "·"
            },
            get fg() {
              return context.theme?.text?.muted
            },
          }),
        ]
      }

      context.ui.slot({
        append: "sidebar.footer",
        render: ({ sessionID }) =>
          jsx(Show, {
            get when() {
              return usage() != null && activeProvider(context, sessionID) === "opencode-go"
            },
            get children() {
              return jsx("box", {
                flexDirection: "column",
                paddingLeft: 2,
                paddingRight: 2,
                paddingTop: 1,
                gap: 1,
                get children() {
                  if (COMPACT) {
                    return [
                      jsx("text", {
                        children: "Opencode Go",
                        get fg() {
                          return context.theme?.text?.base
                        },
                      }),
                      jsx("box", {
                        flexDirection: "row",
                        gap: 1,
                        children: WINDOWS.flatMap((window, i) =>
                          compactRow(window, i === WINDOWS.length - 1),
                        ),
                      }),
                    ]
                  }
                  return [
                    jsx("text", {
                      children: "Opencode Go",
                      get fg() {
                        return context.theme?.text?.base
                      },
                    }),
                    jsx("box", {
                      flexDirection: "column",
                      gap: 1,
                      children: WINDOWS.map((window) => stackedRow(window)),
                    }),
                  ]
                },
              })
            },
          }),
      })

      onCleanup(() => {
        clearInterval(timer)
        clearInterval(tickTimer)
        controller.abort()
      })

      return rootDispose
    })

    return () => dispose()
  },
})
