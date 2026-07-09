import { AsyncLocalStorage } from 'async_hooks';
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

function extractTagsMap(tags: unknown): Record<string, string> {
  if (!tags) return {};

  if (typeof tags === 'object' && !Array.isArray(tags)) {
    return Object.fromEntries(
      Object.entries(tags).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  if (Array.isArray(tags)) {
    const result: Record<string, string> = {};
    for (const tag of tags) {
      if (!tag || typeof tag !== 'object') continue;
      const code = (tag as { code?: string }).code;
      const value = (tag as { value?: string }).value;
      if (code && value) result[code] = value;
    }
    return result;
  }

  return {};
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

  const contextTags = extractTagsMap(becknContext.tags);
  const intentTags = extractTagsMap(intent.tags);
  const mergedTags = { ...intentTags, ...contextTags };

  const transactionId = String(becknContext.transaction_id ?? uuidv4());
  const messageId = String(becknContext.message_id ?? uuidv4());
  const hasExplicitCorrelation = Boolean(
    mergedTags.session_id && mergedTags.question_id,
  );
  const payloadChannel = hasExplicitCorrelation
    ? mergedTags.channel?.trim() || undefined
    : undefined;
  const sessionId = mergedTags.session_id ?? transactionId;
  const questionId = mergedTags.question_id ?? messageId;

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