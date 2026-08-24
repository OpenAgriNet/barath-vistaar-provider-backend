type TagListItem = {
  descriptor?: { code?: string; name?: string };
  value?: string;
  display?: boolean;
};

type PersonTag = {
  descriptor?: { code?: string; name?: string };
  list?: TagListItem[];
  value?: string;
};

type BecknBody = {
  context?: { domain?: string; action?: string };
  message?: {
    intent?: {
      category?: { descriptor?: { code?: string; name?: string } };
      item?: { descriptor?: { code?: string; name?: string }; id?: string };
      provider?: { id?: string };
      items?: Array<{ id?: string }>;
    };
    order?: {
      provider?: { id?: string };
      items?: Array<{ id?: string }>;
      fulfillments?: Array<{
        customer?: {
          person?: { tags?: PersonTag[] };
          contact?: { phone?: string };
        };
      }>;
    };
  };
};

/**
 * Telemetry service_name / use case labels.
 * Keep specific flows distinct (e.g. pmkisan-greviance vs pmfby-greviance),
 * do not collapse them into a parent bucket.
 */
const ROUTE_TO_SERVICE: Record<string, string> = {
  'knowledge-advisory': 'advisory',
  'weather-forecast': 'imd',
  'weather-forecast-mausamgram': 'imd',
  'schemes-agri': 'scheme',
  'icar-schemes': 'scheme',
  // Qdrant vector document search (not Hasura)
  'scheme-agri-qdrant': 'scheme-qdrant',
  mandi: 'mandi',
  'mandi-location': 'mandi',
  pmfby: 'pmfby',
  'pmfby-agri': 'pmfby',
  // Grievances — keep separate use cases (provider ids use historical "greviance" spelling)
  'grievance-agri': 'grievance-agri',
  'pmkisan-greviance': 'pmkisan-greviance',
  'pmfby-grievance': 'pmfby-greviance',
  // PM-KISAN non-scheme flows
  'pmkisan-installment-status': 'pmkisan-installment-status',
  'gfr-crop-registry': 'gfr',
  'gfr-crop-recommendation': 'gfr',
  smam: 'smam',
  'sathi-seed': 'sathi',
  'shc-discovery': 'shc',
  'aif-agri': 'aif',
};

const ROUTE_NAME_BY_SERVICE: Record<string, string> = {
  scheme: 'schemes-agri',
  'scheme-qdrant': 'scheme-agri-qdrant',
  mandi: 'price-discovery',
  imd: 'weather-forecast',
  advisory: 'knowledge-advisory',
  pmfby: 'pmfby',
  'pmfby-greviance': 'pmfby-grievance',
  gfr: 'gfr-agri',
  smam: 'smam',
  sathi: 'sathi-seed',
  shc: 'shc-discovery',
  aif: 'aif-agri',
  'grievance-agri': 'grievance-agri',
  'pmkisan-greviance': 'pmkisan-greviance',
  'pmkisan-installment-status': 'pmkisan-installment-status',
};

/** Hasura structured scheme-discovery category codes (not Qdrant). */
const SCHEME_CATEGORY_CODES = new Set([
  'schemes-agri',
  'scheme-agri',
  'icar-schemes',
  'agri-schemes',
  'schemes',
]);

/** Qdrant vector document search category (no Hasura). */
const SCHEME_QDRANT_CATEGORY_CODES = new Set([
  'scheme-agri-qdrant',
]);

export function isSchemeQdrantCategory(body?: BecknBody): boolean {
  if (!body) return false;
  const code = String(
    body.message?.intent?.category?.descriptor?.code ?? '',
  )
    .trim()
    .toLowerCase();
  const name = String(
    body.message?.intent?.category?.descriptor?.name ?? '',
  )
    .trim()
    .toLowerCase();
  return (
    SCHEME_QDRANT_CATEGORY_CODES.has(code) ||
    SCHEME_QDRANT_CATEGORY_CODES.has(name)
  );
}

/**
 * Hasura scheme catalogue / discovery search: only when category code (or name)
 * is an explicit scheme code like "schemes-agri". Domain schemes:vistaar alone
 * is NOT enough. Does NOT include scheme-agri-qdrant (vector path).
 */
export function isSchemeCategory(body?: BecknBody): boolean {
  if (!body) return false;
  // Vector path is separate from Hasura scheme discovery
  if (isSchemeQdrantCategory(body)) return false;

  const code = String(
    body.message?.intent?.category?.descriptor?.code ?? '',
  )
    .trim()
    .toLowerCase();
  const name = String(
    body.message?.intent?.category?.descriptor?.name ?? '',
  )
    .trim()
    .toLowerCase();

  if (SCHEME_CATEGORY_CODES.has(code) || SCHEME_CATEGORY_CODES.has(name)) {
    return true;
  }
  // Other scheme-* category codes (not grievance / pmkisan / qdrant)
  if (
    (code.includes('scheme') || name.includes('scheme')) &&
    !code.includes('grievance') &&
    !name.includes('grievance') &&
    !code.includes('qdrant') &&
    !name.includes('qdrant')
  ) {
    return true;
  }
  return false;
}

