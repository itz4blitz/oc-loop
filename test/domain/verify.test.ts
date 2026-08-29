import { describe, expect, it } from "vitest"
import { interpretVerification } from "../../src/domain/verify.js"

describe("verification interpretation", () => {
  it("passes on exit code zero", () => {
    expect(interpretVerification(0)).toEqual({ ok: true, reason: "" })
  })
  it("fails with the exit code in the reason", () => {
    expect(interpretVerification(1)).toEqual({ ok: false, reason: "verification failed (exit 1)" })
    expect(interpretVerification(2)).toEqual({ ok: false, reason: "verification failed (exit 2)" })
    expect(interpretVerification(127)).toEqual({ ok: false, reason: "verification failed (exit 127)" })
  })
  it("fails closed on unsafe exit codes", () => {
    expect(interpretVerification(Number.NaN)).toEqual({ ok: false, reason: "verification failed to run" })
    expect(interpretVerification(1.5)).toEqual({ ok: false, reason: "verification failed to run" })
  })
})
