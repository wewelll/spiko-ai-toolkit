import { describe, expect, it } from "vitest"
import { Context } from "effect"
import { Tool } from "effect/unstable/ai"
import { SpikoToolkit } from "../src/tools.ts"

describe("SpikoToolkit", () => {
  it("exposes every documented Spiko Public API operation", () => {
    expect(Object.keys(SpikoToolkit.tools)).toHaveLength(15)
  })

  it("marks every tool as read-only, safe, and idempotent", () => {
    for (const tool of Object.values(SpikoToolkit.tools)) {
      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true)
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false)
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true)
    }
  })
})