/**
 * PM-KISAN installment / status / send-OTP / get-details style requests:
 * person.tags → reg-details → reg-number (provider/item often empty).
 * These are NOT scheme discovery even if domain is schemes:vistaar.
 */
export function hasPmkisanInstallmentStatusSignal(body?: BecknBody): boolean {
  if (!body) return false;

  const fulfillments = body.message?.order?.fulfillments ?? [];
  for (const fulfillment of fulfillments) {
    const tags = fulfillment?.customer?.person?.tags;
    if (!Array.isArray(tags)) continue;

    for (const tag of tags) {
      const groupCode = String(tag?.descriptor?.code ?? '').toLowerCase();
      if (groupCode !== 'reg-details') continue;

      const list = tag.list;
      if (!Array.isArray(list)) continue;

      for (const item of list) {
        const code = String(item?.descriptor?.code ?? '').toLowerCase();
        const value = String(item?.value ?? '').trim();
        if (code === 'reg-number' && value.length > 0) {
          return true;
        }
      }
    }
  }

  return false;
}

function resolveSchemeRoute(body: BecknBody): string {
  const code = String(
    body.message?.intent?.category?.descriptor?.code ?? '',
  )
    .trim()
    .toLowerCase();
  if (code === 'icar-schemes') return 'icar-schemes';
  return 'schemes-agri';
}

function resolveMobilityRoute(body: BecknBody): string {
  // 0) Qdrant vector scheme documents (no Hasura)
  if (isSchemeQdrantCategory(body)) {
    return 'scheme-agri-qdrant';
  }

  // 1) Hasura scheme discovery ONLY when intent.category.descriptor.code is schemes-agri (etc.)
  if (isSchemeCategory(body)) {
    return resolveSchemeRoute(body);
  }

  // 2) PM-KISAN status / OTP / installment (no scheme category code)
  if (hasPmkisanInstallmentStatusSignal(body)) {
    return 'pmkisan-installment-status';
  }

  const categoryName = body?.message?.intent?.category?.descriptor?.name;
  const categoryCode =
    body?.message?.intent?.category?.descriptor?.code?.toLowerCase();
  const categoryNameLower = categoryName?.toLowerCase();
  const firstItemId =
    body?.message?.order?.items?.[0]?.id ??
    body?.message?.intent?.items?.[0]?.id ??
    body?.message?.intent?.item?.id;
  const providerId = (
    body?.message?.order?.provider?.id ??
    body?.message?.intent?.provider?.id ??
    ''
  ).toLowerCase();
  const itemDescriptorCode =
    body?.message?.intent?.item?.descriptor?.code?.toLowerCase();
  const itemDescriptorName = body?.message?.intent?.item?.descriptor?.name;

  switch (true) {
    case categoryName === 'knowledge-advisory':
      return 'knowledge-advisory';
    case categoryName === 'Weather-Forecast':
      return 'weather-forecast';
    case categoryName === 'Weather-Forecast-Mausamgram':
      return 'weather-forecast-mausamgram';
    // Grievances first (must not be collapsed into generic pmfby/pmkisan)
    // Provider/item ids in the system use "greviance" spelling.
    case providerId === 'pmkisan-greviance' || firstItemId === 'pmkisan-greviance':
      return 'pmkisan-greviance';
    case providerId === 'pmfby-grievance' ||
      firstItemId === 'pmfby-grievance' ||
      categoryCode === 'pmfby-grievance' ||
      categoryNameLower === 'pmfby-grievance' ||
      categoryCode === 'pmfby-greviance' ||
      categoryNameLower === 'pmfby-greviance':
      return 'pmfby-grievance';
    case categoryCode === 'grievance' || categoryNameLower === 'grievance-agri':
      return 'grievance-agri';
    // schemes-agri / icar-schemes already handled above via isSchemeCategory
    case categoryCode === 'pmfby' ||
      categoryNameLower === 'pmfby' ||
      (!!categoryCode?.startsWith('pmfby') &&
        !categoryCode?.includes('griev')) ||
      providerId === 'pmfby-agri' ||
      firstItemId === 'pmfby' ||
      (!!firstItemId?.startsWith('pmfby') && !firstItemId?.includes('griev')):
      return 'pmfby';
    case providerId === 'gfr-agri':
      return firstItemId === 'gfr-agri-crop-recommendation'
        ? 'gfr-crop-recommendation'
        : 'gfr-crop-registry';
    case categoryCode === 'price-discovery':
      if (itemDescriptorCode === 'mandi') return 'mandi';
      if (itemDescriptorName) return 'mandi-location';
      return 'mandi-location';
    case providerId === 'sathi-seed':
      return 'sathi-seed';
    case providerId === 'smam':
      return 'smam';
    case providerId === 'pmfby-agri':
      return 'pmfby-agri';
    case providerId === 'shc-discovery':
      return 'shc-discovery';
    case providerId === 'aif-agri':
      return 'aif-agri';
    default:
      return 'unknown';
  }
}

