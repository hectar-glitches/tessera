// Structured logger — always include traceId and userId for Datadog correlation.
// Filter in Datadog: env:production service:api  or  env:production service:web

type Level = "debug" | "info" | "warn" | "error";

interface LogFields {
  traceId?: string;
  userId?: string;
  teamId?: string;
  [key: string]: unknown;
}

function write(level: Level, event: string, fields: LogFields = {}) {
  const entry = {
    level,
    event,
    env: process.env.NODE_ENV ?? "development",
    ts: new Date().toISOString(),
    ...fields,
  };
  // In production, logs ship to Datadog via the ECS log driver.
  // Locally they go to stdout as JSON lines.
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
