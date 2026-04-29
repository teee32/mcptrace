import { describe, it, expect } from "vitest";
import { TraceBuilder } from "../src/trace.js";

describe("TraceBuilder", () => {
  it("records a request event", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("client_to_server", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1.0" },
    });
    const trace = t.toJSON();
    expect(trace.summary.requestCount).toBe(1);
    expect(trace.events[0].kind).toBe("request");
    expect(trace.events[0].method).toBe("initialize");
  });

  it("records a response event", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
    const trace = t.toJSON();
    expect(trace.summary.responseCount).toBe(1);
    expect(trace.events[0].kind).toBe("response");
  });

  it("links request and response by id and computes duration", async () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("client_to_server", {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "read_file", arguments: { path: "README.md" } },
    });
    await new Promise((r) => setTimeout(r, 5));
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      id: 7,
      result: { content: "# hi" },
    });
    const trace = t.toJSON();
    expect(trace.calls.length).toBe(1);
    const call = trace.calls[0];
    expect(call.method).toBe("tools/call");
    expect(call.toolName).toBe("read_file");
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
    expect(call.result).toEqual({ content: "# hi" });
    expect(trace.summary.toolCallCount).toBe(1);
  });

  it("counts failed calls when response has error", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("client_to_server", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "noop", arguments: {} },
    });
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32000, message: "boom" },
    });
    const trace = t.toJSON();
    expect(trace.summary.failedCount).toBe(1);
  });

  it("counts risk events", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("client_to_server", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read_file", arguments: { path: "/repo/.env" } },
    });
    const trace = t.toJSON();
    expect(trace.summary.riskCount).toBeGreaterThan(0);
    expect(trace.calls[0].riskFlags.length).toBeGreaterThan(0);
  });

  it("handles notifications (no id)", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {},
    });
    const trace = t.toJSON();
    expect(trace.summary.notificationCount).toBe(1);
    expect(trace.events[0].kind).toBe("notification");
  });
});
