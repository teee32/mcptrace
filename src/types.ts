export const TRACE_VERSION = "0.1.0";

export type Direction = "client_to_server" | "server_to_client";

export type MessageKind =
  | "request"
  | "response"
  | "notification"
  | "parse_error"
  | "unknown";

export type RiskSeverity = "low" | "medium" | "high";

export interface RiskFlag {
  code: string;
  message: string;
  severity: RiskSeverity;
  /** Where the risk was detected: which JSON path / field. Optional. */
  location?: string;
}

export interface TraceEvent {
  seq: number;
  timestamp: string;
  direction: Direction;
  jsonrpc?: string;
  id?: string | number | null;
  kind: MessageKind;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  /** Original raw line, kept when message could not be parsed. */
  raw?: string;
  riskFlags: RiskFlag[];
}

export interface TraceCall {
  id: string | number;
  method: string;
  toolName?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  riskFlags: RiskFlag[];
}

export interface TraceCommand {
  executable: string;
  args: string[];
}

export interface TraceSummary {
  messageCount: number;
  requestCount: number;
  responseCount: number;
  notificationCount: number;
  toolCallCount: number;
  failedCount: number;
  riskCount: number;
  durationMs: number;
}

export interface TraceFile {
  version: string;
  startedAt: string;
  endedAt: string;
  command: TraceCommand;
  summary: TraceSummary;
  events: TraceEvent[];
  calls: TraceCall[];
}
