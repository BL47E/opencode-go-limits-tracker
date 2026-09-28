import { jsx } from "@opentui/solid/jsx-runtime"
import { Show, createRoot, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const REFRESH_MS = 60_000
const WINDOWS = [
  ["rolling", "5h"],
  ["weekly", "weekly"],
  ["monthly", "monthly"],
]
const WAVE_CELLS = 10
const WAVE_LEVELS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"]
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
  // Rising wave: each cell's height tracks how much of the window is
  // consumed at that cell, cresting at the current frontier. Empty
  // cells sit at "sea level" (▁) so the meter reads even at 0%.
  const filled = ((percent ?? 0) / 100) * WAVE_CELLS
  let wave = ""
  for (let i = 0; i < WAVE_CELLS; i++) {
    const height = Math.max(0, Math.min(1, filled - i))
    let level = Math.floor(height * WAVE_LEVELS.length)
    if (height > 0) level = Math.max(1, level) // always show a visible step at the crest
    wave += WAVE_LEVELS[Math.min(WAVE_LEVELS.length - 1, level)]
  }
  return wave
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
                              children: [
                                jsx("text", {
                                  children: label,
                                  get fg() {
                                    return context.theme?.text?.muted
                                  },
                                }),
                              ],
                            }),
                            jsx("text", {
                              get children() {
                                return `${meter(usage()?.[key]?.percent)} ${usage()?.[key]?.percent ?? "–"}%`
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
