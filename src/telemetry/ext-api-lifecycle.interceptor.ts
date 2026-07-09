import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { isEmptyBody } from 'telemetry-wrap';
import { getTelemetryContext } from './telemetry.context';
import { logTelemetryApiCall } from './telemetry.logger';
import { sanitisePayload } from './telemetry-sanitiser';

@Injectable()
export class ExtApiLifecycleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requestTime = Date.now();
    const ctx = getTelemetryContext();

    return next.handle().pipe(
      tap((response) => {
        const latencyMs = Date.now() - requestTime;
        // Empty payload on HTTP 200 is captured as 404 (not found / no data)
        const isEmptyResponse =
          response?.status === 200 && isEmptyBody(response?.data);
        const responseStatus = isEmptyResponse
          ? 404
          : (response?.status ?? 0);
        const responseBody = isEmptyResponse
          ? { _empty: true }
          : sanitisePayload(response?.data);

        logTelemetryApiCall(
          {
            requestTime: new Date(requestTime).toISOString(),
            url: response?.config?.url ?? 'unknown',
            method: (response?.config?.method ?? 'GET').toUpperCase(),
            requestPayload: sanitisePayload(response?.config?.data),
            // telemetry-wrap types require string; null means absent from payload
            sessionId: ctx.sessionId as unknown as string,
            questionId: ctx.questionId as unknown as string,
            responseStatus,
            responseBody: responseBody as object,
            isEmptyResponse,
            latencyMs,
            context: {
              ...(ctx.context as Record<string, string>),
              direction: 'outbound',
              source: 'external-api',
            },
          },
          'ext_api_call',
        );
      }),
      catchError((err) => {
        const latencyMs = Date.now() - requestTime;

        logTelemetryApiCall(
          {
            requestTime: new Date(requestTime).toISOString(),
            url: err?.config?.url ?? 'unknown',
            method: (err?.config?.method ?? 'GET').toUpperCase(),
            requestPayload: sanitisePayload(err?.config?.data),
            sessionId: ctx.sessionId as unknown as string,
            questionId: ctx.questionId as unknown as string,
            responseStatus: err?.response?.status ?? 0,
            responseBody: sanitisePayload(err?.response?.data) as object,
            isEmptyResponse: false,
            latencyMs,
            error: err?.message,
            context: {
              ...(ctx.context as Record<string, string>),
              direction: 'outbound',
              source: 'external-api',
            },
          },
          'ext_api_call',
        );

        return throwError(() => err);
      }),
    );
  }
}