import { describe, expect, it } from "vitest"
import { defaultSafetyPolicy, normalizeSafetyPolicy } from "../../src/domain/policy.js"

describe("safety policy", () => {
  it("uses conservative defaults", () => {
    const expected = {
      permissions: "ask",
      maxRuns: 20,
      maxRuntimeMs: 1_800_000,
      maxFailures: 3,
      noOverlap: true,
      delivery: "queue",
    }
    expect(defaultSafetyPolicy).toEqual(expected)
    expect(normalizeSafetyPolicy(undefined)).toEqual({ ok: true, policy: expected })
    expect(normalizeSafetyPolicy(null)).toEqual({ ok: true, policy: expected })
  })
  it("normalizes valid partial and explicit unlimited policies", () => {
    expect(normalizeSafetyPolicy({})).toEqual({ ok: true, policy: defaultSafetyPolicy })
    expect(normalizeSafetyPolicy({ permissions: "ask-never", maxRuns: "unlimited", maxRuntimeMs: "unlimited" })).toEqual({
      ok: true, policy: { ...defaultSafetyPolicy, permissions: "ask-never", maxRuns: "unlimited", maxRuntimeMs: "unlimited" },
    })
  })
  it("rejects unsafe or malformed policy values", () => {
    expect(normalizeSafetyPolicy(false)).toEqual({ ok: false, errors: ["policy must be an object"] })
    expect(normalizeSafetyPolicy({ noOverlap: false })).toMatchObject({ ok: false, errors: ["noOverlap must be true"] })
    expect(normalizeSafetyPolicy({ noOverlap: true })).toMatchObject({ ok: true })
    expect(normalizeSafetyPolicy({ delivery: "steer" })).toMatchObject({ ok: false, errors: ["delivery must be queue"] })
    expect(normalizeSafetyPolicy({ delivery: "queue" })).toMatchObject({ ok: true })
    expect(normalizeSafetyPolicy({ permissions: "unsafe" })).toMatchObject({ ok: false, errors: ["permissions is invalid"] })
    expect(normalizeSafetyPolicy({ maxRuns: 0 })).toEqual({ ok: false, errors: ["maxRuns is invalid"] })
    expect(normalizeSafetyPolicy({ maxRuntimeMs: 0 })).toEqual({ ok: false, errors: ["maxRuntimeMs is invalid"] })
    expect(normalizeSafetyPolicy({ maxFailures: -1 })).toEqual({ ok: false, errors: ["maxFailures is invalid"] })
    expect(normalizeSafetyPolicy({ maxRuns: 1.5, maxRuntimeMs: Infinity })).toEqual({ ok: false, errors: ["maxRuns is invalid", "maxRuntimeMs is invalid"] })
    expect(normalizeSafetyPolicy({ maxFailures: "unlimited" })).toEqual({ ok: false, errors: ["maxFailures is invalid"] })
    expect(normalizeSafetyPolicy({ maxFailures: 0 })).toMatchObject({ ok: true })
    expect(normalizeSafetyPolicy({ maxRuns: 1, maxRuntimeMs: 1 })).toMatchObject({ ok: true })
  })
  it("does not mutate the input", () => {
    const input = { permissions: "ask" as const, maxRuns: 5 }
    expect(normalizeSafetyPolicy(input)).toMatchObject({ ok: true })
    expect(input).toEqual({ permissions: "ask", maxRuns: 5 })
  })
})
