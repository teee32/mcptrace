/**
 * Tiny stand-in for a real MCP stdio server, used by end-to-end tests and
 * manual smoke checks.
 *
 * Reads NDJSON JSON-RPC requests from stdin and answers them on stdout.
 *
 *   - initialize          -> returns a fake serverInfo
 *   - tools/list          -> returns one tool: "echo"
 *   - tools/call (echo)   -> returns the input arguments back
 *   - anything else       -> returns method-not-found error
 *
 * Logs go to stderr.
 */

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: { id?: string | number; method?: string; params?: unknown };
  try {
    msg = JSON.parse(trimmed);
  } catch {
    process.stderr.write(`fake-mcp: unparseable line: ${trimmed}\n`);
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp-server", version: "0.0.1" },
      },
    });
    return;
  }

  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo back its arguments",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === "tools/call") {
    const params = msg.params as { name?: string; arguments?: unknown };
    if (params?.name === "echo") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(params.arguments ?? {}),
            },
          ],
        },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Unknown tool: ${params?.name ?? ""}` },
    });
    return;
  }

  if (msg.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
});

rl.on("close", () => {
  process.exit(0);
});
