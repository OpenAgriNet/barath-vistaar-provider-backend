/**
 * Telemetry payload sanitiser — masks PII / sensitive identifiers before
 * request and response bodies are captured in OE telemetry.
 *
 * Covers:
 * - application number, aadhaar, reg number, phone / mobile
 * - otp, password, token, and other secrets
 * - Beckn tag shape: { descriptor: { code: "phone" }, value: "..." }
 * - Nested objects and arrays
 */

const REDACTED = '***REDACTED***';
/** High enough for deep Beckn / GraphQL trees; cycle detection still applies. */
const DEFAULT_MAX_DEPTH = 50;

/** Keys that must never appear even partially (full redaction). */
const FULL_REDACT_KEYS = new Set([
  'password',
  'secret',
  'token',
  'tokens',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'apitoken',
  'bearertoken',
  'sessiontoken',
  'servicetoken',
  'aadhaartoken',
  'aadhartoken',
  'jwttoken',
  'jwt',
  'otp',
  'pin',
  'cvv',
  'authorization',
  'apikey',
  'apisecret',
]);

/**
 * Normalised key names (lowercase, no separators) that hold PII.
 * Matched exactly after normalisation.
 */
const SENSITIVE_EXACT_KEYS = new Set([
  // identity / aadhaar
  'aadhaar',
  'aadhar',
  'aadhaarno',
  'aadharno',
  'aadhaarnumber',
  'aadharnumber',
  'aadnumber',
  'aadno',
  'identityno',
  'identitynumber',
  'identity',
  // phone / mobile
  'phone',
  'phoneno',
  'phonenumber',
  'mobile',
  'mobileno',
  'mobilenumber',
  'requestormobileno',
  'contactnumber',
  'contactno',
  // application / registration
  'applicationno',
  'applicationnumber',
  'applicationid',
  'regno',
  'regnumber',
  'registrationno',
  'registrationnumber',
  'regdetails',
  // common secrets / finance
  'pan',
  'pannumber',
  'account',
  'accountno',
  'accountnumber',
  'bankaccount',
  'ssn',
  'dob',
  'dateofbirth',
  'creditcard',
  'cardnumber',
  ...FULL_REDACT_KEYS,
]);

/**
 * Regex on normalised key — catches variants like farmer_aadhaar_no, userPhoneNumber.
 * Avoids false positives (e.g. "microphone" must not match "phone").
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /aadha?ar/,
  /identity(no|num|number)?$/,
  /(phone|mobile)(no|num|number)$/,
  /^(user|customer|contact|requestor|farmer|seeker|provider|primary|secondary)?(phone|mobile)$/,
  /application(no|num|number|id)$/,
  /(^|.)reg(istration)?(no|num|number)$/,
  /password/,
  /secret/,
  /(^|.)otp$/,
  // any *token* key (access_token, AadhaarToken, x-auth-token, …)
  /token/,
  /^jwt$/,
  /creditcard|cardnumber/,
  /account(no|num|number)$/,
  /apikey|authorization|bearer/,
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s.]/g, '');
}

function isTokenLikeKey(normalizedKey: string): boolean {
  return (
    normalizedKey.includes('token') ||
    normalizedKey === 'jwt' ||
    normalizedKey === 'authorization' ||
    normalizedKey === 'bearer' ||
    normalizedKey === 'apikey' ||
    normalizedKey === 'apisecret'
  );
}

export function isSensitiveKey(key: string): boolean {
  const n = normalizeKey(key);
  if (!n) return false;
  if (SENSITIVE_EXACT_KEYS.has(n)) return true;
  if (isTokenLikeKey(n)) return true;
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(n));
}

function isFullRedactKey(key: string): boolean {
  const n = normalizeKey(key);
  if (FULL_REDACT_KEYS.has(n)) return true;
  if (isTokenLikeKey(n)) return true;
  return /password|secret|(^|.)otp$|apikey|authorization/.test(n);
}

/**
 * Partial mask for identifiers — keeps last 4 characters when long enough.
 * e.g. 9876543210 → ******3210, APP123456789 → *******6789
 * Fully redacts secrets (otp, password, token, …).
 */