export function resolveServiceName(
  body?: BecknBody,
  requestPath?: string,
): string {
  if (!body) {
    if (requestPath?.includes('/mobility/')) return 'mobility';
    return 'unknown';
  }

  // 0) Qdrant vector scheme document search (not Hasura)
  if (isSchemeQdrantCategory(body)) {
    return 'scheme-qdrant';
  }

  // 1) Explicit Hasura scheme category code → scheme
  if (isSchemeCategory(body)) {
    return 'scheme';
  }

  // 2) Status / OTP / get-details / installment (reg-number)
  //    → specific pmkisan-installment-status (not generic "pmkisan")
  if (hasPmkisanInstallmentStatusSignal(body)) {
    return 'pmkisan-installment-status';
  }

  // 3) Route-based: keeps pmkisan-greviance / pmfby-greviance / etc. distinct
  const route = resolveMobilityRoute(body);
  if (route !== 'unknown' && ROUTE_TO_SERVICE[route]) {
    return ROUTE_TO_SERVICE[route];
  }

  const domain = body?.context?.domain?.toLowerCase() ?? '';
  if (domain.includes('vistaar')) {
    if (domain.includes('weather')) return 'imd';
    if (domain.includes('advisory')) return 'advisory';
    if (domain.includes('price')) return 'mandi';
    // Do NOT map schemes:vistaar alone to scheme — need category code schemes-agri
    return 'unknown';
  }

  if (requestPath?.includes('/mobility/')) return 'mobility';
  if (requestPath?.includes('/dsep/')) return 'scheme';

  return 'unknown';
}

export function resolveRouteName(
  body?: BecknBody,
  serviceName?: string,
): string {
  const route = body ? resolveMobilityRoute(body) : 'unknown';
  if (route !== 'unknown') return route;
  if (serviceName && ROUTE_NAME_BY_SERVICE[serviceName]) {
    return ROUTE_NAME_BY_SERVICE[serviceName];
  }
  return 'unknown';
}

export function resolveExternalServiceName(url?: string): string {
  if (!url) return 'external';
  const normalized = url.toLowerCase();

  if (normalized.includes('hasura') || normalized.includes('/graphql')) {
    return 'hasura';
  }
  if (normalized.includes('agmarknet')) return 'mandi';
  if (normalized.includes('pmkisan')) return 'pmkisan';
  if (normalized.includes('pmfby')) return 'pmfby';
  if (normalized.includes('mausamgram') || normalized.includes('imd.gov')) {
    return 'imd';
  }
  if (normalized.includes('soilhealth') || normalized.includes('shc')) {
    return 'shc';
  }
  if (normalized.includes('seedtrace') || normalized.includes('sathi')) {
    return 'sathi';
  }
  if (normalized.includes('agrimachinery') || normalized.includes('smam')) {
    return 'smam';
  }
  if (normalized.includes('agriinfra')) return 'aif';

  return 'external';
}

export function extractUseCaseMetadata(body?: Record<string, unknown>): Record<string, string> {
  if (!body) return {};

  const message = (body.message ?? {}) as Record<string, unknown>;
  const intent = (message.intent ?? {}) as Record<string, unknown>;
  const order = (message.order ?? {}) as Record<string, unknown>;
  const category = (intent.category as Record<string, unknown>)?.descriptor as
    | Record<string, string>
    | undefined;
  const item = (intent.item as Record<string, unknown>)?.descriptor as
    | Record<string, string>
    | undefined;
  const provider = ((order.provider ?? intent.provider) as Record<string, unknown>)
    ?.id as string | undefined;

  const meta: Record<string, string> = {};
  if (category?.code) meta.category_code = category.code;
  if (category?.name) meta.category_name = category.name;
  if (item?.name) meta.item_name = item.name;
  if (item?.code) meta.item_code = item.code;
  if (provider) meta.provider_id = provider;

  // PM-KISAN installment: capture reg-number when present
  if (hasPmkisanInstallmentStatusSignal(body as BecknBody)) {
    meta.use_case_type = 'pmkisan-installment-status';
    const fulfillments =
      (order.fulfillments as Array<{
        customer?: { person?: { tags?: PersonTag[] } };
      }>) ?? [];
    for (const f of fulfillments) {
      for (const tag of f?.customer?.person?.tags ?? []) {
        if (tag?.descriptor?.code !== 'reg-details') continue;
        for (const entry of tag.list ?? []) {
          if (entry?.descriptor?.code === 'reg-number' && entry.value) {
            meta.reg_number = String(entry.value).trim();
          }
        }
      }
    }
  }

  if (isSchemeCategory(body as BecknBody)) {
    meta.use_case_type = 'scheme';
    meta.scheme_id = item?.name ?? item?.code ?? '';
  }

  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && value !== ''),
  );
}