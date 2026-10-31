import { Plugin } from "@opencode/plugin"
import { GoUsage } from "./rpc.js"

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"

function extractBearer(cred: unknown): string | null {
  if (!cred) return null
  if (typeof cred === "string") return cred.length > 0 ? cred : null
  if (typeof cred === "object") {
    const c = cred as Record<string, unknown>
    for (const k of ["key", "value", "token", "apiKey", "access"]) {
      const v = c[k]
      if (typeof v === "string" && v.length > 0) return v
    }
  }
  return null
}

function credentialOrgID(cred: unknown): string | null {
  if (cred && typeof cred === "object") {
    const orgID = (cred as Record<string, unknown>).metadata
    if (orgID && typeof orgID === "object") {
      const id = (orgID as Record<string, unknown>).orgID
      if (typeof id === "string" && id.length > 0) return id
    }
  }
  return null
}

function credentialOrigin(cred: unknown): string {
  if (cred && typeof cred === "object") {
    const metadata = (cred as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | undefined
    const server = metadata?.server
    if (typeof server === "string" && server.startsWith("http")) {
      try {
        return new URL(server).origin
      } catch {}
    }
  }
  return "https://opencode.ai"
}

async function fetchUsage(
  base: string,
  bearer: string,
  orgID: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/json",
  }
  if (orgID) {
    headers["x-opencode-org-id"] = orgID
    headers["x-org-id"] = orgID
  }
  return fetch(`${base}/zen/go/v1/usage`, { headers, signal })
}

export default Plugin.define({
  id: "go-usage",
  async setup(ctx) {
    const registration = await ctx.rpc.register(GoUsage, {
      getUsage: async (_input, context) => {
        // 1. Direct Console auth (opencode integration, type=oauth) — default method.
        // Mirrors OpenCode's own UsageLimits: Bearer access + x-opencode-org-id.
        const consoleConnection = await ctx.integration.connection.active("opencode")
        if (consoleConnection) {
          const consoleCred = await ctx.integration.connection.resolve(consoleConnection)
          const bearer = extractBearer(consoleCred)
          if (bearer) {
            const orgID = credentialOrgID(consoleCred)
            const origin = credentialOrigin(consoleCred)
            try {
              const res = await fetchUsage(origin, bearer, orgID, context.signal)
              if (res.ok) {
                const data = (await res.json()) as { usage?: unknown }
                return { usage: data?.usage ?? null }
              }
              if (res.status !== 403 && res.status !== 401) {
                return context.error("fetch_failed", `usage endpoint returned ${res.status}`, {
                  message: `usage endpoint returned ${res.status}`,
                  status: res.status,
                })
              }
              // 401/403 on Console auth -> fall through to Go API key.
            } catch {
              // Network/abort on Console auth -> try Go API key fallback.
            }
          }
        }

        // 2. Legacy Go API key fallback (opencode-go integration, type=key).
        const goConnection = await ctx.integration.connection.active("opencode-go")
        if (!goConnection) return context.error("no_auth", "OpenCode Go not connected", {})
        const goCred = await ctx.integration.connection.resolve(goConnection)
        const goKey = extractBearer(goCred)
        if (!goKey) return context.error("no_auth", "OpenCode Go credential empty", {})
        const res = await fetchUsage(USAGE_URL.replace(/\/zen\/go\/v1\/usage$/, ""), goKey, null, context.signal)
        if (res.status === 403 || res.status === 401)
          return context.error("no_auth", "No Go subscription on this workspace", {})
        if (!res.ok)
          return context.error("fetch_failed", `usage endpoint returned ${res.status}`, {
            message: `usage endpoint returned ${res.status}`,
            status: res.status,
          })
        const data = (await res.json()) as { usage?: unknown }
        return { usage: data?.usage ?? null }
      },
    })

    return () => {
      void registration.dispose()
    }
  },
})
