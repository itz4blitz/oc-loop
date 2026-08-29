export type Verification = { readonly ok: boolean; readonly reason: string }

export function interpretVerification(exitCode: number): Verification {
  if (!Number.isSafeInteger(exitCode)) return { ok: false, reason: "verification failed to run" }
  if (exitCode === 0) return { ok: true, reason: "" }
  return { ok: false, reason: `verification failed (exit ${exitCode})` }
}
