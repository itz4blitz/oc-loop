export default {
  testRunner: "vitest",
  mutate: ["src/domain/**/*.ts", "src/persistence/memory.ts", "src/persistence/atomic.ts", "src/persistence/catalog.ts", "src/persistence/filesystem.ts", "src/app/loop.ts", "src/app/transfer.ts", "src/app/tool.ts", "src/scheduler/coordinator.ts", "src/host/**/*.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  coverageAnalysis: "off",
  timeoutMS: 10000,
  concurrency: 4,
  incremental: true,
  incrementalFile: ".stryker-incremental.json",
  vitest: { related: false },
  thresholds: { high: 100, low: 100, break: 100 },
}
