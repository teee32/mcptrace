import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const paths = [
  "/tmp/mcptrace-smoke-a.json",
  "/tmp/mcptrace-smoke-b.json",
  "/tmp/mcptrace-smoke-raw.json",
  "/tmp/mcptrace-smoke-a.html",
  "/tmp/mcptrace-smoke-report.html",
];

for (const path of paths) {
  try {
    rmSync(path);
  } catch {
    // Ignore absent smoke artifacts.
  }
}

function run(command, args, input = "") {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function asNdjson(messages) {
  return `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
}

const server = [
  "--experimental-strip-types",
  "tests/fixtures/fake-mcp-server.ts",
];
const secret = "sk-test1234567890";
const inputA = asNdjson([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "echo", arguments: { apiKey: secret, text: "hi" } },
  },
]);
const inputB = asNdjson([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "echo", arguments: { apiKey: secret, text: "bye" } },
  },
]);

const wrapA = await run(
  "node",
  [
    "dist/cli.js",
    "wrap",
    "--trace",
    "/tmp/mcptrace-smoke-a.json",
    "--report",
    "/tmp/mcptrace-smoke-a.html",
    "--",
    "node",
    ...server,
  ],
  inputA,
);
const wrapB = await run(
  "node",
  [
    "dist/cli.js",
    "wrap",
    "--trace",
    "/tmp/mcptrace-smoke-b.json",
    "--",
    "node",
    ...server,
  ],
  inputB,
);
const wrapRaw = await run(
  "node",
  [
    "dist/cli.js",
    "wrap",
    "--trace",
    "/tmp/mcptrace-smoke-raw.json",
    "--unsafe-raw",
    "--",
    "node",
    ...server,
  ],
  inputA,
);

const traceText = readFileSync("/tmp/mcptrace-smoke-a.json", "utf8");
const rawText = readFileSync("/tmp/mcptrace-smoke-raw.json", "utf8");
const trace = JSON.parse(traceText);
const rawTrace = JSON.parse(rawText);
const reportOk =
  existsSync("/tmp/mcptrace-smoke-a.html") &&
  readFileSync("/tmp/mcptrace-smoke-a.html", "utf8").includes(
    "MCPTrace Report",
  );

const report = await run("node", [
  "dist/cli.js",
  "report",
  "/tmp/mcptrace-smoke-raw.json",
  "--out",
  "/tmp/mcptrace-smoke-report.html",
]);
const renderedReport = readFileSync("/tmp/mcptrace-smoke-report.html", "utf8");
const diff = await run("node", [
  "dist/cli.js",
  "diff",
  "/tmp/mcptrace-smoke-a.json",
  "/tmp/mcptrace-smoke-b.json",
]);
const replay = await run("node", [
  "dist/cli.js",
  "replay",
  "/tmp/mcptrace-smoke-a.json",
  "--",
  "node",
  ...server,
]);
const missingReport = await run("node", [
  "dist/cli.js",
  "wrap",
  "--trace",
  "/tmp/missing.json",
  "--report",
  "--",
  "node",
  "-e",
  "",
]);
const emptyReport = await run("node", [
  "dist/cli.js",
  "wrap",
  "--trace",
  "/tmp/missing.json",
  "--report=",
  "--",
  "node",
  "-e",
  "",
]);

const result = {
  wrapA: {
    code: wrapA.code,
    stdoutLines: wrapA.stdout.trim().split("\n").filter(Boolean).length,
    stderrHasTrace: wrapA.stderr.includes("trace written"),
  },
  wrapB: { code: wrapB.code },
  wrapRaw: { code: wrapRaw.code },
  defaultRedaction: {
    secretAbsent: !traceText.includes(secret),
    rawOmitted: !trace.events.some((event) => typeof event.raw === "string"),
  },
  unsafeRaw: {
    secretPresent: rawText.includes(secret),
    rawPresent: rawTrace.events.some((event) => typeof event.raw === "string"),
  },
  reportOk,
  reportCommand: {
    code: report.code,
    exists: existsSync("/tmp/mcptrace-smoke-report.html"),
    redacted: !renderedReport.includes(secret),
  },
  diff: {
    code: diff.code,
    hasParamsChanged: diff.stdout.includes("params changed: **1**"),
    redacted: !diff.stdout.includes(secret),
  },
  replay: {
    code: replay.code,
    hasSummary: replay.stdout.includes("MCPTrace replay summary"),
  },
  missingReport: {
    code: missingReport.code,
    messageOk: missingReport.stderr.includes("--report <path> argument missing"),
  },
  emptyReport: {
    code: emptyReport.code,
    messageOk: emptyReport.stderr.includes("--report <path> argument missing"),
  },
};

console.log(JSON.stringify(result, null, 2));

if (
  wrapA.code ||
  wrapB.code ||
  wrapRaw.code ||
  !result.defaultRedaction.secretAbsent ||
  !result.defaultRedaction.rawOmitted ||
  !result.unsafeRaw.secretPresent ||
  !result.unsafeRaw.rawPresent ||
  !reportOk ||
  report.code ||
  !result.reportCommand.redacted ||
  diff.code ||
  !result.diff.hasParamsChanged ||
  !result.diff.redacted ||
  replay.code ||
  missingReport.code !== 2 ||
  !result.missingReport.messageOk ||
  emptyReport.code !== 2 ||
  !result.emptyReport.messageOk
) {
  process.exit(1);
}
