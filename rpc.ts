import { Rpc } from "@opencode/plugin/rpc"

export const GoUsage = Rpc.define({
  id: "go-usage",
  methods: {
    getUsage: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          usage: {},
          usageURL: {},
        },
        additionalProperties: true,
      },
      errors: {
        no_auth: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          additionalProperties: true,
        },
        fetch_failed: {
          type: "object",
          properties: {
            message: { type: "string" },
            status: { type: "number" },
          },
          additionalProperties: true,
        },
      },
    },
  },
  events: {},
})
