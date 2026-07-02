import { randomUUID } from 'crypto';
import type { TelemetryContext } from './telemetry.context';

export const BHARAT_VISTAAR_CHANNEL = 'BharatVistaar';
export const BECKN_NETWORK_CHANNEL = 'beckn-network-provider';

export function generateTelemetryMid(): string {
  return randomUUID();
}

export function resolveTelemetryChannel(ctx: TelemetryContext): string {
  if (!ctx.hasExplicitCorrelation) {
    return BHARAT_VISTAAR_CHANNEL;
  }
  if (ctx.payloadChannel) {
    return ctx.payloadChannel;
  }
  return process.env.TELEMETRY_CHANNEL || BECKN_NETWORK_CHANNEL;
}

export function resolveTelemetryPdata(
  ctx: TelemetryContext,
): Record<string, string | null> {
  const channel = resolveTelemetryChannel(ctx);

  if (channel === BHARAT_VISTAAR_CHANNEL) {
    return { id: BHARAT_VISTAAR_CHANNEL, ver: 'v0.1', pid: null };
  }

  if (ctx.hasExplicitCorrelation && ctx.payloadChannel) {
    return { id: ctx.payloadChannel, ver: 'v0.1', pid: null };
  }

  return {
    id: process.env.TELEMETRY_PDATA_ID || 'beckn-onix-network-provider',
    ver: process.env.TELEMETRY_PDATA_VER || 'v1.0',
    pid: process.env.TELEMETRY_PDATA_PID || 'network-provider',
  };
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