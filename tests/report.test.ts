import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report.js";
import { TraceFile } from "../src/types.js";

describe("renderReport", () => {
  it("escapes call table scalar fields", () => {
    const trace: TraceFile = {
      version: "0.1.0",
      startedAt: "2026-04-29T00:00:00.000Z",
      endedAt: "2026-04-29T00:00:01.000Z",
      command: { executable: "node", args: ["server.js"] },
      summary: {
        messageCount: 1,
        requestCount: 1,
        responseCount: 0,
        notificationCount: 0,
        toolCallCount: 0,
        failedCount: 0,
        riskCount: 0,
        durationMs: 1000,
      },
      events: [],
      calls: [
        {
          id: '<img src=x onerror="alert(1)">',
          method: "sampling/createMessage",
          startedAt: "2026-04-29T00:00:00.000Z",
          durationMs: 5,
          riskFlags: [],
        },
      ],
    };

    const html = renderReport(trace);

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("#&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes timeline scalar fields", () => {
    const trace: TraceFile = {
      version: "0.1.0",
      startedAt: "2026-04-29T00:00:00.000Z",
      endedAt: "2026-04-29T00:00:01.000Z",
      command: { executable: "node", args: ["server.js"] },
      summary: {
        messageCount: 1,
        requestCount: 1,
        responseCount: 0,
        notificationCount: 0,
        toolCallCount: 0,
        failedCount: 0,
        riskCount: 0,
        durationMs: 1000,
      },
      events: [
        {
          seq: '<script>alert(1)</script>' as unknown as number,
          timestamp: "2026-04-29T00:00:00.000Z",
          direction: "server_to_client",
          id: '<img src=x onerror="alert(1)">',
          kind: "request",
          method: "sampling/createMessage",
          params: {},
          riskFlags: [],
        },
      ],
      calls: [],
    };

    const html = renderReport(trace);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("#&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("#&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
