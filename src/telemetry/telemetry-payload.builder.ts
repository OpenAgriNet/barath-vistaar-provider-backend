import type { TelemetryContext } from './telemetry.context';

/** Capture full request/response body without size truncation. */
export function captureResponsePayload(body: unknown): unknown {
  if (body === null || body === undefined) return null;
  return body;
}

export function parseHostFromUrl(url?: string): string | undefined {
  if (!url || !url.startsWith('http')) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function parseEndpointPath(url?: string): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('http')) return url;
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

export function isApiSuccess(
  status: number,
  data: unknown,
  error?: string,
): boolean {
  if (error || status === 0 || status >= 400) return false;
  if (data && typeof data === 'object' && 'errors' in data) {
    const errors = (data as { errors?: unknown[] }).errors;
    if (Array.isArray(errors) && errors.length > 0) return false;
  }
  return true;
}

function parseUseCaseMeta(ctx: TelemetryContext): Record<string, unknown> {
  if (!ctx.context.use_case_meta) return {};
  try {
    return JSON.parse(ctx.context.use_case_meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function becknBlock(ctx: TelemetryContext): Record<string, unknown> {
  return {
    transaction_id: ctx.context.beckn_transaction_id,
    message_id: ctx.context.beckn_message_id,
    domain: ctx.context.beckn_domain,
    action: ctx.context.beckn_action,
    bap_id: ctx.context.beckn_bap_id,
    bpp_id: ctx.context.beckn_bpp_id,
    request_path: ctx.context.request_path,
  };
}

export function buildBecknEnvelope(
  ctx: TelemetryContext,
  body?: unknown,
): Record<string, unknown> {
  const useCaseFields = parseUseCaseMeta(ctx);
  return {
    beckn: becknBlock(ctx),
    route_name: ctx.context.route_name,
    session_id: ctx.sessionId,
    question_id: ctx.questionId,
    use_case: ctx.context.service_name,
    use_case_fields: useCaseFields,
    body: body ?? null,
  };
}

export type GraphqlRequestPayload = {
  operation?: string;
  query?: string;
  variables?: unknown;
};

/** Axios often stringifies config.data before the response interceptor runs. */
export function parseAxiosRequestData(
  data: unknown,
): Record<string, unknown> | undefined {
  if (!data) return undefined;

  if (typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function extractGraphqlFromAxiosData(
  data: unknown,
): GraphqlRequestPayload | undefined {
  const payload = parseAxiosRequestData(data);
  if (!payload || typeof payload.query !== 'string' || !payload.query.trim()) {
    return undefined;
  }

  const match = payload.query.match(/(?:query|mutation)\s+(\w+)/i);
  return {
    operation: match?.[1],
    query: payload.query,
    variables: payload.variables,
  };
}

export function buildExtApiEnvelope(
  ctx: TelemetryContext,
  params: {
    url: string;
    method: string;
    downstreamService: string;
    requestBody?: unknown;
    graphql?: GraphqlRequestPayload;
  },
): Record<string, unknown> {
  const graphql =
    params.graphql?.query
      ? params.graphql
      : extractGraphqlFromAxiosData(params.requestBody);

  const envelope: Record<string, unknown> = {
    beckn: becknBlock(ctx),
    route_name: ctx.context.route_name,
    host: parseHostFromUrl(params.url),
    downstream_service: params.downstreamService,
    http: {
      method: params.method,
      endpoint_path: parseEndpointPath(params.url),
    },
    use_case: ctx.context.service_name,
    use_case_fields: parseUseCaseMeta(ctx),
    body: params.requestBody ?? null,
  };

  if (graphql?.query) {
    envelope.graphql = graphql;
  }

  return envelope;
}