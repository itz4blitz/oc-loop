import { z } from "zod"

const id = z.string().trim().min(1).max(128)
const positiveInteger = z.number().int().positive().finite()
const timestamp = z.number().int().nonnegative().finite()
const actionId = z.string().trim().min(1).max(128)
const reason = z.string().trim().min(1).max(4_000)
const triggerCursor = z.object({ pending: z.boolean(), onceConsumed: z.boolean(), nextDueAtMs: timestamp.optional() }).strict()

function createDomainActionSchema() {
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("trigger-due") }).strict(),
    z.object({ type: z.literal("admit"), runId: actionId }).strict(),
    z.object({ type: z.literal("block"), reason }).strict(),
    z.object({ type: z.literal("unblock") }).strict(),
    z.object({ type: z.literal("pause") }).strict(),
    z.object({ type: z.literal("resume") }).strict(),
    z.object({ type: z.literal("succeed"), runId: actionId }).strict(),
    z.object({ type: z.literal("fail"), runId: actionId, reason }).strict(),
    z.object({ type: z.literal("stop"), runId: actionId.optional() }).strict(),
    z.object({ type: z.literal("trigger-state"), state: triggerCursor }).strict(),
    z.object({ type: z.literal("mark-unknown"), runId: actionId, reason }).strict(),
  ])
}

function createTriggerSchema() {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("idle") }).strict(),
    z.object({ kind: z.literal("manual") }).strict(),
    z.object({ kind: z.literal("once"), atMs: timestamp }).strict(),
    z.object({ kind: z.literal("interval"), everyMs: positiveInteger }).strict(),
  ])
}

export const policySchema = z.object({
  permissions: z.enum(["ask", "ask-never"]),
  maxRuns: positiveInteger,
  maxRuntimeMs: positiveInteger,
  maxFailures: z.number().int().nonnegative().finite(),
  noOverlap: z.literal(true),
  delivery: z.literal("queue"),
}).strict()

function createNodeSchema() {
  return z.discriminatedUnion("kind", [
    z.object({ id, kind: z.literal("prompt"), prompt: z.string().trim().min(1).max(100_000) }).strict(),
    z.object({ id, kind: z.literal("command"), command: z.string().trim().min(1).max(4_000), timeoutMs: positiveInteger.default(600_000) }).strict(),
    z.object({ id, kind: z.literal("approval") }).strict(),
    z.object({
      id, kind: z.literal("condition"), command: z.string().trim().min(1).max(4_000), timeoutMs: positiveInteger.default(600_000),
      passPrompt: z.string().trim().min(1).max(100_000).optional(), failPrompt: z.string().trim().min(1).max(100_000).optional(),
    }).strict(),
  ])
}

function createWorkflowSchema() {
  return z.object({
    schemaVersion: z.literal(1),
    id,
    revision: positiveInteger,
    name: z.string().trim().min(1).max(200),
    status: z.enum(["enabled", "paused", "stopped"]),
    sessionBinding: z.object({ sessionId: id, worktree: id.optional() }).strict(),
    node: createNodeSchema(),
    trigger: createTriggerSchema(),
    policy: policySchema,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).strict().refine((workflow) => workflow.updatedAt >= workflow.createdAt, {
    message: "updatedAt must not precede createdAt",
    path: ["updatedAt"],
  })
}

export const domainActionSchema = {
  parse: (input: unknown) => createDomainActionSchema().parse(input),
  safeParse: (input: unknown) => createDomainActionSchema().safeParse(input),
}
export const triggerSchema = {
  parse: (input: unknown) => createTriggerSchema().parse(input),
  safeParse: (input: unknown) => createTriggerSchema().safeParse(input),
}
export const workflowSchema = {
  safeParse: (input: unknown) => createWorkflowSchema().safeParse(input),
}

export type Workflow = z.infer<ReturnType<typeof createWorkflowSchema>>
export type WorkflowNode = z.infer<ReturnType<typeof createNodeSchema>>
export type WorkflowTrigger = z.infer<ReturnType<typeof createTriggerSchema>>
export type WorkflowPolicy = z.infer<typeof policySchema>
export type ParsedDomainAction = z.infer<ReturnType<typeof createDomainActionSchema>>

export function parseWorkflow(input: unknown): Workflow {
  return createWorkflowSchema().parse(input)
}
