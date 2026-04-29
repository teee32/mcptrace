import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TraceCall, TraceFile } from "./types.js";

function loadTrace(path: string): TraceFile {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as TraceFile;
  if (!parsed || !Array.isArray(parsed.events) || !Array.isArray(parsed.calls)) {
    throw new Error(`File does not look like an mcptrace trace: ${path}`);
  }
  return parsed;
}

function paramsHash(value: unknown): string {
  let s: string;
  try {
    s = stableStringify(value ?? null);
  } catch {
    s = String(value);
  }
  return createHash("sha1").update(s).digest("hex").slice(0, 10);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

interface KeyedCall {
  call: TraceCall;
  /** group key: method+toolName, used to find counterpart */
  groupKey: string;
  /** identity key: groupKey + paramsHash, used to detect "same" call */
  identityKey: string;
}

function indexCalls(trace: TraceFile): {
  byIdentity: Map<string, KeyedCall[]>;
  byGroup: Map<string, KeyedCall[]>;
  all: KeyedCall[];
} {
  const byIdentity = new Map<string, KeyedCall[]>();
  const byGroup = new Map<string, KeyedCall[]>();
  const all: KeyedCall[] = [];

  for (const c of trace.calls) {
    const groupKey = `${c.method}::${c.toolName ?? ""}`;
    const identityKey = `${groupKey}::${paramsHash(c.params)}`;
    const keyed: KeyedCall = { call: c, groupKey, identityKey };
    all.push(keyed);

    if (!byIdentity.has(identityKey)) byIdentity.set(identityKey, []);
    byIdentity.get(identityKey)!.push(keyed);

    if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
    byGroup.get(groupKey)!.push(keyed);
  }

  return { byIdentity, byGroup, all };
}

function describeCall(c: TraceCall): string {
  const parts = [`${c.method}`];
  if (c.toolName) parts.push(`(${c.toolName})`);
  if (c.params !== undefined) {
    let p: string;
    try {
      p = JSON.stringify(c.params);
    } catch {
      p = String(c.params);
    }
    if (p.length > 80) p = p.slice(0, 77) + "...";
    parts.push(`params=${p}`);
  }
  return parts.join(" ");
}

function riskKey(code: string, message: string): string {
  return `${code}::${message}`;
}

export function diffTraces(oldPath: string, newPath: string): string {
  const oldTrace = loadTrace(oldPath);
  const newTrace = loadTrace(newPath);

  const oldIdx = indexCalls(oldTrace);
  const newIdx = indexCalls(newTrace);

  const lines: string[] = [];
  lines.push(`# MCPTrace diff`);
  lines.push("");
  lines.push(`- old: \`${oldPath}\``);
  lines.push(`- new: \`${newPath}\``);
  lines.push("");

  // Failed counts
  const oldFailed = oldTrace.summary.failedCount;
  const newFailed = newTrace.summary.failedCount;
  if (oldFailed !== newFailed) {
    const arrow = newFailed > oldFailed ? "↑" : "↓";
    lines.push(`## Failure count ${arrow}`);
    lines.push("");
    lines.push(`- old failed: **${oldFailed}**`);
    lines.push(`- new failed: **${newFailed}**`);
    lines.push("");
  }

  // Calls: added / removed / changed
  const oldIdentitySeen = new Map<string, number>();
  for (const [k, list] of oldIdx.byIdentity) oldIdentitySeen.set(k, list.length);

  const added: KeyedCall[] = [];
  const removed: KeyedCall[] = [];
  const changedParams: Array<{ from: KeyedCall; to: KeyedCall }> = [];

  // First pass: walk new calls, decrement matched old identities
  const newCallsRemaining: KeyedCall[] = [];
  for (const k of newIdx.all) {
    const remaining = oldIdentitySeen.get(k.identityKey) ?? 0;
    if (remaining > 0) {
      oldIdentitySeen.set(k.identityKey, remaining - 1);
    } else {
      newCallsRemaining.push(k);
    }
  }
  // Anything left in oldIdentitySeen with count > 0 is a removal candidate
  const oldCallsRemaining: KeyedCall[] = [];
  for (const k of oldIdx.all) {
    const remaining = oldIdentitySeen.get(k.identityKey) ?? 0;
    if (remaining > 0) {
      oldCallsRemaining.push(k);
      oldIdentitySeen.set(k.identityKey, remaining - 1);
    }
  }

  // Second pass: try to pair remaining old/new by groupKey -> "params changed"
  const oldByGroupRemaining = new Map<string, KeyedCall[]>();
  for (const k of oldCallsRemaining) {
    if (!oldByGroupRemaining.has(k.groupKey)) oldByGroupRemaining.set(k.groupKey, []);
    oldByGroupRemaining.get(k.groupKey)!.push(k);
  }
  for (const k of newCallsRemaining) {
    const list = oldByGroupRemaining.get(k.groupKey);
    if (list && list.length > 0) {
      const partner = list.shift()!;
      changedParams.push({ from: partner, to: k });
    } else {
      added.push(k);
    }
  }
  for (const list of oldByGroupRemaining.values()) {
    for (const k of list) removed.push(k);
  }

  if (added.length || removed.length || changedParams.length) {
    lines.push(`## Tool calls`);
    lines.push("");
    lines.push(`- added: **${added.length}**`);
    lines.push(`- removed: **${removed.length}**`);
    lines.push(`- params changed: **${changedParams.length}**`);
    lines.push("");

    if (added.length) {
      lines.push(`### + Added`);
      lines.push("");
      for (const k of added) lines.push(`- ${describeCall(k.call)}`);
      lines.push("");
    }
    if (removed.length) {
      lines.push(`### - Removed`);
      lines.push("");
      for (const k of removed) lines.push(`- ${describeCall(k.call)}`);
      lines.push("");
    }
    if (changedParams.length) {
      lines.push(`### ~ Params changed`);
      lines.push("");
      for (const { from, to } of changedParams) {
        lines.push(`- \`${from.call.method}${from.call.toolName ? `(${from.call.toolName})` : ""}\``);
        lines.push(`  - old params: \`${JSON.stringify(from.call.params)}\``);
        lines.push(`  - new params: \`${JSON.stringify(to.call.params)}\``);
      }
      lines.push("");
    }
  } else {
    lines.push(`## Tool calls`);
    lines.push("");
    lines.push(`No call-level changes detected.`);
    lines.push("");
  }

  // Risks
  const oldRisks = new Map<string, number>();
  const newRisks = new Map<string, number>();
  for (const c of oldTrace.calls)
    for (const r of c.riskFlags) {
      const k = riskKey(r.code, r.message);
      oldRisks.set(k, (oldRisks.get(k) ?? 0) + 1);
    }
  for (const c of newTrace.calls)
    for (const r of c.riskFlags) {
      const k = riskKey(r.code, r.message);
      newRisks.set(k, (newRisks.get(k) ?? 0) + 1);
    }

  const addedRisks: string[] = [];
  const removedRisks: string[] = [];
  for (const [k, n] of newRisks) if (!oldRisks.has(k)) addedRisks.push(`${k} (×${n})`);
  for (const [k, n] of oldRisks) if (!newRisks.has(k)) removedRisks.push(`${k} (×${n})`);

  if (addedRisks.length || removedRisks.length) {
    lines.push(`## Risks`);
    lines.push("");
    if (addedRisks.length) {
      lines.push(`### + New risks`);
      lines.push("");
      for (const r of addedRisks) lines.push(`- ${r}`);
      lines.push("");
    }
    if (removedRisks.length) {
      lines.push(`### - Resolved risks`);
      lines.push("");
      for (const r of removedRisks) lines.push(`- ${r}`);
      lines.push("");
    }
  }

  // Summary numbers
  lines.push(`## Summary`);
  lines.push("");
  const fields: Array<keyof TraceFile["summary"]> = [
    "messageCount",
    "requestCount",
    "responseCount",
    "notificationCount",
    "toolCallCount",
    "failedCount",
    "riskCount",
    "durationMs",
  ];
  lines.push(`| metric | old | new |`);
  lines.push(`| --- | --- | --- |`);
  for (const f of fields) {
    lines.push(`| ${f} | ${oldTrace.summary[f]} | ${newTrace.summary[f]} |`);
  }
  lines.push("");

  return lines.join("\n");
}
