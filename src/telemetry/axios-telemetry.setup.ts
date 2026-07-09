import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { isEmptyBody } from 'telemetry-wrap';
import { getTelemetryContext } from './telemetry.context';
import { getTelemetryEndpoint } from './telemetry.config';
import { emitOeItemResponse } from './oe-telemetry.emitter';
import {
  buildExtApiEnvelope,
  captureResponsePayload,
  extractGraphqlFromAxiosData,
  isApiSuccess,
  parseAxiosRequestData,
} from './telemetry-payload.builder';
import { resolveExternalServiceName } from './service-name.resolver';
import { sanitisePayload } from './telemetry-sanitiser';

type TimedAxiosConfig = InternalAxiosRequestConfig & {
  __telemetryStart?: number;
};

let axiosTelemetryInstalled = false;

function shouldSkipTelemetry(url?: string): boolean {
  if (!url) return false;
  const telemetryEndpoint = getTelemetryEndpoint();
  return url.includes(telemetryEndpoint) || url.includes('/data/v3/telemetry');
}

function logOutboundCall(
  config: TimedAxiosConfig | undefined,
  status: number,
  data: unknown,
  error?: string,
): void {
  if (!config || shouldSkipTelemetry(config.url)) return;

  const start = config.__telemetryStart ?? Date.now();
  const latencyMs = Date.now() - start;
  const ctx = getTelemetryContext();
  const url = config.url ?? 'unknown';
  const method = (config.method ?? 'GET').toUpperCase();
  const useCaseName = ctx.context.service_name ?? 'unknown';
  const downstreamService = resolveExternalServiceName(url);
  const rawRequest = parseAxiosRequestData(config.data ?? config.params);
  const requestBody = sanitisePayload(rawRequest);
  const graphql = extractGraphqlFromAxiosData(rawRequest);
  const responseBody = captureResponsePayload(data);
  // Empty payload on HTTP 200 is captured as 404 (not found / no data)
  const isEmpty = status === 200 && isEmptyBody(data);
  const effectiveStatus = isEmpty ? 404 : status;
  const success = isApiSuccess(effectiveStatus, data, error);

  try {
    emitOeItemResponse(ctx, {
      itemType: 'ext_api_call',
      serviceName: useCaseName,
      method,
      url,
      requestPayload: buildExtApiEnvelope(ctx, {
        url,
        method,
        downstreamService,
        requestBody,
        graphql,
      }),
      responsePayload: isEmpty
        ? { _empty: true }
        : sanitisePayload(responseBody),
      statusCode: effectiveStatus,
      latencyMs,
      success,
      error,
    });
  } catch {
    // Telemetry must never break outbound calls
  }
}

export function setupAxiosTelemetry(): void {
  if (axiosTelemetryInstalled) return;
  axiosTelemetryInstalled = true;

  axios.interceptors.request.use((config: TimedAxiosConfig) => {
    config.__telemetryStart = Date.now();
    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      logOutboundCall(
        response.config as TimedAxiosConfig,
        response.status,
        response.data,
      );
      return response;
    },
    (error: AxiosError) => {
      logOutboundCall(
        error.config as TimedAxiosConfig | undefined,
        error.response?.status ?? 0,
        error.response?.data,
        error.message,
      );
      return Promise.reject(error);
    },
  );
}