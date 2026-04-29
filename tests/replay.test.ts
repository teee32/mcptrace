import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReplay } from "../src/replay.js";
import { TraceFile } from "../src/types.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), "utf8");
}

describe("runReplay", () => {
  it("keeps numeric and string request ids separate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcptrace-replay-"));
    const tracePath = join(dir, "trace.json");
    const serverPath = join(dir, "server.cjs");

    const trace: TraceFile = {
      version: "0.1.0",
      startedAt: "2026-04-29T00:00:00.000Z",
      endedAt: "2026-04-29T00:00:01.000Z",
      command: { executable: "node", args: ["server.cjs"] },
      summary: {
        messageCount: 2,
        requestCount: 2,
        responseCount: 0,
        notificationCount: 0,
        toolCallCount: 0,
        failedCount: 0,
        riskCount: 0,
        durationMs: 1000,
      },
      events: [
        {
          seq: 1,
          timestamp: "2026-04-29T00:00:00.000Z",
          direction: "client_to_server",
          jsonrpc: "2.0",
          id: 1,
          kind: "request",
          method: "ping",
          riskFlags: [],
        },
        {
          seq: 2,
          timestamp: "2026-04-29T00:00:00.001Z",
          direction: "client_to_server",
          jsonrpc: "2.0",
          id: "1",
          kind: "request",
          method: "ping",
          riskFlags: [],
        },
      ],
      calls: [],
    };

    writeJson(tracePath, trace);
    writeFileSync(
      serverPath,
      [
        "const readline = require('node:readline');",
        "const rl = readline.createInterface({ input: process.stdin });",
        "rl.on('line', (line) => {",
        "  const msg = JSON.parse(line);",
        "  if (typeof msg.id === 'string') {",
        "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\\n');",
        "  }",
        "});",
      ].join("\n"),
      "utf8",
    );

    const summary = await runReplay({
      tracePath,
      executable: "node",
      args: [serverPath],
      quietMs: 50,
    });

    expect(summary.receivedMessages).toBe(1);
    expect(summary.missingResponseIds).toEqual([1]);
  });
});
