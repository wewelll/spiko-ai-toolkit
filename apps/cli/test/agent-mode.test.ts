import { describe, expect, it } from "vitest"
import { detectAgentName, extractAgentFlags, resolveAgentMode } from "../src/agent-mode.ts"

describe("agent detection", () => {
  it("names the first detected agent from its environment variables", () => {
    expect(detectAgentName({ CLAUDECODE: "1" })).toBe("claude-code")
    expect(detectAgentName({ CURSOR_AGENT: "true" })).toBe("cursor")
    expect(detectAgentName({ CODEX: "1" })).toBe("codex")
    expect(detectAgentName({ PI_CODING_AGENT: "true" })).toBe("pi-dev")
    expect(detectAgentName({ AGENT: "1" })).toBe("generic-agent")
  })

  it("detects Devin by session id presence", () => {
    expect(detectAgentName({ DEVIN_SESSION_ID: "abc" })).toBe("devin")
  })

  it("ignores non-truthy marker values and empty environments", () => {
    expect(detectAgentName({ CLAUDECODE: "0" })).toBeUndefined()
    expect(detectAgentName({})).toBeUndefined()
  })

  it("prefers explicit arguments over environment overrides and detection", () => {
    const env = { CLAUDECODE: "1", FORCE_AGENT_MODE: "1" }
    expect(resolveAgentMode(undefined, env)).toBe(true)
    expect(resolveAgentMode(false, env)).toBe(false)
    expect(resolveAgentMode(true, {})).toBe(true)
  })

  it("honors SPIKO_AGENT_MODE without any detected agent", () => {
    expect(resolveAgentMode(undefined, { SPIKO_AGENT_MODE: "1" })).toBe(true)
    expect(resolveAgentMode(undefined, { FORCE_AGENT_MODE: "true" })).toBe(true)
    expect(resolveAgentMode(undefined, { SPIKO_AGENT_MODE: "0" })).toBe(false)
  })

  it("lets a falsy env override outrank agent detection", () => {
    expect(resolveAgentMode(undefined, { SPIKO_AGENT_MODE: "0", PI_CODING_AGENT: "true" })).toBe(
      false,
    )
    expect(resolveAgentMode(undefined, { FORCE_AGENT_MODE: "false", CLAUDECODE: "1" })).toBe(false)
  })

  it("lets an off request win over an on request regardless of order", () => {
    expect(extractAgentFlags(["--no-agent", "--agent", "call"]).explicit).toBe(false)
    expect(extractAgentFlags(["--agent", "--no-agent", "call"]).explicit).toBe(false)
    expect(extractAgentFlags(["--agent=false", "--agent=true"]).explicit).toBe(true)
  })

  it("stops stripping at the -- operand delimiter", () => {
    const extracted = extractAgentFlags(["call", "--", "--agent"])
    expect(extracted.explicit).toBeUndefined()
    expect(extracted.args).toEqual(["call", "--", "--agent"])
  })

  it("passes unrecognized assignment values through to the grammar", () => {
    const extracted = extractAgentFlags(["--agent=banana", "call"])
    expect(extracted.explicit).toBeUndefined()
    expect(extracted.args).toEqual(["--agent=banana", "call"])
  })
})

describe("agent flag extraction", () => {
  it("strips --agent/--no-agent wherever they appear and reports the request", () => {
    expect(extractAgentFlags(["--agent", "call", "public"])).toEqual({
      args: ["call", "public"],
      explicit: true,
    })
    expect(extractAgentFlags(["call", "--no-agent", "public", "funds"])).toEqual({
      args: ["call", "public", "funds"],
      explicit: false,
    })
  })

  it("supports assignment forms with negation semantics", () => {
    expect(extractAgentFlags(["--no-agent=false", "operations"])).toEqual({
      args: ["operations"],
      explicit: true,
    })
    expect(extractAgentFlags(["--agent=false"])).toEqual({ args: [], explicit: false })
  })

  it("leaves unrelated arguments untouched", () => {
    expect(extractAgentFlags(["call", "public", "funds", "list"])).toEqual({
      args: ["call", "public", "funds", "list"],
      explicit: undefined,
    })
  })
})
