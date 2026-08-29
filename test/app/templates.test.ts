import { describe, expect, it } from "vitest"
import { buildTemplate, templateNames } from "../../src/app/templates.js"
import type { Workflow } from "../../src/domain/schema.js"
import { parseWorkflow } from "../../src/domain/schema.js"

const input = { sessionId: "ses-1", nowMs: 100, workflowId: "wf-t", nodeId: "node-t" }

describe("loop templates", () => {
  it("exposes the four plan templates", () => {
    expect(templateNames()).toEqual(["continuation", "test-fix", "review", "watch"])
  })
  it("builds a parse-valid workflow for every template", () => {
    for (const name of templateNames()) {
      const workflow = buildTemplate(name, input)
      expect(workflow.id).toBe("wf-t")
      expect(parseWorkflow(workflow)).toEqual(workflow)
      expect(workflow.sessionBinding).toEqual({ sessionId: "ses-1" })
      expect(workflow.createdAt).toBe(100)
    }
  })
  it("continuation prompts and waits for idle", () => {
    const workflow = buildTemplate("continuation", input)
    expect(workflow.trigger).toEqual({ kind: "idle" })
    expect(workflow.node.kind === "prompt" && workflow.node.prompt).toContain("Continue")
  })
  it("test-fix verifies with the test command before continuing", () => {
    const workflow = buildTemplate("test-fix", input)
    expect(workflow.node.kind).toBe("condition")
    if (workflow.node.kind === "condition") {
      expect(workflow.node.command).toBe("pnpm test")
      expect(workflow.node.failPrompt).toContain("Fix")
    }
  })
  it("review is a single review prompt", () => {
    const workflow = buildTemplate("review", input)
    expect(workflow.node.kind === "prompt" && workflow.node.prompt).toContain("Review")
    expect(workflow.trigger).toEqual({ kind: "idle" })
  })
  it("watch runs on an interval", () => {
    const workflow = buildTemplate("watch", input)
    expect(workflow.trigger).toEqual({ kind: "interval", everyMs: 60_000 })
    expect(workflow.node.kind === "prompt" && workflow.node.prompt).toContain("Watch")
  })
  it("rejects unknown template names", () => {
    expect(() => buildTemplate("nope", input)).toThrow("unknown template")
  })
  it("passes worktree through", () => {
    const workflow = buildTemplate("continuation", { ...input, worktree: "/tmp/wt" })
    expect(workflow.sessionBinding.worktree).toBe("/tmp/wt")
  })
})
