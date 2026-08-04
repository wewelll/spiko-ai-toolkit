import { describe, expect, it } from "vitest"
import { Context } from "effect"
import { Tool } from "effect/unstable/ai"
import {
  InvestorMutatingOperationNames,
  InvestorReadOperationNames,
} from "../src/generated/investor-operations.ts"
import { SpikoToolkit } from "../src/tools.ts"

describe("SpikoToolkit", () => {
  it("exposes the Public API and every generated Investor API operation", () => {
    expect(Object.keys(SpikoToolkit.tools)).toHaveLength(18)
    expect(InvestorReadOperationNames).toHaveLength(24)
    expect(InvestorMutatingOperationNames).toHaveLength(11)
  })

  it("marks read tools as safe and the mutating Investor tool as destructive", () => {
    for (const [name, tool] of Object.entries(SpikoToolkit.tools)) {
      if (name === "call_investor_mutating_operation") {
        expect(Context.get(tool.annotations, Tool.Readonly)).toBe(false)
        expect(Context.get(tool.annotations, Tool.Destructive)).toBe(true)
        expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(false)
        continue
      }

      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true)
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false)
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true)
    }
  })
})
