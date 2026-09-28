import { jsx } from "@opentui/solid/jsx-runtime"
import { Show, createRoot, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const REFRESH_MS = 60_000
const WINDOWS = [
  ["rolling", "5-HOUR"],
  ["weekly", "WEEKLY"],
  ["monthly", "MONTHLY"],
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

export default Plugin.define({
  id: "go-usage.sidebar",
  setup(context) {
    const apiKey = readGoKey()
    if (!apiKey) return

    const dispose = createRoot((rootDispose) => {
      const [usage, setUsage] = createSignal(null)
      const controller = new AbortController()

      const refresh = async () => {
        try {
          setUsage(await fetchUsage(apiKey, controller.signal))
        } catch {}
      }

      void refresh()
      const timer = setInterval(() => void refresh(), REFRESH_MS)

      try {
        context.data.on("session.execution.succeeded", () => void refresh())
      } catch {}

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
                      children: WINDOWS.map(([key, label]) => {
                        const color = () => colorFor(context.theme, usage()?.[key]?.percent)
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
                                  children: label,
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
                                    return meter(usage()?.[key]?.percent)
                                  },
                                  get fg() {
                                    return color()
                                  },
                                }),
                              ],
                            }),
                            jsx("text", {
                              get children() {
                                return `${usage()?.[key]?.percent ?? "–"}%`
                              },
                              get fg() {
                                return color()
                              },
                            }),
                          ],
                        })
                      }),
                    }),
                  ]
                },
              })
            },
          }),
      })

      onCleanup(() => {
        clearInterval(timer)
        controller.abort()
      })

      return rootDispose
    })

    return () => dispose()
  },
})
