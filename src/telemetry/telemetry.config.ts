import { randomUUID } from 'crypto';

export function generateTelemetryMid(): string {
  return randomUUID();
}

export function getTelemetryEndpoint(): string {
  if (process.env.TELEMETRY_ENDPOINT) {
    return process.env.TELEMETRY_ENDPOINT;
  }

  const host = (
    process.env.TELEMETRY_HOST ||
    'https://chat-vistaar.da.gov.in/observability-service'
  ).replace(
    /\/$/,
    '',
  );
  const apiSlug = process.env.TELEMETRY_API_SLUG || '/action';
  const path = process.env.TELEMETRY_PATH || '/data/v3/telemetry';

  return `${host}${apiSlug}${path}`;
}

export function isTelemetryEnabled(): boolean {
  return process.env.TELEMETRY_ENABLED !== 'false';
}

const DEFAULT_RESPONSE_MAX_BYTES = 200 * 1024;

export function getTelemetryResponseMaxBytes(): number {
  const configured = parseInt(
    process.env.TELEMETRY_RESPONSE_MAX_BYTES ||
      String(DEFAULT_RESPONSE_MAX_BYTES),
    10,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RESPONSE_MAX_BYTES;
}