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

export const SCHEME_SEARCH_SOURCE = 'Government Scheme Information';
export const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-large';
export const DEFAULT_COLLECTION = 'schemes-index';
export const CATEGORY_CODE_SCHEME_AGRI_QDRANT = 'scheme-agri-qdrant';