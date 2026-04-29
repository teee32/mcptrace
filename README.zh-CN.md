# MCPTrace

简体中文 | [English](./README.md)

> **MCPTrace 是 MCP stdio 服务器的飞行记录仪和回放调试器。**

MCPTrace 位于 AI agent（Claude Desktop、Claude Code、Cursor 等）和
Model Context Protocol stdio 服务器之间。它会透明转发双向 JSON-RPC 消息，
同时记录结构化 trace、带风险标注的 HTML 时间线报告，以及可回放的日志。

它主要面向三类工作流：

- **观察**：看清 agent 到底在请求 MCP server 做什么。
- **审计**：快速发现危险访问，例如 `.env`、`rm -rf`、`DROP TABLE`。
- **复现**：对比两次运行，或把已捕获的 trace 回放到新的 server 上比较行为。

不需要 daemon，不依赖云服务，也没有 GUI。它就是一个可以插到任意 MCP
stdio server 前面的 CLI。

## 安装

```bash
npm install -g mcptrace
# 或安装到当前项目
npm install --save-dev mcptrace
```

也可以不安装，直接通过 `npx` 运行：

```bash
npx mcptrace wrap --trace ./trace.json -- <real-mcp-server-cmd>
```

## 快速开始

```bash
mcptrace wrap \
  --trace ./traces/fs.json \
  --report ./traces/fs.html \
  -- npx -y @modelcontextprotocol/server-filesystem .
```

此时 `mcptrace` 会变成 MCP client 连接的 server。它会启动真实 server
作为子进程，转发双向每一行消息，并记录流量。client 断开后，trace JSON
和 HTML 报告会写入磁盘。

默认情况下，MCPTrace 会脱敏常见敏感字段，例如 `authorization`、`token`、
`apiKey`、`password`、`secret` 和 `private_key`，并且不会把原始 JSON-RPC
行持久化到 trace 中。只有在私有本地调试、确实需要逐字节捕获 payload 时，
才使用 `--unsafe-raw`。

> **stdout 是协议通道。** 在 `wrap` 模式下，mcptrace 不会向 stdout
> 写入任何非 MCP JSON-RPC 内容。所有日志都会写到 stderr，并带有
> `[mcptrace]` 或 `[mcptrace:server]` 前缀。

## 在 Claude Desktop / Claude Code 中使用

在 MCP 配置中加入一项（路径必须是绝对路径）：

```json
{
  "mcpServers": {
    "filesystem-traced": {
      "command": "npx",
      "args": [
        "-y", "mcptrace",
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

参考 [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)。

## CLI

### `mcptrace wrap`

```bash
mcptrace wrap --trace <path> [--report <path>] [--unsafe-raw] -- <server-cmd> [args...]
```

通过 mcptrace 运行一个 MCP stdio server。

默认 trace 会被脱敏，便于更安全地分享。`--unsafe-raw` 会存储未脱敏 payload
和原始 JSON-RPC 行。

### `mcptrace report`

```bash
mcptrace report ./trace.json --out ./report.html [--unsafe-raw]
```

从已有 trace 重新生成 HTML 报告。HTML 是单文件、自包含的，不依赖 CDN、
字体或 JS 框架。除非传入 `--unsafe-raw`，否则渲染报告时会再次脱敏已有
trace 文件。

### `mcptrace diff`

```bash
mcptrace diff ./old-trace.json ./new-trace.json [--unsafe-raw]
```

输出 markdown 格式的差异报告，包括：

- 新增 / 删除的 `tools/call`
- 参数发生变化的调用
- 新增 / 已解决的风险标记
- 两次运行的摘要数字对比

diff 输出默认会脱敏常见敏感字段。

### `mcptrace replay`

```bash
mcptrace replay ./trace.json -- <server-cmd> [args...]
```

把 trace 中每个 `client_to_server` 请求 / 通知回放到一个新启动的 server，
然后输出 markdown 摘要：

- 发送了多少消息
- 收到了多少消息
- 哪些 request id 没有收到响应
- 响应的 error 状态是否相对原 trace 发生变化

replay 是尽力而为的调试工具，不会保留原始时序。

如果 trace 是默认脱敏捕获的，replay 会使用脱敏后的 payload。需要精确回放
敏感字段时，请用 `wrap --unsafe-raw` 捕获，并确保 trace 只留在私有环境中。

## Trace schema

trace 是一个 JSON 文件，结构如下：

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

`events` 是完整时间线。`calls` 是按 request id 合并响应后的派生视图。
原始 JSON-RPC 行默认会被省略；只有通过 `wrap --unsafe-raw` 捕获的 trace
才会包含它们。

## 敏感数据

MCP 流量可能包含 prompts、文件内容、私有路径、API key 和其他 secret。
在人工审查前，请把 traces、reports、diffs 和 replay summaries 都当作敏感
产物处理。仓库 `.gitignore` 已排除常见 trace 和凭据文件模式，但分享或提交
前仍然应该自行检查。

## 风险检测

MCPTrace 会扫描每条消息中的已知风险模式，并打上 `riskFlags`。它刻意保持为
简单的正则扫描器：快速、可预测，也容易扩展。当前分类包括：

| code                | severity | 示例                                   |
| ------------------- | -------- | -------------------------------------- |
| `sensitive_file`    | high     | `.env`、`id_rsa`、`credentials` 等     |
| `dangerous_shell`   | high/med | `rm -rf`、`curl ... \| bash`、`chmod 777` |
| `dangerous_sql`     | high     | `DROP TABLE`、`DELETE FROM`、`TRUNCATE` |
| `sensitive_sql`     | medium   | `SELECT * FROM users`                  |
| `dependency_change` | medium   | `package.json`、`pnpm-lock.yaml` 等    |
| `network_egress`    | low      | `https://...`、`curl`、`wget`          |

误报是预期内的。目标是：不要让有风险的行为悄悄溜过去。

## Roadmap

- [ ] 可插拔风险规则（从 JSON / TS 文件加载）
- [ ] 流式 JSONL trace 输出（按大小轮转）
- [ ] HTTP/SSE transport（除 stdio 外）
- [ ] 可配置脱敏规则
- [ ] 带断言模式的 tool-aware replay

欢迎提交 issue 和 PR。

## 贡献

```bash
npm install
npm run build
npm test
```

## License

MIT
