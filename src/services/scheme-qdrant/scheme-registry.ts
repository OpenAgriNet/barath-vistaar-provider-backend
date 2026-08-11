/**
 * Shared types/constants for Qdrant scheme document search.
 *
 * The scheme code/name/alias registry itself is NOT hardcoded here — it's
 * loaded live from docs-pipeline's `master_catalog` Postgres table via
 * SchemeCatalogService, so a newly ingested + promoted scheme becomes
 * resolvable without a redeploy of this service.
 */

export interface SchemeListItem {
  scheme_code: string;
  scheme_name: string;
  scheme_aliases: string[];
}

export const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-large';
export const DEFAULT_COLLECTION = 'schemes-index';
export const CATEGORY_CODE_SCHEME_AGRI_QDRANT = 'scheme-agri-qdrant';

/**
 * Mirrors docs-pipeline's DEFAULT_STATE_CODES (pipeline/auth/keycloak_admin.py).
 * `bv` is not a real state — it's docs-pipeline's PORTAL_INSTANCE for
 * Bharat Vistaar platform-wide documents (pipeline/auth/tenancy.py).
 */
const STATE_NAME_BY_CODE: Record<string, string> = {
  BV: 'Bharat Vistaar',
  MH: 'Maharashtra',
  BH: 'Bihar',
  UP: 'Uttar Pradesh',
  GJ: 'Gujarat',
  RJ: 'Rajasthan',
  MP: 'Madhya Pradesh',
  KA: 'Karnataka',
  TS: 'Telangana',
  AP: 'Andhra Pradesh',
  TN: 'Tamil Nadu',
  WB: 'West Bengal',
  OR: 'Odisha',
  PB: 'Punjab',
  HR: 'Haryana',
  KL: 'Kerala',
  AS: 'Assam',
  JH: 'Jharkhand',
  CG: 'Chhattisgarh',
  UK: 'Uttarakhand',
  HP: 'Himachal Pradesh',
  GA: 'Goa',
  DL: 'Delhi',
  JK: 'Jammu and Kashmir',
  LA: 'Ladakh',
};

/** Full display name for a state_code, falling back to the raw code if unmapped. */
export function getStateDisplayName(stateCode?: string | null): string {
  const key = String(stateCode || '').trim().toUpperCase();
  if (!key) return '';
  return STATE_NAME_BY_CODE[key] || key;
}