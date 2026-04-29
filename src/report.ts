import { TraceFile } from "./types.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #0f1115;
  --panel: #161a22;
  --panel-2: #1d222d;
  --border: #2a3040;
  --text: #e6e8ee;
  --muted: #9aa3b2;
  --accent: #6aa9ff;
  --accent-2: #9c6aff;
  --green: #3ecf8e;
  --red: #ff6b6b;
  --orange: #ff9f43;
  --yellow: #ffd166;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f7f8fa;
    --panel: #ffffff;
    --panel-2: #f0f2f6;
    --border: #dde2ea;
    --text: #1a1d23;
    --muted: #5a6373;
    --accent: #2f6fed;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.45;
}
header {
  padding: 24px 32px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
header h1 { margin: 0 0 4px; font-size: 20px; }
header .meta { color: var(--muted); font-size: 13px; }
main { padding: 24px 32px; max-width: 1200px; margin: 0 auto; }
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
.card.bad .value { color: var(--red); }
.card.warn .value { color: var(--orange); }
.card.good .value { color: var(--green); }
section { margin-bottom: 32px; }
section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 12px; }
.timeline {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 60px 110px 90px 1fr 120px;
  gap: 8px;
  padding: 10px 14px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  cursor: pointer;
}
.row:last-child { border-bottom: none; }
.row:hover { background: var(--panel-2); }
.row .seq { color: var(--muted); font-variant-numeric: tabular-nums; }
.row .dir { font-size: 11px; padding: 2px 6px; border-radius: 4px; text-align: center; }
.row .dir.c2s { background: rgba(106,169,255,0.15); color: var(--accent); }
.row .dir.s2c { background: rgba(156,106,255,0.15); color: var(--accent-2); }
.row .kind { font-size: 11px; text-transform: uppercase; color: var(--muted); }
.row .method { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row .meta { color: var(--muted); font-size: 12px; text-align: right; }
.row.error .method::before { content: "✗ "; color: var(--red); }
.row.risky { border-left: 3px solid var(--orange); }
.detail {
  display: none;
  padding: 12px 14px 16px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
}
.detail.open { display: block; }
.detail h3 { margin: 0 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.detail pre {
  margin: 0 0 12px;
  padding: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.risks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.risk-pill {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  background: rgba(255,159,67,0.12);
  color: var(--orange);
  border: 1px solid rgba(255,159,67,0.35);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}
.risk-pill.high { background: rgba(255,107,107,0.12); color: var(--red); border-color: rgba(255,107,107,0.35); }
.risk-pill.low { background: rgba(106,169,255,0.12); color: var(--accent); border-color: rgba(106,169,255,0.35); }
.calls-table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-size: 13px; }
.calls-table th, .calls-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
.calls-table th { background: var(--panel-2); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.calls-table tr:last-child td { border-bottom: none; }
.calls-table .err { color: var(--red); }
code.cmd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel-2); padding: 2px 6px; border-radius: 4px; }
.empty { padding: 24px; color: var(--muted); text-align: center; background: var(--panel); border: 1px dashed var(--border); border-radius: 8px; }
`;

const SCRIPT = `
document.addEventListener("click", (ev) => {
  const row = ev.target.closest("[data-event-row]");
  if (!row) return;
  const detail = row.nextElementSibling;
  if (detail && detail.classList.contains("detail")) {
    detail.classList.toggle("open");
  }
});
`;

function fmtParams(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fmtValue(value: unknown): string {
  return escapeHtml(String(value));
}

export function renderReport(trace: TraceFile): string {
  const cmd = `${trace.command.executable} ${trace.command.args.join(" ")}`.trim();
  const eventRows = trace.events
    .map((ev) => {
      const dirClass = ev.direction === "client_to_server" ? "c2s" : "s2c";
      const dirLabel = ev.direction === "client_to_server" ? "→ SRV" : "← SRV";
      const method = ev.method
        ? escapeHtml(ev.method)
        : ev.kind === "response"
          ? "(response)"
          : ev.kind === "parse_error"
            ? "(parse error)"
            : "(no method)";
      const idDisp = ev.id !== undefined && ev.id !== null ? `#${ev.id}` : "";
      const ts = ev.timestamp.split("T")[1]?.replace("Z", "") ?? ev.timestamp;
      const isErr = ev.error ? "error" : "";
      const isRisky = ev.riskFlags.length > 0 ? "risky" : "";

      const riskHtml = ev.riskFlags.length
        ? `<div class="risks">${ev.riskFlags
            .map(
              (r) =>
                `<span class="risk-pill ${escapeHtml(r.severity)}" title="${escapeHtml(r.code)}">${escapeHtml(r.message)}</span>`,
            )
            .join("")}</div>`
        : "";

      const bodySections: string[] = [];
      if (ev.params !== undefined)
        bodySections.push(
          `<h3>params</h3><pre>${escapeHtml(fmtParams(ev.params))}</pre>`,
        );
      if (ev.result !== undefined)
        bodySections.push(
          `<h3>result</h3><pre>${escapeHtml(fmtParams(ev.result))}</pre>`,
        );
      if (ev.error !== undefined && ev.error !== null)
        bodySections.push(
          `<h3>error</h3><pre>${escapeHtml(fmtParams(ev.error))}</pre>`,
        );
      if (ev.raw && ev.kind === "parse_error")
        bodySections.push(
          `<h3>raw</h3><pre>${escapeHtml(ev.raw)}</pre>`,
        );

      return `
        <div class="row ${isErr} ${isRisky}" data-event-row>
          <span class="seq">#${fmtValue(ev.seq)}</span>
          <span class="dir ${dirClass}">${dirLabel}</span>
          <span class="kind">${escapeHtml(ev.kind)}</span>
          <span class="method">${method} <span class="meta">${escapeHtml(idDisp)}</span></span>
          <span class="meta">${escapeHtml(ts)}</span>
        </div>
        <div class="detail">
          ${bodySections.join("")}
          ${riskHtml}
        </div>
      `;
    })
    .join("\n");

  const callRows = trace.calls
    .map((c) => {
      const dur = c.durationMs !== undefined ? `${c.durationMs} ms` : "—";
      const errCell = c.error
        ? `<span class="err">${escapeHtml(JSON.stringify(c.error)).slice(0, 200)}</span>`
        : "";
      return `<tr>
        <td>#${fmtValue(c.id)}</td>
        <td><code>${escapeHtml(c.method)}</code></td>
        <td>${escapeHtml(c.toolName ?? "")}</td>
        <td>${fmtValue(dur)}</td>
        <td>${fmtValue(c.riskFlags.length)}</td>
        <td>${errCell}</td>
      </tr>`;
    })
    .join("\n");

  const callsBlock = trace.calls.length
    ? `<table class="calls-table">
        <thead>
          <tr><th>id</th><th>method</th><th>tool</th><th>duration</th><th>risks</th><th>error</th></tr>
        </thead>
        <tbody>${callRows}</tbody>
       </table>`
    : `<div class="empty">No calls recorded.</div>`;

  const eventsBlock = trace.events.length
    ? `<div class="timeline">${eventRows}</div>`
    : `<div class="empty">No messages recorded.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCPTrace Report</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>MCPTrace Report</h1>
  <div class="meta">
    <code class="cmd">${escapeHtml(cmd || "(no command)")}</code>
    &nbsp;·&nbsp; ${escapeHtml(trace.startedAt)} → ${escapeHtml(trace.endedAt)}
    &nbsp;·&nbsp; trace v${escapeHtml(trace.version)}
  </div>
</header>
<main>
  <section class="summary">
    <div class="card"><div class="label">Messages</div><div class="value">${fmtValue(trace.summary.messageCount)}</div></div>
    <div class="card"><div class="label">Requests</div><div class="value">${fmtValue(trace.summary.requestCount)}</div></div>
    <div class="card"><div class="label">Responses</div><div class="value">${fmtValue(trace.summary.responseCount)}</div></div>
    <div class="card"><div class="label">Notifications</div><div class="value">${fmtValue(trace.summary.notificationCount)}</div></div>
    <div class="card"><div class="label">Tool calls</div><div class="value">${fmtValue(trace.summary.toolCallCount)}</div></div>
    <div class="card ${trace.summary.failedCount ? "bad" : "good"}"><div class="label">Failed</div><div class="value">${fmtValue(trace.summary.failedCount)}</div></div>
    <div class="card ${trace.summary.riskCount ? "warn" : "good"}"><div class="label">Risks</div><div class="value">${fmtValue(trace.summary.riskCount)}</div></div>
    <div class="card"><div class="label">Duration</div><div class="value">${fmtValue(trace.summary.durationMs)} ms</div></div>
  </section>

  <section>
    <h2>Tool Calls</h2>
    ${callsBlock}
  </section>

  <section>
    <h2>Timeline</h2>
    ${eventsBlock}
  </section>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
