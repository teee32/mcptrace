import { describe, expect, it } from "vitest";
import { redactTrace, redactValue, REDACTED } from "../src/redact.js";
import { TraceFile } from "../src/types.js";

describe("redaction", () => {
  it("redacts common secret keys recursively", () => {
    expect(
      redactValue({
        nested: {
          apiKey: "secret",
          authorization: "Bearer sk-test1234567890",
        },
      }),
    ).toEqual({
      nested: {
        apiKey: REDACTED,
        authorization: REDACTED,
      },
    });
  });

  it("redacts common secret text patterns", () => {
    expect(
      redactValue("https://example.test/path?token=abc123&x=1 apiKey=secret"),
    ).toBe(`https://example.test/path?token=${REDACTED}&x=1 apiKey=${REDACTED}`);
  });

  it("omits raw trace lines when redacting a trace", () => {
    const trace: TraceFile = {
      version: "0.1.0",
      startedAt: "2026-04-29T00:00:00.000Z",
      endedAt: "2026-04-29T00:00:01.000Z",
      command: { executable: "node", args: [] },
      summary: {
        messageCount: 1,
        requestCount: 1,
        responseCount: 0,
        notificationCount: 0,
        toolCallCount: 1,
        failedCount: 0,
        riskCount: 1,
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
          method: "tools/call",
          params: { token: "secret" },
          raw: '{"token":"secret"}',
          riskFlags: [
            {
              code: "network_egress",
              severity: "low",
              message: "Outbound URL referenced: https://x.test/?token=secret",
            },
          ],
        },
      ],
      calls: [
        {
          id: 1,
          method: "tools/call",
          startedAt: "2026-04-29T00:00:00.000Z",
          params: { token: "secret" },
          riskFlags: [
            {
              code: "network_egress",
              severity: "low",
              message: "Outbound URL referenced: https://x.test/?token=secret",
            },
          ],
        },
      ],
    };

    const redacted = redactTrace(trace);

    expect(redacted.events[0].params).toEqual({ token: REDACTED });
    expect(redacted.events[0].raw).not.toContain("secret");
    expect(redacted.events[0].riskFlags[0].message).toContain(`token=${REDACTED}`);
    expect(redacted.calls[0].params).toEqual({ token: REDACTED });
    expect(redacted.calls[0].riskFlags[0].message).toContain(`token=${REDACTED}`);
  });
});
