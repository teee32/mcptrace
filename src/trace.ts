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
import { redactRiskFlag, redactText, redactValue } from "./redact.js";

interface JsonRpcLike {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface TraceBuilderOptions {
  redact?: boolean;
}

function classify(msg: JsonRpcLike): MessageKind {
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
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

  constructor(
    private readonly command: TraceCommand,
    private readonly options: TraceBuilderOptions = {},
  ) {}

  static keyForId(id: string | number | null | undefined): string {
    if (id === null || id === undefined) return "__null__";
    return `${typeof id}:${id}`;
  }

  private static keyForCall(direction: Direction, id: string | number): string {
    return `${direction}:${TraceBuilder.keyForId(id)}`;
  }

  private static requestDirectionForResponse(direction: Direction): Direction {
    return direction === "client_to_server" ? "server_to_client" : "client_to_server";
  }

  private get shouldRedact(): boolean {
    return this.options.redact ?? true;
  }

  private storeValue(value: unknown): unknown {
    return this.shouldRedact ? redactValue(value) : value;
  }

  private storeRaw(raw: string | undefined): string | undefined {
    return this.shouldRedact ? undefined : raw;
  }

  private storeRiskFlags(riskFlags: ReturnType<typeof detectRisks>): ReturnType<typeof detectRisks> {
    return this.shouldRedact ? riskFlags.map(redactRiskFlag) : riskFlags;
  }

  private storedCommand(): TraceCommand {
    if (!this.shouldRedact) return this.command;
    return {
      executable: this.command.executable,
      args: this.command.args.map(redactText),
    };
  }

  recordRaw(direction: Direction, raw: string, parseError?: Error): TraceEvent {
    const event: TraceEvent = {
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      direction,
      kind: "parse_error",
      raw: this.storeRaw(raw),
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
    const storedRiskFlags = this.storeRiskFlags(riskFlags);
    const params = this.storeValue(obj.params);
    const result = this.storeValue(obj.result);
    const error = this.storeValue(obj.error);

    const event: TraceEvent = {
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      direction,
      jsonrpc: obj.jsonrpc,
      id: (obj.id ?? null) as TraceEvent["id"],
      kind,
      method: obj.method,
      params,
      result,
      error,
      raw: this.storeRaw(raw),
      riskFlags: storedRiskFlags,
    };
    this.events.push(event);

    // Tools-call call tracking
    if (kind === "request" && obj.method === "tools/call" && obj.id != null) {
      const key = TraceBuilder.keyForCall(direction, obj.id);
      const requestParams = obj.params as Record<string, unknown> | undefined;
      const toolName =
        requestParams && typeof requestParams === "object" && "name" in requestParams
          ? String((requestParams as { name?: unknown }).name)
          : undefined;
      this.callsById.set(key, {
        id: obj.id,
        method: "tools/call",
        toolName,
        startedAt: event.timestamp,
        params,
        riskFlags: [...storedRiskFlags],
      });
    } else if (kind === "request" && typeof obj.method === "string" && obj.id != null) {
      // Track all requests as calls so the report can show them; method-specific
      // logic still keys off `method`.
      const key = TraceBuilder.keyForCall(direction, obj.id);
      if (!this.callsById.has(key)) {
        this.callsById.set(key, {
          id: obj.id,
          method: obj.method,
          startedAt: event.timestamp,
          params,
          riskFlags: [...storedRiskFlags],
        });
      }
    } else if (kind === "response" && obj.id != null) {
      const requestDirection = TraceBuilder.requestDirectionForResponse(direction);
      const key = TraceBuilder.keyForCall(requestDirection, obj.id);
      const call = this.callsById.get(key);
      if (call) {
        call.endedAt = event.timestamp;
        call.durationMs = Math.max(
          0,
          Date.parse(call.endedAt) - Date.parse(call.startedAt),
        );
        call.result = result;
        call.error = error;
        call.riskFlags = mergeRiskFlags(call.riskFlags, storedRiskFlags);
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
      command: this.storedCommand(),
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
