// src/rpc.ts
var session = {
  type: "object",
  properties: { sessionID: { type: "string", minLength: 3 } },
  required: ["sessionID"],
  additionalProperties: false
};
var errors = {
  goal_error: { type: "object", additionalProperties: false }
};
var Goals = {
  id: "desktop-goals",
  methods: {
    get: { input: session, output: {}, errors },
    control: {
      output: {},
      errors,
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 3 },
          action: { type: "string", enum: ["create", "pause", "resume", "edit", "budget", "clear"] },
          objective: { type: "string", minLength: 1, maxLength: 8e3 },
          tokenBudget: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          expectedID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 1 },
          expectAbsent: { type: "boolean" }
        },
        required: ["sessionID", "action"],
        additionalProperties: false
      }
    }
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false
      }
    }
  }
};
export {
  Goals
};
