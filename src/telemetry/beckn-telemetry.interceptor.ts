import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { isEmptyBody } from 'telemetry-wrap';
import {
  TelemetryContext,
  extractBecknContext,
  runWithTelemetryContext,
} from './telemetry.context';
import {
  emitOeEnd,
  emitOeItemResponse,
  emitOeStart,
} from './oe-telemetry.emitter';
import {
  buildBecknEnvelope,
  captureResponsePayload,
  isApiSuccess,
} from './telemetry-payload.builder';
import { sanitisePayload } from './telemetry-sanitiser';

@Injectable()
export class BecknTelemetryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const telemetryCtx = extractBecknContext(req);
    const requestTime = Date.now();

    req.__telemetryCtx = telemetryCtx;

    return new Observable((observer) => {
      runWithTelemetryContext(telemetryCtx, () => {
        emitOeStart(telemetryCtx);

        next
          .handle()
          .pipe(
            tap((responseBody) => {
              const latencyMs = Date.now() - requestTime;
              const statusCode = res.statusCode || 200;
              this.captureInbound(
                req,
                telemetryCtx,
                statusCode,
                responseBody,
                latencyMs,
              );
              emitOeEnd(telemetryCtx, latencyMs, true);
            }),
            catchError((err) => {
              const latencyMs = Date.now() - requestTime;
              const statusCode =
                err?.status ?? err?.getStatus?.() ?? res.statusCode ?? 500;
              const responseBody = err?.response ?? { message: err?.message };

              this.captureInbound(
                req,
                telemetryCtx,
                statusCode,
                responseBody,
                latencyMs,
                err?.message,
              );
              emitOeEnd(telemetryCtx, latencyMs, false, err?.message);

              return throwError(() => err);
            }),
          )
          .subscribe({
            next: (value) => observer.next(value),
            error: (err) => observer.error(err),
            complete: () => observer.complete(),
          });
      });
    });
  }

  private captureInbound(
    req: { method: string; originalUrl?: string; url?: string; body?: unknown },
    ctx: TelemetryContext,
    statusCode: number,
    responseBody: unknown,
    latencyMs: number,
    error?: string,
  ): void {
    try {
      const url = req.originalUrl || req.url || 'unknown';
      const capturedResponse = captureResponsePayload(responseBody);
      // Empty payload on HTTP 200 is captured as 404 (not found / no data)
      const isEmpty = statusCode === 200 && isEmptyBody(responseBody);
      const effectiveStatusCode = isEmpty ? 404 : statusCode;
      const success = isApiSuccess(effectiveStatusCode, responseBody, error);

      emitOeItemResponse(ctx, {
        itemType: 'bpp_network_api_call',
        serviceName: ctx.context.service_name ?? 'unknown',
        method: req.method,
        url,
        requestPayload: buildBecknEnvelope(
          ctx,
          sanitisePayload(req.body),
        ),
        responsePayload: isEmpty
          ? { _empty: true }
          : sanitisePayload(capturedResponse),
        statusCode: effectiveStatusCode,
        latencyMs,
        success,
        error,
      });
    } catch {
      // Telemetry must never break the request flow
    }
  }
}