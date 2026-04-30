# MCPTrace

[简体中文](./README.zh-CN.md) | English

> **MCPTrace is a flight recorder and replay debugger for MCP stdio servers.**

MCPTrace sits between an AI agent (Claude Desktop, Claude Code, Cursor, …) and
a Model Context Protocol stdio server. It transparently forwards every
JSON-RPC message in both directions while recording a structured trace, a
risk-annotated HTML timeline report, and a replayable log.

It is designed for three workflows:

- **Observe** — see *exactly* what your agent is asking your MCP server to do.
- **Audit** — flag dangerous accesses (`.env`, `rm -rf`, `DROP TABLE`, …) at a
  glance.
- **Reproduce** — diff two runs, or replay a captured trace against a fresh
  server to compare behavior.

No daemon, no cloud, no GUI app. Just a single CLI you wedge in front of any
MCP stdio server.

## Install

```bash
npm install -g @fjlkasdg45345/mcptrace
# or, locally
npm install --save-dev @fjlkasdg45345/mcptrace
```

You can also run it without installing:

```bash
npx @fjlkasdg45345/mcptrace wrap --trace ./trace.json -- <real-mcp-server-cmd>
```

## Quick start

```bash
mcptrace wrap \
  --trace ./traces/fs.json \
  --report ./traces/fs.html \
  -- npx -y @modelcontextprotocol/server-filesystem .
```

`mcptrace` becomes the MCP server your client talks to. It spawns the real
server as a child, forwards every line in both directions, and records the
traffic. When the client disconnects, the trace JSON and HTML report are
written to disk.

By default, MCPTrace redacts common secret-bearing fields such as
`authorization`, `token`, `apiKey`, `password`, `secret`, and `private_key`, and
omits raw JSON-RPC lines from persisted traces. Use `--unsafe-raw` only when you
need byte-for-byte payload capture for private local debugging.

> **stdout is sacred.** In `wrap` mode, mcptrace never writes anything to
> stdout other than valid MCP JSON-RPC. All logs go to stderr, prefixed with
> `[mcptrace]` or `[mcptrace:server]`.

## Use with Claude Desktop / Claude Code

Add an entry to your MCP config (paths must be absolute):

```json
{
  "mcpServers": {
    "filesystem-traced": {
      "command": "npx",
      "args": [
        "-y", "@fjlkasdg45345/mcptrace",
        "wrap",
        "--trace", "/abs/path/traces/fs.json",
        "--report", "/abs/path/traces/fs.html",
        "--",
        "npx", "-y", "@modelcontextprotocol/server-filesystem", "/abs/path/project"
      ]
    }
  }
}
```

See [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json).

## CLI

### `mcptrace wrap`

```bash
mcptrace wrap --trace <path> [--report <path>] [--unsafe-raw] -- <server-cmd> [args...]
```

Run an MCP stdio server through mcptrace.

Default traces are redacted for safer sharing. `--unsafe-raw` stores unredacted
payloads and raw JSON-RPC lines.

### `mcptrace report`

```bash
mcptrace report ./trace.json --out ./report.html [--unsafe-raw]
```

Re-render the HTML report from a saved trace. The HTML is a single
self-contained file — no CDN, no fonts, no JS framework. Existing trace files
are redacted again while rendering unless `--unsafe-raw` is passed.

### `mcptrace diff`

```bash
mcptrace diff ./old-trace.json ./new-trace.json [--unsafe-raw]
```

Prints a markdown diff showing:

- added / removed `tools/call`s
- calls whose params changed
- new / resolved risk flags
- side-by-side summary numbers

Diff output redacts common secret-bearing fields by default.

### `mcptrace replay`

```bash
mcptrace replay ./trace.json -- <server-cmd> [args...]
```

Replays every `client_to_server` request / notification from the trace
against a freshly spawned server, then prints a markdown summary:

- how many messages were sent
- how many were received
- request ids that never got a response
- responses whose error state changed vs. the original trace

Replay is best-effort and does not preserve original timing.

If the trace was captured with default redaction, replay uses the redacted
payloads. Capture with `wrap --unsafe-raw` when exact replay of sensitive fields
is required and the trace will remain private.

## Trace schema

A trace is a single JSON file with this shape:

```jsonc
{
  "version": "0.1.0",
  "startedAt": "2026-04-29T12:00:00.000Z",
  "endedAt":   "2026-04-29T12:00:42.000Z",
  "command": { "executable": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  "summary": {
    "messageCount": 42, "requestCount": 21, "responseCount": 20,
    "notificationCount": 1, "toolCallCount": 7,
    "failedCount": 0, "riskCount": 2, "durationMs": 42000
  },
  "events": [
    {
      "seq": 1, "timestamp": "...", "direction": "client_to_server",
      "jsonrpc": "2.0", "id": 1, "kind": "request", "method": "tools/call",
      "params": { "name": "read_file", "arguments": { "path": ".env" } },
      "result": null, "error": null,
      "riskFlags": [{ "code": "sensitive_file", "severity": "high", "message": "..." }]
    }
  ],
  "calls": [
    {
      "id": 1, "method": "tools/call", "toolName": "read_file",
      "startedAt": "...", "endedAt": "...", "durationMs": 42,
      "params": { /* ... */ }, "result": { /* ... */ }, "error": null,
      "riskFlags": [/* ... */]
    }
  ]
}
```

`events` is the timeline. `calls` is a derived view keyed by request id, with
the response merged in. Raw JSON-RPC lines are omitted by default; they are
present only for traces captured with `wrap --unsafe-raw`.

## Sensitive data

MCP traffic can include prompts, file contents, private paths, API keys, and
other secrets. Treat traces, reports, diffs, and replay summaries as sensitive
artifacts until reviewed. The repository `.gitignore` excludes common trace and
credential file patterns, but you should still inspect artifacts before sharing
or committing them.

## Risk detection

MCPTrace scans every message for known-risky patterns and tags them with
`riskFlags`. It is intentionally a simple, regex-based scanner — fast,
predictable, and easy to extend. Categories:

| code                | severity | example                                |
| ------------------- | -------- | -------------------------------------- |
| `sensitive_file`    | high     | `.env`, `id_rsa`, `credentials`, …     |
| `dangerous_shell`   | high/med | `rm -rf`, `curl … \| bash`, `chmod 777` |
| `dangerous_sql`     | high     | `DROP TABLE`, `DELETE FROM`, `TRUNCATE` |
| `sensitive_sql`     | medium   | `SELECT * FROM users`                  |
| `dependency_change` | medium   | `package.json`, `pnpm-lock.yaml`, …    |
| `network_egress`    | low      | `https://…`, `curl`, `wget`            |

False positives are expected. The goal is: nothing risky goes by unnoticed.

## Roadmap

- [ ] Pluggable risk rules (load from JSON / TS file)
- [ ] Streaming JSONL trace output (rotate on size)
- [ ] HTTP/SSE transport (in addition to stdio)
- [ ] Configurable redaction rules
- [ ] Tool-aware replay with assertion mode

Issues and PRs welcome.

## Contributing

```bash
npm install
npm run build
npm test
```

## License

MIT
