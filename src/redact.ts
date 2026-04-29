import { RiskFlag, TraceFile } from "./types.js";

export const REDACTED = "[REDACTED]";
const REDACTED_RAW = "[raw line omitted by redaction]";

const SECRET_KEY_PATTERN =
  /authorization|cookie|token|api[_-]?key|password|passwd|secret|private[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret|session/i;

const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`],
  [/\b(sk-[A-Za-z0-9_-]{12,})\b/g, REDACTED],
  [
    /([?&](?:authorization|token|api[_-]?key|password|secret|client[_-]?secret)=)[^&\s"']+/gi,
    `$1${REDACTED}`,
  ],
  [
    /((?:authorization|token|api[_-]?key|password|secret|client[_-]?secret)\s*[:=]\s*)[^\s"',}&]+/gi,
    `$1${REDACTED}`,
  ],
];

export function redactValue(value: unknown): unknown {
  return redactByKey("", value, new WeakSet<object>());
}

export function redactTrace(trace: TraceFile): TraceFile {
  return {
    ...trace,
    command: {
      executable: trace.command.executable,
      args: trace.command.args.map(redactText),
    },
    events: trace.events.map((event) => ({
      ...event,
      params: redactValue(event.params),
      result: redactValue(event.result),
      error: redactValue(event.error),
      raw: event.raw ? REDACTED_RAW : undefined,
      riskFlags: event.riskFlags.map(redactRiskFlag),
    })),
    calls: trace.calls.map((call) => ({
      ...call,
      params: redactValue(call.params),
      result: redactValue(call.result),
      error: redactValue(call.error),
      riskFlags: call.riskFlags.map(redactRiskFlag),
    })),
  };
}

export function redactText(value: string): string {
  return redactSecretStrings(value);
}

export function redactRiskFlag(flag: RiskFlag): RiskFlag {
  const redacted: RiskFlag = {
    ...flag,
    message: redactText(flag.message),
  };
  if (flag.location) redacted.location = redactText(flag.location);
  return redacted;
}

function redactByKey(key: string, value: unknown, seen: WeakSet<object>): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) return REDACTED;
  if (typeof value === "string") return redactSecretStrings(value);
  if (Array.isArray(value)) return value.map((item) => redactByKey("", item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactByKey(childKey, childValue, seen);
    }
    seen.delete(value);
    return out;
  }
  return value;
}

function redactSecretStrings(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
