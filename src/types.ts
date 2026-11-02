export interface Header {
  name: string;
  value: string;
}
export interface Session {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  exchangeCount: number;
  revision?: number | string;
}
export interface Exchange {
  id: string;
  sessionId: string;
  method: string;
  url: string;
  status: number | null;
  requestHeaders: Header[];
  responseHeaders: Header[];
  requestBody: string;
  responseBody: string;
  requestBodyBase64: boolean;
  responseBodyBase64: boolean;
  startedAt: number;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
  error: string | null;
  edited: boolean;
  originalRequest?: unknown;
  originalResponse?: unknown;
}
export interface ProxyStatus {
  running: boolean;
  port: number;
  sessionId: string | null;
  requestBreakpoint: boolean;
  responseBreakpoint: boolean;
  caCertPath: string;
}
export interface PendingExchange {
  id: string;
  exchangeId: string;
  stage: string;
  method: string;
  url: string;
  status: number | null;
  headers: Header[];
  body: string;
  bodyBase64: boolean;
  createdAt: number;
}
export interface EditMessage {
  action: string;
  method?: string;
  url?: string;
  status?: number;
  headers?: Header[];
  body?: string;
  bodyBase64?: boolean;
}
export interface Device {
  serial: string;
  model: string;
  state: string;
  rooted: boolean;
}
export interface App {
  package: string;
  name: string;
  running: boolean;
}
export interface DeviceStatus {
  running: boolean;
  serial: string | null;
  package: string | null;
  mode: string | null;
  message: string;
  logs: string[];
}
export interface Bootstrap {
  sessions: Session[];
  proxy: ProxyStatus;
  dataDir: string;
  version: string;
  deviceStatus: DeviceStatus;
  mcpPath?: string;
  mcpConfig?: unknown;
  mcpStatus?: McpStatus;
}
export interface Endpoint {
  method?: string;
  path?: string;
  host?: string;
  count?: number;
  errorCount?: number;
  averageDurationMs?: number;
  avgDurationMs?: number;
  totalBytes?: number;
  [key: string]: unknown;
}
export interface Analysis {
  totalRequests?: number;
  totalErrors?: number;
  totalBytes?: number;
  averageDurationMs?: number;
  endpoints?: Endpoint[];
  findings?: Array<{ kind?: string; message: string; exchangeIds?: string[] }>;
  [key: string]: unknown;
}
export interface Comparison {
  added?: Endpoint[];
  removed?: Endpoint[];
  changed?: Endpoint[];
  [key: string]: unknown;
}
export interface McpStatus {
  sessionIds: string[];
  allowWrites: boolean;
  port: number;
}
