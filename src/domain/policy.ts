export type PermissionMode = "ask" | "ask-never"
export type SafetyPolicy = {
  readonly permissions: PermissionMode
  readonly maxRuns: number | "unlimited"
  readonly maxRuntimeMs: number | "unlimited"
  readonly maxFailures: number
  readonly noOverlap: true
  readonly delivery: "queue"
}

export const defaultSafetyPolicy: SafetyPolicy = {
  permissions: "ask",
  maxRuns: 20,
  maxRuntimeMs: 1_800_000,
  maxFailures: 3,
  noOverlap: true,
  delivery: "queue",
}

type PolicyInput = Partial<SafetyPolicy> & { readonly noOverlap?: boolean; readonly delivery?: string }
export type PolicyNormalization =
  | { readonly ok: true; readonly policy: SafetyPolicy }
  | { readonly ok: false; readonly errors: readonly string[] }

export function normalizeSafetyPolicy(input: unknown): PolicyNormalization {
  if (input === undefined || input === null) return { ok: true, policy: defaultSafetyPolicy }
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["policy must be an object"] }
  const value = input as PolicyInput
  const errors: string[] = []
  if (value.permissions !== undefined && value.permissions !== "ask" && value.permissions !== "ask-never") errors.push("permissions is invalid")
  if (value.noOverlap !== undefined && value.noOverlap !== true) errors.push("noOverlap must be true")
  if (value.delivery !== undefined && value.delivery !== "queue") errors.push("delivery must be queue")
  for (const [name, candidate] of [["maxRuns", value.maxRuns], ["maxRuntimeMs", value.maxRuntimeMs], ["maxFailures", value.maxFailures]] as const) {
    if (candidate !== undefined && ((candidate === "unlimited" && name === "maxFailures") || (candidate !== "unlimited" && (!Number.isSafeInteger(candidate) || candidate < (name === "maxFailures" ? 0 : 1))))) errors.push(`${name} is invalid`)
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    policy: {
      permissions: value.permissions ?? defaultSafetyPolicy.permissions,
      maxRuns: value.maxRuns ?? defaultSafetyPolicy.maxRuns,
      maxRuntimeMs: value.maxRuntimeMs ?? defaultSafetyPolicy.maxRuntimeMs,
      maxFailures: value.maxFailures ?? defaultSafetyPolicy.maxFailures,
      noOverlap: true,
      delivery: "queue",
    },
  }
}
