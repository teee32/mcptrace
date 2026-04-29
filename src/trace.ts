import {
  Direction,
  MessageKind,
  TRACE_VERSION,
  TraceCall,
  TraceCommand,
  TraceEvent,
  TraceFile,
} from "./types.js";
import { detectRisks, mergeRiskFlags } from "./risk.js";

interface JsonRpcLike {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

function classify(msg: JsonRpcLike): MessageKind {
  const hasId = msg.id !== undefined && msg.id !== null;
  const hasMethod = typeof msg.method === "string";
  const hasResult = Object.prototype.hasOwnProperty.call(msg, "result");
  const hasError = Object.prototype.hasOwnProperty.call(msg, "error");

  if (hasMethod && hasId) return "request";
  if (hasMethod && !hasId) return "notification";
  if (hasId && (hasResult || hasError)) return "response";
  return "unknown";
}

export class TraceBuilder {
  private events: TraceEvent[] = [];
  private callsById = new Map<string, TraceCall>();
  private seq = 0;
  private startedAtMs = Date.now();
  private endedAtMs?: number;
  private startedAt = new Date().toISOString();

  constructor(private readonly command: TraceCommand) {}

  static keyForId(id: string | number | null | undefined): string {
    if (id === null || id === undefined) return "__null__";
    return `${typeof id}:${id}`;
  }

  recordRaw(direction: Direction, raw: string, parseError?: Error): TraceEvent {
    const event: TraceEvent = {
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      direction,
      kind: "parse_error",
      raw,
      riskFlags: [],
    };
    if (parseError) event.error = { message: parseError.message };
    this.events.push(event);
    return event;
  }

  recordMessage(direction: Direction, value: unknown, raw?: string): TraceEvent {
    const obj: JsonRpcLike =
      value && typeof value === "object" ? (value as JsonRpcLike) : {};
    const kind = classify(obj);

    const riskFlags = mergeRiskFlags(
      detectRisks(obj.params),
      detectRisks(obj.result),
      detectRisks(obj.error),
    );

    const event: TraceEvent = {
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      direction,
      jsonrpc: obj.jsonrpc,
      id: (obj.id ?? null) as TraceEvent["id"],
      kind,
      method: obj.method,
      params: obj.params,
      result: obj.result,
      error: obj.error,
      raw,
      riskFlags,
    };
    this.events.push(event);

    // Tools-call call tracking
    if (kind === "request" && obj.method === "tools/call" && obj.id != null) {
      const key = TraceBuilder.keyForId(obj.id);
      const params = obj.params as Record<string, unknown> | undefined;
      const toolName =
        params && typeof params === "object" && "name" in params
          ? String((params as { name?: unknown }).name)
          : undefined;
      this.callsById.set(key, {
        id: obj.id,
        method: "tools/call",
        toolName,
        startedAt: event.timestamp,
        params: obj.params,
        riskFlags: [...riskFlags],
      });
    } else if (kind === "request" && typeof obj.method === "string" && obj.id != null) {
      // Track all requests as calls so the report can show them; method-specific
      // logic still keys off `method`.
      const key = TraceBuilder.keyForId(obj.id);
      if (!this.callsById.has(key)) {
        this.callsById.set(key, {
          id: obj.id,
          method: obj.method,
          startedAt: event.timestamp,
          params: obj.params,
          riskFlags: [...riskFlags],
        });
      }
    } else if (kind === "response" && obj.id != null) {
      const key = TraceBuilder.keyForId(obj.id);
      const call = this.callsById.get(key);
      if (call) {
        call.endedAt = event.timestamp;
        call.durationMs = Math.max(
          0,
          Date.parse(call.endedAt) - Date.parse(call.startedAt),
        );
        call.result = obj.result;
        call.error = obj.error;
        call.riskFlags = mergeRiskFlags(call.riskFlags, riskFlags);
      }
    }

    return event;
  }

  finalize(): void {
    if (this.endedAtMs === undefined) this.endedAtMs = Date.now();
  }

  toJSON(): TraceFile {
    if (this.endedAtMs === undefined) this.endedAtMs = Date.now();
    const endedAt = new Date(this.endedAtMs).toISOString();

    const events = this.events;
    const calls = Array.from(this.callsById.values()).sort((a, b) => {
      return Date.parse(a.startedAt) - Date.parse(b.startedAt);
    });

    let requestCount = 0;
    let responseCount = 0;
    let notificationCount = 0;
    let failedCount = 0;
    const riskySeq = new Set<number>();

    for (const e of events) {
      if (e.kind === "request") requestCount++;
      else if (e.kind === "response") responseCount++;
      else if (e.kind === "notification") notificationCount++;
      if (e.error) failedCount++;
      if (e.riskFlags.length > 0) riskySeq.add(e.seq);
    }

    const toolCallCount = calls.filter((c) => c.method === "tools/call").length;

    return {
      version: TRACE_VERSION,
      startedAt: this.startedAt,
      endedAt,
      command: this.command,
      summary: {
        messageCount: events.length,
        requestCount,
        responseCount,
        notificationCount,
        toolCallCount,
        failedCount,
        riskCount: riskySeq.size,
        durationMs: Math.max(0, this.endedAtMs - this.startedAtMs),
      },
      events,
      calls,
    };
  }
}
