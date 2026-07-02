import { Logger } from '@nestjs/common';
import { $t } from '@project-sunbird/telemetry-sdk';
import { TelemetryWrap, type ApiLifecycleEvent } from 'telemetry-wrap';
import { isTelemetryReady } from './telemetry.bootstrap';
import { generateTelemetryMid } from './telemetry.config';

export type TelemetryApiCallType = 'bpp_network_api_call' | 'ext_api_call';

const telemetryDebugLogger = new Logger('TelemetryDebug');

function isTelemetryDebugEnabled(): boolean {
  return process.env.TELEMETRY_DEBUG === 'true';
}

function buildApiCallParams(event: ApiLifecycleEvent) {
  return [
    { requestTime: event.requestTime },
    { url: event.url },
    { method: event.method },
    { requestPayload: event.requestPayload },
    { sessionId: event.sessionId },
    { questionId: event.questionId },
    { responseStatus: event.responseStatus },
    { responseBody: event.responseBody },
    { isEmptyResponse: event.isEmptyResponse },
    { latencyMs: event.latencyMs },
    { error: event.error ?? null },
    { context: event.context },
  ];
}

export function logTelemetryApiCall(
  event: ApiLifecycleEvent,
  type: TelemetryApiCallType,
): void {
  if (!isTelemetryReady()) {
    if (isTelemetryDebugEnabled()) {
      telemetryDebugLogger.warn(
        `Skipped ${type} for ${event.method} ${event.url} — telemetry not initialised`,
      );
    }
    return;
  }

  try {
    if (isTelemetryDebugEnabled()) {
      telemetryDebugLogger.log(
        `Captured ${type}: ${event.method} ${event.url} [${event.responseStatus}] ${event.latencyMs}ms`,
      );
    }

    $t.log(
      {
        type,
        level: 'TRACE',
        message: `${event.method} ${event.url}`,
        params: buildApiCallParams(event),
      },
      { id: generateTelemetryMid(), type: 'Event' },
    );

    if (event.isEmptyResponse) {
      TelemetryWrap.logEmptyResponse(event);
    }
    if (event.error || event.responseStatus >= 400) {
      TelemetryWrap.logError(event);
    }
  } catch {
    // Telemetry must never break the request flow
  }
}