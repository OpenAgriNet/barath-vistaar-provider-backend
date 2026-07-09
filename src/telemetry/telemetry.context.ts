import { AsyncLocalStorage } from 'async_hooks';
import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  extractUseCaseMetadata,
  resolveRouteName,
  resolveServiceName,
} from './service-name.resolver';
import {
  createFlowState,
  type TelemetryFlowState,
} from './telemetry.flow-buffer';

const contextLogger = new Logger('TelemetryContext');

export interface TelemetryContext {
  sessionId: string;
  questionId: string;
  /** True when both session_id and question_id are present in Beckn context/intent tags. */
  hasExplicitCorrelation: boolean;
  /** Channel from payload tags — only set when session_id + question_id tags are present. */
  payloadChannel?: string;
  context: Record<string, string>;
}

const telemetryStorage = new AsyncLocalStorage<TelemetryFlowState>();

export function runWithTelemetryContext<T>(
  ctx: TelemetryContext,
  fn: () => T,
): T {
  return telemetryStorage.run(createFlowState(ctx), fn);
}

export function getTelemetryFlowState(): TelemetryFlowState | undefined {
  return telemetryStorage.getStore();
}

export function getTelemetryContext(): TelemetryContext {
  return (
    telemetryStorage.getStore()?.context ?? {
      sessionId: null,
      questionId: null,
      hasExplicitCorrelation: false,
      context: {},
    }
  );
}

/**
 * Normalize Beckn tags into a flat code → value map.
 * Supports:
 * - Object map: { "session_id": "uuid", "question_id": "uuid" }
 * - Array of { code, value }
 * - Array of { descriptor: { code }, value }
 * - Nested list: { code, list: [{ code, value }, ...] }
 * - JSON string of any of the above
 */
function extractTagsMap(tags: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (tags == null) return result;

  const put = (code: unknown, value: unknown) => {
    if (code == null || value == null) return;
    // Skip nested objects/arrays as values (not a leaf tag)
    if (typeof value === 'object') return;
    const c = String(code).trim();
    const v = String(value).trim();
    if (c && v) result[c] = v;
  };

  // Stringified JSON
  if (typeof tags === 'string') {
    try {
      return extractTagsMap(JSON.parse(tags));
    } catch {
      return result;
    }
  }

  // Object map: { session_id: "...", question_id: "..." }
  if (typeof tags === 'object' && !Array.isArray(tags)) {
    for (const [key, value] of Object.entries(tags as Record<string, unknown>)) {
      put(key, value);
    }
    return result;
  }

  // Array forms
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (!tag || typeof tag !== 'object') continue;
      const t = tag as Record<string, unknown>;
      const descriptor = t.descriptor as { code?: string } | undefined;
      const code = t.code ?? descriptor?.code;
      put(code, t.value);

      // Nested list of tag items (Beckn TagGroup)
      if (Array.isArray(t.list)) {
        for (const item of t.list) {
          if (!item || typeof item !== 'object') continue;
          const it = item as Record<string, unknown>;
          const itemDescriptor = it.descriptor as { code?: string } | undefined;
          const itemCode = it.code ?? itemDescriptor?.code;
          put(itemCode, it.value);
        }
      }
    }
    return result;
  }

  return result;
}

/** Merge tag maps from several known payload locations (later wins). */
function collectBecknTags(body: Record<string, unknown>): Record<string, string> {
  const becknContext = (body.context ?? {}) as Record<string, unknown>;
  const message = (body.message ?? {}) as Record<string, unknown>;
  const intent = (message.intent ?? {}) as Record<string, unknown>;
  const order = (message.order ?? {}) as Record<string, unknown>;

  // Priority: root tags < order tags < intent tags < context tags (context wins)
  return {
    ...extractTagsMap(body.tags),
    ...extractTagsMap(order.tags),
    ...extractTagsMap(intent.tags),
    ...extractTagsMap(becknContext.tags),
  };
}

export function extractBecknContext(req: {
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  url?: string;
  originalUrl?: string;
}): TelemetryContext {
  const body = req.body ?? {};
  const becknContext = (body.context ?? {}) as Record<string, unknown>;
  const message = (body.message ?? {}) as Record<string, unknown>;
  const intent = (message.intent ?? {}) as Record<string, unknown>;

  // Capture exactly what was passed in tags (object map or array) — no fallbacks
  const mergedTags = collectBecknTags(body);

  const transactionId = String(becknContext.transaction_id ?? uuidv4());
  const messageId = String(becknContext.message_id ?? uuidv4());

  // ONLY from tags as passed by the client — empty when not present
  const sessionId = (mergedTags.session_id ?? '').trim();
  const questionId = (mergedTags.question_id ?? '').trim();
  const hasExplicitCorrelation = Boolean(sessionId && questionId);
  const payloadChannel = hasExplicitCorrelation
    ? mergedTags.channel?.trim() || undefined
    : undefined;

  const requestPath = req.originalUrl ?? req.url ?? 'unknown';
  const serviceName = resolveServiceName(
    body as Parameters<typeof resolveServiceName>[0],
    requestPath,
  );
  const routeName = resolveRouteName(
    body as Parameters<typeof resolveRouteName>[0],
    serviceName,
  );
  const useCaseMeta = extractUseCaseMetadata(body);

  // Always print what we captured from tags (empty if not passed)
  contextLogger.log(
    `[Telemetry] path=${requestPath} ` +
      `session_id=${sessionId || ''} ` +
      `question_id=${questionId || ''} ` +
      `has_tags=${Boolean(becknContext.tags || intent.tags || body.tags)} ` +
      `tag_keys=${Object.keys(mergedTags).join(',') || '(none)'} ` +
      `transaction_id=${transactionId} message_id=${messageId}`,
  );

  return {
    sessionId,
    questionId,
    hasExplicitCorrelation,
    payloadChannel,
    context: {
      session_id: sessionId,
      question_id: questionId,
      beckn_transaction_id: transactionId,
      beckn_message_id: messageId,
      beckn_action: String(
        becknContext.action ?? inferActionFromPath(requestPath),
      ),
      beckn_domain: String(becknContext.domain ?? 'unknown'),
      beckn_bpp_id: String(becknContext.bpp_id ?? ''),
      beckn_bap_id: String(becknContext.bap_id ?? ''),
      request_path: requestPath,
      service_name: serviceName,
      route_name: routeName,
      use_case: serviceName,
      use_case_meta: JSON.stringify(useCaseMeta),
      mobility_route: routeName,
    },
  };
}

function inferActionFromPath(path?: string): string {
  if (!path) return 'unknown';
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'unknown';
}