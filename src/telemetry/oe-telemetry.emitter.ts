import { Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import {
  generateTelemetryMid,
  getTelemetryEndpoint,
  resolveTelemetryChannel,
  resolveTelemetryPdata,
} from './telemetry.config';
import { isTelemetryReady } from './telemetry.bootstrap';
import {
  getTelemetryFlowState,
  type TelemetryContext,
} from './telemetry.context';
import { queueTelemetryEvent } from './telemetry.flow-buffer';

export type OeFlowEid = 'OE_START' | 'OE_ITEM_RESPONSE' | 'OE_END';
export type OeItemType = 'bpp_network_api_call' | 'ext_api_call';

export interface OeItemResponseDetails {
  itemType: OeItemType;
  serviceName: string;
  method: string;
  url: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  statusCode: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

const oeLogger = new Logger('TelemetryOE');

function isTelemetryDebugEnabled(): boolean {
  return process.env.TELEMETRY_DEBUG === 'true';
}

function resolveApiTargetId(
  itemType: OeItemType,
  url: string,
  requestPayload?: unknown,
): string {
  if (itemType === 'ext_api_call') {
    const payload = requestPayload as Record<string, unknown> | undefined;
    const downstream = payload?.downstream_service;
    if (typeof downstream === 'string' && downstream.length > 0) {
      return downstream;
    }
  }

  if (url.startsWith('http')) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  return url;
}

function toEksType(eid: OeFlowEid, itemType?: OeItemType): string {
  if (eid === 'OE_START') return 'FLOW_START';
  if (eid === 'OE_END') return 'FLOW_END';
  if (itemType === 'ext_api_call') return 'EXT_API_CALL';
  if (itemType === 'bpp_network_api_call') return 'BPP_NETWORK_API_CALL';
  return 'API_CALL';
}

function flowTarget(ctx: TelemetryContext): Record<string, string | null> {
  return {
    session_id: ctx.sessionId,
    question_id: ctx.questionId,
    service_name: ctx.context.service_name ?? 'unknown',
    route_name: ctx.context.route_name ?? 'unknown',
    beckn_action: ctx.context.beckn_action ?? 'unknown',
    beckn_domain: ctx.context.beckn_domain ?? 'unknown',
    beckn_transaction_id: ctx.context.beckn_transaction_id ?? null,
    beckn_message_id: ctx.context.beckn_message_id ?? null,
    request_path: ctx.context.request_path ?? 'unknown',
  };
}

function buildOeEvent(
  eid: OeFlowEid,
  ctx: TelemetryContext,
  eks: Record<string, unknown>,
): Record<string, unknown> {
  return {
    eid,
    ver: '2.2',
    mid: generateTelemetryMid(),
    ets: Date.now(),
    channel: resolveTelemetryChannel(ctx),
    pdata: resolveTelemetryPdata(ctx),
    gdata: {
      id: ctx.context.service_name ?? 'unknown',
      ver: 'v1.0',
    },
    cdata: [],
    uid: process.env.TELEMETRY_UID || 'network-provider-service',
    sid: ctx.sessionId,
    qid: ctx.questionId,
    did: process.env.TELEMETRY_DID || 'network-provider-device',
    edata: { eks },
    etags: { partner: [] },
  };
}

async function dispatchOeBatch(events: Record<string, unknown>[]): Promise<void> {
  if (!isTelemetryReady() || events.length === 0) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authKey =
    process.env.TELEMETRY_AUTH_KEY || process.env.TELEMETRY_SERVICE_AUTH_KEY;
  if (authKey) {
    headers.Authorization = `Bearer ${authKey}`;
  }

  const now = Date.now();

  const batchMid = generateTelemetryMid();
  const payload = {
    id: 'ekstep.telemetry',
    ver: '2.2',
    ets: now,
    mid: batchMid,
    syncts: now,
    events,
  };

  try {
    const response = await axios.post(getTelemetryEndpoint(), payload, {
      headers,
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      const body =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data ?? '');
      oeLogger.error(
        `OE telemetry dispatch failed mid=${batchMid} status=${response.status} events=${events.length} body=${body.slice(0, 500)}`,
      );
      return;
    }

    if (isTelemetryDebugEnabled()) {
      oeLogger.log(
        `OE telemetry dispatched mid=${batchMid} events=${events.length} status=${response.status}`,
      );
    }
  } catch (error) {
    const ax = error as AxiosError;
    const message = ax.message || String(error);
    oeLogger.error(
      `OE telemetry dispatch error mid=${batchMid} events=${events.length}: ${message}`,
    );
  }
}

function enqueueOeEvent(
  ctx: TelemetryContext,
  event: Record<string, unknown>,
): void {
  const state = getTelemetryFlowState();
  if (!state) {
    if (isTelemetryDebugEnabled()) {
      oeLogger.warn(
        `Telemetry event ${String(event.eid)} dropped — no active flow buffer`,
      );
    }
    return;
  }

  queueTelemetryEvent(state, event);
}

export function emitOeStart(ctx: TelemetryContext): void {
  const eks = {
    target: flowTarget(ctx),
    qid: ctx.questionId,
    type: toEksType('OE_START'),
    state: '',
  };

  if (isTelemetryDebugEnabled()) {
    oeLogger.log(
      `OE_START service=${ctx.context.service_name} route=${ctx.context.route_name} channel=${resolveTelemetryChannel(ctx)} explicitCorrelation=${ctx.hasExplicitCorrelation} payloadChannel=${ctx.payloadChannel ?? 'none'}`,
    );
  }

  enqueueOeEvent(ctx, buildOeEvent('OE_START', ctx, eks));
}

export function emitOeItemResponse(
  ctx: TelemetryContext,
  details: OeItemResponseDetails,
): void {
  const useCaseName = ctx.context.service_name ?? details.serviceName ?? 'unknown';
  const targetId = resolveApiTargetId(
    details.itemType,
    details.url,
    details.requestPayload,
  );
  const eks = {
    target: {
      id: targetId,
      ver: 'v1.0',
      type: 'API_CALL',
      parent: { id: useCaseName, type: 'use_case' },
      networkApiDetails: {
        apiType: details.itemType === 'ext_api_call' ? 'EXT_API' : 'BPP_NETWORK',
        apiService: targetId,
        type: details.itemType,
        service_name: useCaseName,
        session_id: ctx.sessionId,
        question_id: ctx.questionId,
        method: details.method,
        url: details.url,
        input: details.requestPayload ?? {},
        output: details.responsePayload ?? {},
        success: details.success,
        statusCode: details.statusCode,
        latencyMs: details.latencyMs,
        error: details.error ?? null,
      },
    },
    qid: ctx.questionId,
    type: toEksType('OE_ITEM_RESPONSE', details.itemType),
    state: '',
  };

  if (isTelemetryDebugEnabled()) {
    oeLogger.log(
      `OE_ITEM_RESPONSE ${details.itemType} ${details.method} ${details.url} [${details.statusCode}] ${details.latencyMs}ms`,
    );
  }

  enqueueOeEvent(ctx, buildOeEvent('OE_ITEM_RESPONSE', ctx, eks));
}

export function emitOeEnd(
  ctx: TelemetryContext,
  durationMs: number,
  success: boolean,
  error?: string,
): void {
  const eks = {
    target: {
      ...flowTarget(ctx),
      durationMs,
      success,
      error: error ?? null,
    },
    qid: ctx.questionId,
    type: toEksType('OE_END'),
    state: success ? 'SUCCESS' : 'FAILED',
  };

  if (isTelemetryDebugEnabled()) {
    oeLogger.log(
      `OE_END service=${ctx.context.service_name} success=${success} ${durationMs}ms`,
    );
  }

  const state = getTelemetryFlowState();
  if (!state) {
    if (isTelemetryDebugEnabled()) {
      oeLogger.warn('OE_END dropped — no active flow buffer');
    }
    return;
  }

  queueTelemetryEvent(state, buildOeEvent('OE_END', ctx, eks));
  void dispatchOeBatch(state.events);
  state.events.length = 0;
}