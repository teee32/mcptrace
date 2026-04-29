import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { NdjsonParser } from "./ndjson.js";
import { TraceFile } from "./types.js";

export interface ReplayOptions {
  tracePath: string;
  executable: string;
  args: string[];
  /** Time to wait for late responses after the last message is sent. */
  quietMs?: number;
}

interface ReplaySummary {
  sentMessages: number;
  receivedMessages: number;
  missingResponseIds: Array<string | number>;
  errorStateChanged: Array<{
    id: string | number;
    oldErrored: boolean;
    newErrored: boolean;
  }>;
}

function loadTrace(path: string): TraceFile {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as TraceFile;
}

function logErr(msg: string): void {
  process.stderr.write(`[mcptrace:replay] ${msg}\n`);
}

export async function runReplay(opts: ReplayOptions): Promise<ReplaySummary> {
  const trace = loadTrace(opts.tracePath);
  const quietMs = opts.quietMs ?? 1500;

  // Collect outbound messages (from client to server) in original order.
  const outbound = trace.events.filter(
    (e) =>
      e.direction === "client_to_server" &&
      (e.kind === "request" || e.kind === "notification"),
  );

  // Build map of original responses keyed by id, to compare error state
  const originalResponses = new Map<string, { error: unknown }>();
  for (const e of trace.events) {
    if (
      e.direction === "server_to_client" &&
      e.kind === "response" &&
      e.id !== undefined &&
      e.id !== null
    ) {
      originalResponses.set(String(e.id), { error: e.error });
    }
  }

  const child = spawn(opts.executable, opts.args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").replace(/\n$/, "");
    if (text) logErr(`server: ${text}`);
  });

  const receivedById = new Map<string, { error: unknown }>();
  let receivedCount = 0;

  const parser = new NdjsonParser({
    onMessage: (value) => {
      receivedCount++;
      if (value && typeof value === "object") {
        const obj = value as { id?: string | number | null; error?: unknown };
        if (obj.id !== undefined && obj.id !== null) {
          receivedById.set(String(obj.id), { error: obj.error });
        }
      }
    },
    onError: (err) => {
      logErr(`failed to parse server reply: ${err.message}`);
    },
  });

  child.stdout.on("data", (chunk: Buffer) => parser.feed(chunk));

  const childExited = new Promise<void>((resolveExit) => {
    child.on("exit", () => resolveExit());
    child.on("error", (err) => {
      logErr(`server spawn error: ${err.message}`);
      resolveExit();
    });
  });

  // Send each captured outbound message in original order.
  let sent = 0;
  const sentRequestIds: Array<string | number> = [];
  for (const ev of outbound) {
    const msg: Record<string, unknown> = { jsonrpc: ev.jsonrpc ?? "2.0" };
    if (ev.method) msg.method = ev.method;
    if (ev.id !== undefined && ev.id !== null) msg.id = ev.id;
    if (ev.params !== undefined) msg.params = ev.params;
    const line = JSON.stringify(msg) + "\n";
    if (child.stdin.destroyed || !child.stdin.writable) break;
    child.stdin.write(line);
    sent++;
    if (ev.kind === "request" && ev.id !== undefined && ev.id !== null) {
      sentRequestIds.push(ev.id);
    }
  }

  // Give the server time to respond, then wind down.
  await new Promise((r) => setTimeout(r, quietMs));
  if (!child.stdin.destroyed) child.stdin.end();
  // Race: wait for natural exit, but force-kill after a grace window.
  await Promise.race([
    childExited,
    new Promise<void>((r) =>
      setTimeout(() => {
        if (!child.killed) child.kill("SIGTERM");
        r();
      }, 2000),
    ),
  ]);
  parser.flush();

  // Compute summary
  const missingResponseIds: Array<string | number> = [];
  for (const id of sentRequestIds) {
    if (!receivedById.has(String(id))) missingResponseIds.push(id);
  }

  const errorStateChanged: ReplaySummary["errorStateChanged"] = [];
  for (const id of sentRequestIds) {
    const orig = originalResponses.get(String(id));
    const now = receivedById.get(String(id));
    if (!orig || !now) continue;
    const oldErrored = orig.error !== undefined && orig.error !== null;
    const newErrored = now.error !== undefined && now.error !== null;
    if (oldErrored !== newErrored) {
      errorStateChanged.push({ id, oldErrored, newErrored });
    }
  }

  return {
    sentMessages: sent,
    receivedMessages: receivedCount,
    missingResponseIds,
    errorStateChanged,
  };
}

export function formatReplaySummary(s: ReplaySummary): string {
  const lines: string[] = [];
  lines.push(`# MCPTrace replay summary`);
  lines.push("");
  lines.push(`- sent messages: **${s.sentMessages}**`);
  lines.push(`- received messages: **${s.receivedMessages}**`);
  lines.push(`- missing responses: **${s.missingResponseIds.length}**`);
  if (s.missingResponseIds.length) {
    for (const id of s.missingResponseIds) lines.push(`  - id=${id}`);
  }
  lines.push(`- error-state changes: **${s.errorStateChanged.length}**`);
  if (s.errorStateChanged.length) {
    for (const e of s.errorStateChanged) {
      lines.push(
        `  - id=${e.id} old=${e.oldErrored ? "error" : "ok"} new=${e.newErrored ? "error" : "ok"}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
