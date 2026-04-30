import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffTraces } from "../src/diff.js";
import { TraceFile } from "../src/types.js";

function traceWithParams(params: unknown): TraceFile {
  return {
    version: "0.1.0",
    startedAt: "2026-04-29T00:00:00.000Z",
    endedAt: "2026-04-29T00:00:01.000Z",
    command: { executable: "node", args: ["server.js"] },
    summary: {
      messageCount: 2,
      requestCount: 1,
      responseCount: 1,
      notificationCount: 0,
      toolCallCount: 1,
      failedCount: 0,
      riskCount: 0,
      durationMs: 1000,
    },
    events: [],
    calls: [
      {
        id: 1,
        method: "tools/call",
        toolName: "echo",
        startedAt: "2026-04-29T00:00:00.000Z",
        endedAt: "2026-04-29T00:00:00.010Z",
        durationMs: 10,
        params,
        result: { ok: true },
        riskFlags: [],
      },
    ],
  };
}

describe("diffTraces", () => {
  it("detects nested parameter changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-flight-recorder-diff-"));
    const oldPath = join(dir, "old.json");
    const newPath = join(dir, "new.json");
    writeFileSync(
      oldPath,
      JSON.stringify(traceWithParams({ name: "echo", arguments: { text: "hi" } })),
    );
    writeFileSync(
      newPath,
      JSON.stringify(traceWithParams({ name: "echo", arguments: { text: "bye" } })),
    );

    const output = diffTraces(oldPath, newPath);

    expect(output).toContain("params changed: **1**");
    expect(output).toContain('"text":"hi"');
    expect(output).toContain('"text":"bye"');
  });
});
