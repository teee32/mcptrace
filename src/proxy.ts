import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NdjsonParser } from "./ndjson.js";
import { TraceBuilder } from "./trace.js";
import { renderReport } from "./report.js";

export interface WrapOptions {
  tracePath: string;
  reportPath?: string;
  executable: string;
  args: string[];
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
}

function logErr(msg: string): void {
  process.stderr.write(`[mcptrace] ${msg}\n`);
}

/**
 * Run mcptrace as a stdio proxy in front of a real MCP server.
 *
 * IMPORTANT: stdout is reserved for the MCP protocol. All log output goes to
 * stderr.
 */
export async function runWrap(opts: WrapOptions): Promise<number> {
  const trace = new TraceBuilder({
    executable: opts.executable,
    args: opts.args,
  });

  const child = spawn(opts.executable, opts.args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let exited = false;
  let flushed = false;

  const flush = () => {
    if (flushed) return;
    flushed = true;
    trace.finalize();
    const data = trace.toJSON();
    try {
      ensureDir(opts.tracePath);
      writeFileSync(opts.tracePath, JSON.stringify(data, null, 2), "utf8");
      logErr(`trace written to ${opts.tracePath}`);
    } catch (err) {
      logErr(`failed to write trace: ${(err as Error).message}`);
    }
    if (opts.reportPath) {
      try {
        ensureDir(opts.reportPath);
        writeFileSync(opts.reportPath, renderReport(data), "utf8");
        logErr(`report written to ${opts.reportPath}`);
      } catch (err) {
        logErr(`failed to write report: ${(err as Error).message}`);
      }
    }
  };

  // Parsers for both directions
  const c2s = new NdjsonParser({
    onMessage: (value, raw) => {
      trace.recordMessage("client_to_server", value, raw);
    },
    onError: (err, raw) => {
      trace.recordRaw("client_to_server", raw, err);
      logErr(`protocol_warning: client->server parse error: ${err.message}`);
    },
  });

  const s2c = new NdjsonParser({
    onMessage: (value, raw) => {
      trace.recordMessage("server_to_client", value, raw);
    },
    onError: (err, raw) => {
      trace.recordRaw("server_to_client", raw, err);
      logErr(`protocol_warning: server->client parse error: ${err.message}`);
    },
  });

  // client stdin -> child stdin (and tee to parser)
  process.stdin.on("data", (chunk: Buffer) => {
    if (!child.stdin.destroyed && child.stdin.writable) {
      child.stdin.write(chunk);
    }
    c2s.feed(chunk);
  });
  process.stdin.on("end", () => {
    c2s.flush();
    if (!child.stdin.destroyed) child.stdin.end();
  });
  process.stdin.on("error", (err) => {
    logErr(`stdin error: ${err.message}`);
  });

  // child stdout -> client stdout (and tee to parser)
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    s2c.feed(chunk);
  });
  child.stdout.on("end", () => {
    s2c.flush();
  });

  // child stderr -> our stderr with prefix
  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
    let idx: number;
    while ((idx = stderrBuf.indexOf("\n")) !== -1) {
      const line = stderrBuf.slice(0, idx);
      stderrBuf = stderrBuf.slice(idx + 1);
      process.stderr.write(`[mcptrace:server] ${line}\n`);
    }
  });

  child.on("error", (err) => {
    logErr(`failed to spawn server: ${err.message}`);
    flush();
    process.exit(1);
  });

  const onSignal = (sig: NodeJS.Signals) => {
    if (!child.killed) {
      try {
        child.kill(sig);
      } catch {
        /* ignore */
      }
    }
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGHUP", () => onSignal("SIGHUP"));

  // Best-effort flush on unexpected exits
  process.on("exit", () => flush());
  process.on("uncaughtException", (err) => {
    logErr(`uncaughtException: ${err.message}`);
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    flush();
    process.exit(1);
  });

  return await new Promise<number>((resolveProm) => {
    child.on("exit", (code, signal) => {
      exited = true;
      if (stderrBuf.length > 0) {
        process.stderr.write(`[mcptrace:server] ${stderrBuf}\n`);
        stderrBuf = "";
      }
      flush();
      const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
      resolveProm(exitCode);
    });
  }).finally(() => {
    if (!exited) flush();
  });
}
