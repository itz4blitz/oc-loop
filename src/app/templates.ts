import { createLoopWorkflow } from "./loop.js"
import type { Workflow } from "../domain/schema.js"

export type TemplateName = "continuation" | "test-fix" | "review" | "watch"

export function templateNames(): readonly TemplateName[] {
  return ["continuation", "test-fix", "review", "watch"]
}

export function buildTemplate(
  name: string,
  input: { sessionId: string; worktree?: string | undefined; nowMs: number; workflowId: string; nodeId: string },
): Workflow {
  if (!templateNames().includes(name as TemplateName)) throw new Error(`unknown template: ${name}`)
  const templateName = name as TemplateName
  const workflow = createLoopWorkflow({ ...input, prompt: templatePrompt(templateName) })
  return { ...workflow, trigger: templateTrigger(templateName), node: templateNode(templateName, input.nodeId) }
}

export function templatePrompt(name: TemplateName): string {
  const prompts: Record<TemplateName, string> = {
    continuation: "Continue the current task until it is done.",
    "test-fix": "Fix the failing tests and commit.",
    review: "Review the latest diff for correctness, tests, and regressions.",
    watch: "Watch for new output and respond when something actionable appears.",
  }
  return prompts[name]
}

export function templateTrigger(name: TemplateName): Workflow["trigger"] {
  return name === "watch" ? { kind: "interval", everyMs: 60_000 } : { kind: "idle" }
}

export function templateNode(name: TemplateName, nodeId: string): Workflow["node"] {
  if (name === "test-fix") {
    return { id: nodeId, kind: "condition", command: "pnpm test", failPrompt: "Fix the failing tests and commit.", timeoutMs: 600_000 }
  }
  return { id: nodeId, kind: "prompt", prompt: templatePrompt(name) }
}
