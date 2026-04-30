# Basic usage

## 1. Wrap an MCP server and record traffic

```bash
mcp-flight-recorder wrap \
  --trace ./traces/fs.json \
  --report ./traces/fs.html \
  -- npx -y @modelcontextprotocol/server-filesystem .
```

`mcp-flight-recorder` itself is now an MCP stdio server. Point your client (Claude
Desktop, Claude Code, Cursor, etc.) at it. All JSON-RPC traffic will be
forwarded to the underlying server and recorded.

When the client disconnects, `mcp-flight-recorder` writes the trace JSON and (if
requested) a self-contained HTML report.

## 2. Re-render the HTML report later

```bash
mcp-flight-recorder report ./traces/fs.json --out ./traces/fs.html
```

## 3. Diff two traces

```bash
mcp-flight-recorder diff ./traces/before.json ./traces/after.json > diff.md
```

Useful when comparing runs across versions of an MCP server, or before / after
a prompt change.

## 4. Replay a trace against a server

```bash
mcp-flight-recorder replay ./traces/fs.json -- npx -y @modelcontextprotocol/server-filesystem .
```

Replays only the `client_to_server` requests / notifications captured in the
trace. Prints a markdown summary of what was sent, what came back, which
request ids never got a response, and which responses changed error state.

## 5. Quick smoke test with the bundled fake server

```bash
# build first
npm run build

# wrap the fake server
node dist/cli.js wrap --trace /tmp/fake.json --report /tmp/fake.html -- \
  node --experimental-strip-types tests/fixtures/fake-mcp-server.ts \
  <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"}}}
EOF

cat /tmp/fake.json | jq '.summary'
```