export function maskSensitiveValue(value: unknown, key?: string): string {
  if (value === null || value === undefined) return REDACTED;

  if (key && isFullRedactKey(key)) return REDACTED;

  const str = String(value).trim();
  if (!str) return REDACTED;
  if (str.length <= 4) return REDACTED;

  const visible = 4;
  const maskedLen = str.length - visible;
  return `${'*'.repeat(maskedLen)}${str.slice(-visible)}`;
}

/** 12-digit Aadhaar (with optional spaces/hyphens). */
const AADHAAR_VALUE_RE = /(?<!\d)(\d{4}[\s-]?\d{4}[\s-]?\d{4})(?!\d)/g;

/** Indian mobile: optional +91 / 0, then 10 digits starting 6–9. */
const PHONE_VALUE_RE =
  /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;

/** Authorization: Bearer <token> (or bare Bearer tokens in free text). */
const BEARER_TOKEN_RE = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

/** JWT (header.payload.signature). */
const JWT_RE =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/**
 * Mask Aadhaar / phone / token-like substrings inside free-form strings
 * (e.g. log messages, Authorization headers, concatenated fields).
 */
export function maskSensitivePatternsInString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let out = text.replace(BEARER_TOKEN_RE, 'Bearer ***REDACTED***');
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(AADHAAR_VALUE_RE, (match) => maskSensitiveValue(match));
  out = out.replace(PHONE_VALUE_RE, (match) => maskSensitiveValue(match));
  return out;
}

function descriptorCode(obj: Record<string, unknown>): string | undefined {
  const descriptor = obj.descriptor;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return undefined;
  }
  const code = (descriptor as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Sanitise any payload for telemetry capture.
 * Returns a plain object/array-safe clone with sensitive fields masked.
 */
export function sanitiseTelemetryPayload(
  payload: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): unknown {
  if (payload === null || payload === undefined) return payload;

  if (typeof payload === 'string') {
    return maskSensitivePatternsInString(payload);
  }

  if (typeof payload !== 'object') {
    return payload;
  }

  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return maskSensitivePatternsInString(value);
    if (typeof value !== 'object') return value;

    if (depth <= 0) return { _truncated: true };

    if (seen.has(value as object)) return { _circular: true };
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => walk(item, depth - 1));
    }

    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // Beckn tag: { descriptor: { code: "aadhaar_no" }, value: "..." }
    const tagCode = descriptorCode(obj);
    const tagIsSensitive = tagCode ? isSensitiveKey(tagCode) : false;

    for (const [key, val] of Object.entries(obj)) {
      if (isSensitiveKey(key)) {
        result[key] = maskSensitiveValue(val, key);
        continue;
      }

      if (tagIsSensitive && (key === 'value' || key === 'list')) {
        if (key === 'value') {
          result[key] = maskSensitiveValue(val, tagCode);
        } else {
          // list of nested tags — still walk so child tags are handled
          result[key] = walk(val, depth - 1);
        }
        continue;
      }

      if (val && typeof val === 'object') {
        result[key] = walk(val, depth - 1);
      } else if (typeof val === 'string') {
        result[key] = maskSensitivePatternsInString(val);
      } else {
        result[key] = val;
      }
    }

    return result;
  };

  return walk(payload, maxDepth);
}

/**
 * Drop-in replacement for telemetry-wrap's sanitisePayload.
 * Always returns an object (empty object for non-objects) for type compatibility.
 */
export function sanitisePayload(
  payload: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): object {
  const sanitised = sanitiseTelemetryPayload(payload, maxDepth);
  if (sanitised && typeof sanitised === 'object') {
    return sanitised as object;
  }
  if (typeof sanitised === 'string') {
    return { value: sanitised };
  }
  return {};
}
