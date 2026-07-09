import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { isEmptyBody } from 'telemetry-wrap';
import { getTelemetryContext } from './telemetry.context';
import { getTelemetryEndpoint } from './telemetry.config';
import { emitOeItemResponse } from './oe-telemetry.emitter';
import {
  buildActualExtApiRequestPayload,
  captureResponsePayload,
  isApiSuccess,
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
  // Prefer explicit service name from URL host mapping (for apiService field)
  const downstreamService = resolveExternalServiceName(url);

  // Actual payload sent to the external API (body and/or query params) —
  // NOT a Beckn envelope. Meta (method/url/service) already lives on networkApiDetails.
  const actualRequestPayload = buildActualExtApiRequestPayload({
    data: config.data,
    params: config.params,
  });

  const responseBody = captureResponsePayload(data);
  // Empty payload on HTTP 200 is captured as 404 (not found / no data)
  const isEmpty = status === 200 && isEmptyBody(data);
  const effectiveStatus = isEmpty ? 404 : status;
  const success = isApiSuccess(effectiveStatus, data, error);

  try {
    emitOeItemResponse(ctx, {
      itemType: 'ext_api_call',
      serviceName: useCaseName,
      apiService: downstreamService,
      method,
      url,
      // Real external API request body/query params only
      requestPayload: sanitisePayload(actualRequestPayload),
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