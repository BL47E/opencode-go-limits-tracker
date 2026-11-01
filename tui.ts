import { jsx } from "@opentui/solid/jsx-runtime"
import { Show, createRoot, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { GoUsage } from "./rpc.js"

const REFRESH_MS = 60_000
// Single-line layout ("5h 1% · wk 2% · mo 51% ↻3h") instead of the
// stacked bar rows. Toggle if the stacked layout doesn't fit a narrow
// sidebar.
const COMPACT = false
// Recompute the reset countdowns this often so they stay accurate
// between usage refreshes.
const TICK_MS = 30_000
const WINDOWS = [
  { key: "rolling", label: "Rolling", compact: "5h" },
  { key: "weekly", label: "Weekly", compact: "wk" },
  { key: "monthly", label: "Monthly", compact: "mo" },
]
const BAR_CELLS = 20
const PARTIAL_STEPS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]
const LABEL_WIDTH = 7

function meterParts(percent) {
  // Partial edge kept with exactly two inks: the track glyph uses the band
  // color as its foreground, so the band reads uniform and the partial's
  // void matches the track exactly.
  const cells = ((percent ?? 0) / 100) * BAR_CELLS
  const full = Math.floor(cells)
  const rem = cells - full
  const step = rem > 0 ? Math.max(1, Math.round(rem * (PARTIAL_STEPS.length - 1))) : 0
  return {
    filled: "█".repeat(full) + (step ? PARTIAL_STEPS[step] : ""),
    track: "░".repeat(Math.max(0, BAR_CELLS - full - (step ? 1 : 0))),
  }
}

function colorFor(theme, percent) {
  if (typeof percent !== "number") return theme?.text?.muted
  if (percent >= 90) return theme?.text?.feedback?.error?.base ?? theme?.text?.base
  if (percent >= 50) return theme?.text?.feedback?.warning?.base ?? theme?.text?.base
  return theme?.text?.feedback?.success?.base ?? theme?.text?.base
}

function activeProvider(context, sessionID) {
  const fromUI = context.ui.model.current()?.providerID
  if (fromUI) return fromUI
  return context.data.session.get(sessionID)?.model?.providerID
}

function countdown(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return "now"
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const remMin = minutes % 60
    return remMin ? `${hours}h${remMin}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours ? `${days}d${remHours}h` : `${days}d`
}

export default Plugin.define({
  id: "go-usage.sidebar",
  setup(context) {
    const goUsage = context.client.rpc(GoUsage)

    const dispose = createRoot((rootDispose) => {
      const [usage, setUsage] = createSignal(null)
      const [usageURL, setUsageURL] = createSignal<string | null>(null)
      const [tick, setTick] = createSignal(0)

      const refresh = async () => {
        try {
          const result = (await goUsage.getUsage({})) as { usage?: unknown; usageURL?: unknown }
          setUsage((result?.usage as never) ?? null)
          setUsageURL(typeof result?.usageURL === "string" ? result.usageURL : null)
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

      const urlRow = () => {
        return jsx(Show, {
          get when() {
            return usageURL()
          },
          get children() {
            return jsx("text", {
              children: jsx("a", {
                get href() {
                  return usageURL() as string
                },
                get fg() {
                  return context.theme?.text?.muted
                },
                children: "↗ Console",
              }),
            })
          },
        })
      }

      const stackedRow = (window) => {
        return jsx("box", {
          flexDirection: "column",
          children: [
            jsx("box", {
              flexDirection: "row",
              gap: 1,
              children: [
                jsx("box", {
                  width: LABEL_WIDTH,
                  children: jsx("text", {
                    children: window.label,
                    get fg() {
                      return context.theme?.text?.muted
                    },
                  }),
                }),
                jsx("box", {
                  flexDirection: "row",
                  children: [
                    jsx(Show, {
                      get when() {
                        return meterParts(usage()?.[window.key]?.percent).filled !== ""
                      },
                      get children() {
                        return jsx("text", {
                          get children() {
                            return meterParts(usage()?.[window.key]?.percent).filled
                          },
                          get fg() {
                            return colorFor(context.theme, usage()?.[window.key]?.percent)
                          },
                          get bg() {
                            return context.theme?.border?.base ?? context.theme?.text?.muted
                          },
                        })
                      },
                    }),
                    jsx(Show, {
                      get when() {
                        return meterParts(usage()?.[window.key]?.percent).track !== ""
                      },
                      get children() {
                        return jsx("text", {
                          get children() {
                            return meterParts(usage()?.[window.key]?.percent).track
                          },
                          get fg() {
                            return colorFor(context.theme, usage()?.[window.key]?.percent)
                          },
                        })
                      },
                    }),
                  ],
                }),
                jsx("text", {
                  get children() {
                    const pct = usage()?.[window.key]?.percent ?? "–"
                    return `${pct}% used`
                  },
                  get fg() {
                    return colorFor(context.theme, usage()?.[window.key]?.percent)
                  },
                }),
              ],
            }),
            jsx("box", {
              flexDirection: "row",
              gap: 1,
              children: [
                jsx("box", {
                  width: LABEL_WIDTH,
                  children: [],
                }),
                jsx("text", {
                  get children() {
                    const until = resetText(window.key) ?? ""
                    return until ? `Resets in ${until}` : ""
                  },
                  get fg() {
                    return context.theme?.text?.muted
                  },
                }),
              ],
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
                border: ["top"],
                get borderColor() {
                  return context.theme?.background?.base ?? "#000000"
                },
                customBorderChars: {
                  topLeft: "█",
                  topRight: "█",
                  bottomLeft: "█",
                  bottomRight: "█",
                  horizontal: "█",
                  vertical: "█",
                  topT: "█",
                  bottomT: "█",
                  leftT: "█",
                  rightT: "█",
                  cross: "█",
                },
                marginLeft: -2,
                marginRight: -2,
                paddingLeft: 1,
                paddingRight: 1,
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
                      urlRow(),
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
                    urlRow(),
                  ]
                },
              })
            },
          }),
      })

      onCleanup(() => {
        clearInterval(timer)
        clearInterval(tickTimer)
      })

      return rootDispose
    })

    return () => dispose()
  },
})
