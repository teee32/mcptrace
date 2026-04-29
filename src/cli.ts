import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runWrap } from "./proxy.js";
import { renderReport } from "./report.js";
import { diffTraces } from "./diff.js";
import { runReplay, formatReplaySummary } from "./replay.js";
import { TraceFile } from "./types.js";
import { redactTrace } from "./redact.js";

function ensureDir(filePath: string): void {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
}

function splitDoubleDash(argv: string[]): { before: string[]; after: string[] } {
  const idx = argv.indexOf("--");
  if (idx === -1) return { before: argv.slice(), after: [] };
  return { before: argv.slice(0, idx), after: argv.slice(idx + 1) };
}

function failUsage(message: string): never {
  process.stderr.write(`[mcptrace] error: ${message}\n`);
  process.exit(2);
}

const program = new Command();
program
  .name("mcptrace")
  .description(
    "Flight recorder and replay debugger for MCP stdio servers.",
  )
  .version("0.1.0");

// wrap
program
  .command("wrap")
  .description(
    "Run an MCP stdio server through mcptrace, recording all JSON-RPC traffic.",
  )
  .requiredOption("--trace <path>", "path to write the trace JSON file")
  .option("--report <path>", "also write an HTML report to this path")
  .option("--unsafe-raw", "store unredacted payloads and raw JSON-RPC lines")
  .allowUnknownOption(true)
  .helpOption("-h, --help", "show help")
  .action(async () => {
    // commander does not parse args after `--` consistently across versions;
    // do it ourselves so the user-supplied command is preserved verbatim.
    const { before, after } = splitDoubleDash(process.argv.slice(2));
    if (after.length === 0) {
      process.stderr.write(
        "[mcptrace] error: missing real MCP server command after --\n",
      );
      process.exit(2);
    }
    const opts = parseWrapFlags(before.slice(1));
    const [executable, ...rest] = after;
    if (!executable) {
      process.stderr.write("[mcptrace] error: empty server command\n");
      process.exit(2);
    }
    const code = await runWrap({
      tracePath: opts.trace,
      reportPath: opts.report,
      unsafeRaw: opts.unsafeRaw,
      executable,
      args: rest,
    });
    process.exit(code);
  });

function parseWrapFlags(tokens: string[]): {
  trace: string;
  report?: string;
  unsafeRaw?: boolean;
} {
  let trace: string | undefined;
  let report: string | undefined;
  let unsafeRaw = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--trace") {
      trace = readFlagValue(tokens, ++i, "--trace");
    } else if (t.startsWith("--trace=")) {
      trace = readInlineFlagValue(t.slice("--trace=".length), "--trace");
    } else if (t === "--report") {
      report = readFlagValue(tokens, ++i, "--report");
    } else if (t.startsWith("--report=")) {
      report = readInlineFlagValue(t.slice("--report=".length), "--report");
    } else if (t === "--unsafe-raw") {
      unsafeRaw = true;
    } else if (t === "-h" || t === "--help") {
      printWrapHelp();
      process.exit(0);
    } else {
      process.stderr.write(`[mcptrace] error: unknown wrap option: ${t}\n`);
      process.exit(2);
    }
  }
  if (!trace) {
    failUsage("--trace <path> is required");
  }
  return { trace, report, unsafeRaw };
}

function readFlagValue(tokens: string[], index: number, flag: string): string {
  const value = tokens[index];
  if (!value || value.startsWith("--")) {
    failUsage(`${flag} <path> argument missing`);
  }
  return value;
}

function readInlineFlagValue(value: string, flag: string): string {
  if (!value) failUsage(`${flag} <path> argument missing`);
  return value;
}

function printWrapHelp(): void {
  process.stdout.write(
    [
      "Usage: mcptrace wrap --trace <path> [--report <path>] -- <server-cmd> [args...]",
      "",
      "Options:",
      "  --trace <path>    where to write the trace JSON file (required)",
      "  --report <path>   also write a self-contained HTML report",
      "  --unsafe-raw      store unredacted payloads and raw JSON-RPC lines",
      "  -h, --help        show help",
      "",
      "Example:",
      "  mcptrace wrap --trace ./traces/fs.json --report ./traces/fs.html \\",
      "    -- npx -y @modelcontextprotocol/server-filesystem .",
      "",
    ].join("\n"),
  );
}

// report
program
  .command("report <trace>")
  .description("Render an HTML report from an existing trace JSON file.")
  .requiredOption("--out <path>", "where to write the HTML report")
  .option("--unsafe-raw", "render unredacted payloads from the trace file")
  .action((tracePath: string, opts: { out: string; unsafeRaw?: boolean }) => {
    const raw = readFileSync(tracePath, "utf8");
    const data = JSON.parse(raw) as TraceFile;
    const html = renderReport(opts.unsafeRaw ? data : redactTrace(data));
    ensureDir(opts.out);
    writeFileSync(opts.out, html, "utf8");
    process.stderr.write(`[mcptrace] report written to ${opts.out}\n`);
  });

// diff
program
  .command("diff <oldTrace> <newTrace>")
  .description("Diff two trace files and print a markdown summary.")
  .option("--unsafe-raw", "print unredacted parameter values")
  .action((oldPath: string, newPath: string, opts: { unsafeRaw?: boolean }) => {
    const md = diffTraces(oldPath, newPath, { redact: !opts.unsafeRaw });
    process.stdout.write(md);
    if (!md.endsWith("\n")) process.stdout.write("\n");
  });

// replay
program
  .command("replay <trace>")
  .description(
    "Replay client_to_server messages from a trace against a real MCP server.",
  )
  .option("--quiet-ms <n>", "ms to wait for late responses", "1500")
  .action(async (tracePath: string, opts: { quietMs: string }) => {
    const { after } = splitDoubleDash(process.argv.slice(2));
    if (after.length === 0) {
      process.stderr.write(
        "[mcptrace] error: missing server command after --\n",
      );
      process.exit(2);
    }
    const [executable, ...rest] = after;
    if (!executable) {
      process.stderr.write("[mcptrace] error: empty server command\n");
      process.exit(2);
    }
    const summary = await runReplay({
      tracePath,
      executable,
      args: rest,
      quietMs: Number(opts.quietMs) || 1500,
    });
    process.stdout.write(formatReplaySummary(summary));
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`[mcptrace] error: ${(err as Error).message}\n`);
  process.exit(1);
});
