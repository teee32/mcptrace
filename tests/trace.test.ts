import { describe, it, expect } from "vitest";
import { TraceBuilder } from "../src/trace.js";
import { REDACTED } from "../src/redact.js";

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

  it("redacts common secret fields by default", () => {
    const t = new TraceBuilder({
      executable: "node",
      args: ["server.js", "--api-key=secret-token"],
    });
    t.recordMessage(
      "client_to_server",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: {
            token: "secret-token",
            url: "https://example.test/path?token=secret-token",
          },
        },
      },
      '{"params":{"arguments":{"token":"secret-token"}}}',
    );
    const trace = t.toJSON();
    expect(trace.command.args).toEqual(["server.js", `--api-key=${REDACTED}`]);
    expect(trace.events[0].raw).toBeUndefined();
    expect(trace.events[0].params).toEqual({
      name: "echo",
      arguments: {
        token: REDACTED,
        url: `https://example.test/path?token=${REDACTED}`,
      },
    });
    expect(
      trace.events[0].riskFlags.some((flag) =>
        flag.message.includes(`token=${REDACTED}`),
      ),
    ).toBe(true);
    expect(trace.calls[0].params).toEqual({
      name: "echo",
      arguments: {
        token: REDACTED,
        url: `https://example.test/path?token=${REDACTED}`,
      },
    });
    expect(
      trace.calls[0].riskFlags.some((flag) =>
        flag.message.includes(`token=${REDACTED}`),
      ),
    ).toBe(true);
  });

  it("can preserve raw payloads for unsafe local debugging", () => {
    const t = new TraceBuilder({ executable: "node", args: [] }, { redact: false });
    t.recordMessage(
      "client_to_server",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { token: "secret-token" } },
      },
      '{"params":{"arguments":{"token":"secret-token"}}}',
    );
    const trace = t.toJSON();
    expect(trace.events[0].raw).toContain("secret-token");
    expect(trace.events[0].params).toEqual({
      name: "echo",
      arguments: { token: "secret-token" },
    });
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

  it("classifies JSON-RPC null-id error responses as responses", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    const trace = t.toJSON();
    expect(trace.summary.responseCount).toBe(1);
    expect(trace.summary.failedCount).toBe(1);
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

  it("keeps same-id requests in opposite directions separate", () => {
    const t = new TraceBuilder({ executable: "node", args: [] });
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      id: 1,
      method: "sampling/createMessage",
      params: { prompt: "hello" },
    });
    t.recordMessage("client_to_server", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hi" } },
    });
    t.recordMessage("server_to_client", {
      jsonrpc: "2.0",
      id: 1,
      result: { content: "tool result" },
    });
    t.recordMessage("client_to_server", {
      jsonrpc: "2.0",
      id: 1,
      result: { content: "sampling result" },
    });

    const trace = t.toJSON();
    expect(trace.calls.length).toBe(2);
    const sampling = trace.calls.find((c) => c.method === "sampling/createMessage");
    const tool = trace.calls.find((c) => c.method === "tools/call");
    expect(sampling?.result).toEqual({ content: "sampling result" });
    expect(tool?.result).toEqual({ content: "tool result" });
  });
});
