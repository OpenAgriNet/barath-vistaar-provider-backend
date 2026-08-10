import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { QdrantClientService } from './qdrant.client';
import { buildSchemeQdrantOnSearch } from './scheme-qdrant.catalog';
import { SchemeCatalogService } from './scheme-catalog.service';
import {
  classifyQueryIntent,
  classifySchemeSectionFocus,
  expandQueryForSearch,
  filterResultsByScheme,
  finalizeResults,
  isKnownSchemeCode,
  queryNamesUnindexedScheme,
  rerankResults,
  resolveSchemeCode,
  SchemeSearchHit,
} from './scheme-query.util';

/**
 * Vector-only scheme document search (Qdrant).
 *
 * IMPORTANT: This path does NOT use Hasura / Postgres Content.
 * Structured Hasura scheme lookup remains on category code `schemes-agri`.
 * This service is only for `scheme-agri-qdrant`.
 */
@Injectable()
export class SchemeQdrantService {
  private readonly logger = new Logger(SchemeQdrantService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantClient: QdrantClientService,
    private readonly schemeCatalog: SchemeCatalogService,
  ) {}

  async search(body: any): Promise<any> {
    const context = body?.context || {};
    const txn = context.transaction_id || context.message_id || '-';
    const started = Date.now();

    const { query, schemeCodeHint, topK } = this.parseIntent(body);

    this.logger.log(
      `[scheme-qdrant] → txn=${txn} query=${JSON.stringify(query)} schemeHint=${
        schemeCodeHint || '-'
      } topK=${topK}`,
    );

    if (!query?.trim()) {
      this.logger.warn(`[scheme-qdrant] ← txn=${txn} status=failed reason=missing_query`);
      return buildSchemeQdrantOnSearch({
        context,
        query: '',
        results: [],
        status: 'failed',
        message: 'Missing search query (item.descriptor.name or search_params.query)',
      });
    }

    if (!this.qdrantClient.isConfigured()) {
      this.logger.error(`[scheme-qdrant] ← txn=${txn} status=error reason=qdrant_not_configured`);
      return buildSchemeQdrantOnSearch({
        context,
        query,
        results: [],
        status: 'error',
        message: 'Qdrant is not configured on the provider',
      });
    }

    if (!this.embeddingService.isConfigured()) {
      this.logger.error(
        `[scheme-qdrant] ← txn=${txn} status=error reason=embedding_not_configured`,
      );
      return buildSchemeQdrantOnSearch({
        context,
        query,
        results: [],
        status: 'error',
        message:
          'Embedding is not configured on the provider (local JS model via HF_HOME, or EMBEDDING_SERVICE_URL)',
      });
    }

    try {
      const schemeList = this.schemeCatalog.getSchemeList();
      const knownSchemeCodes = this.schemeCatalog.getKnownSchemeCodes();
      let schemeCode: string | null = null;
      let schemeSource: 'hint' | 'resolved' | 'auto' = 'auto';

      if (schemeCodeHint && isKnownSchemeCode(schemeCodeHint, knownSchemeCodes)) {
        schemeCode = schemeCodeHint.toLowerCase();
        schemeSource = 'hint';
      } else {
        schemeCode = resolveSchemeCode(query, schemeList);
        if (schemeCode) schemeSource = 'resolved';
      }

      if (schemeCodeHint && schemeSource !== 'hint') {
        this.logger.debug(
          `[scheme-qdrant] txn=${txn} schemeHint=${schemeCodeHint} not in registry(size=${knownSchemeCodes.size}); falling back to query resolution`,
        );
      }

      // Only short-circuit when the registry is actually loaded — an empty
      // registry (master_catalog unreachable) must not be read as "no scheme
      // matches", or every query would wrongly resolve to scheme_unavailable.
      if (
        !schemeCode &&
        schemeList.length > 0 &&
        queryNamesUnindexedScheme(query, schemeList)
      ) {
        this.logger.log(
          `[scheme-qdrant] ← txn=${txn} status=scheme_unavailable reason=query_names_unindexed_scheme elapsedMs=${
            Date.now() - started
          }`,
        );
        return buildSchemeQdrantOnSearch({
          context,
          query,
          resolvedSchemeCode: null,
          results: [],
          status: 'scheme_unavailable',
          message: 'Scheme not available in the document index',
        });
      }

      const intent = classifyQueryIntent(query);
      const sectionFocus = classifySchemeSectionFocus(query);
      const expanded = expandQueryForSearch(query, intent, sectionFocus);
      const fetchK = Math.max(topK * 8, 40);

      const queryVector = await this.embeddingService.embedQuery(expanded);
      let results = await this.qdrantClient.querySchemePoints(queryVector, {
        schemeCode,
        limit: fetchK,
      });

      // The resolved scheme_code may not match what's actually tagged on
      // ingested chunks (registry/payload drift). Rather than returning
      // nothing, fall back to searching by the query text alone across all
      // scheme documents so a relevant answer still comes back.
      let effectiveSchemeCode = schemeCode;
      if (!results.length && schemeCode) {
        this.logger.warn(
          `[scheme-qdrant] txn=${txn} no hits for scheme_code=${schemeCode}; retrying unfiltered by query`,
        );
        results = await this.qdrantClient.querySchemePoints(queryVector, {
          limit: fetchK,
        });
        effectiveSchemeCode = null;
      }

      // Supplemental search when intent needs a missing section
      const supplemental = this.supplementalSearchConfig(sectionFocus, intent);
      if (supplemental) {
        const before = results.length;
        results = await this.mergeSupplemental(
          query,
          results,
          supplemental,
          effectiveSchemeCode,
          fetchK,
        );
        if (results.length > before) {
          this.logger.debug(
            `[scheme-qdrant] txn=${txn} supplemental=${supplemental.neededSection} addedHits=${
              results.length - before
            }`,
          );
        }
      }

      results = filterResultsByScheme(results, effectiveSchemeCode, knownSchemeCodes);
      results = rerankResults(query, results);
      results = finalizeResults(results, sectionFocus, intent, topK);

      const elapsed = Date.now() - started;
      const status = results.length ? 'success' : schemeCode ? 'not_found' : 'scheme_unavailable';

      this.logger.log(
        `[scheme-qdrant] ← txn=${txn} scheme=${schemeCode || 'auto'}(${schemeSource}) effectiveScheme=${
          effectiveSchemeCode || 'auto'
        } intent=${
          intent || '-'
        } focus=${sectionFocus || '-'} hits=${results.length} status=${status} elapsedMs=${elapsed}`,
      );

      if (!results.length) {
        return buildSchemeQdrantOnSearch({
          context,
          query,
          resolvedSchemeCode: schemeCode,
          results: [],
          status,
          message: schemeCode
            ? 'Could not find this information in the document index'
            : 'Scheme not available in the document index',
        });
      }

      return buildSchemeQdrantOnSearch({
        context,
        query,
        resolvedSchemeCode: schemeCode,
        results,
        status: 'success',
      });
    } catch (err: any) {
      this.logger.error(
        `[scheme-qdrant] ← txn=${txn} status=error elapsedMs=${Date.now() - started} err=${
          err?.message || err
        }`,
        err?.stack,
      );
      return buildSchemeQdrantOnSearch({
        context,
        query,
        results: [],
        status: 'error',
        message: err?.message || 'Vector search failed',
      });
    }
  }

  private getDefaultTopK(): number {
    const raw = process.env.SCHEME_QDRANT_DEFAULT_TOP_K;
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }

  private parseIntent(body: any): {
    query: string;
    schemeCodeHint: string | null;
    topK: number;
  } {
    const intent = body?.message?.intent;
    const item = intent?.item;
    const descriptor = item?.descriptor || {};

    let query = String(descriptor.name || '').trim();
    let schemeCodeHint = String(descriptor.code || '').trim() || null;
    let topK = this.getDefaultTopK();

    const tags: any[] = Array.isArray(item?.tags) ? item.tags : [];
    for (const tag of tags) {
      const code = String(tag?.descriptor?.code || '').toLowerCase();
      if (code !== 'search_params' && code !== 'search-params') continue;
      const list: any[] = Array.isArray(tag?.list) ? tag.list : [];
      for (const entry of list) {
        const entryCode = String(
          entry?.descriptor?.code || entry?.name || '',
        ).toLowerCase();
        const value = String(entry?.value ?? '').trim();
        if (!value) continue;
        if (entryCode === 'query' || entryCode === 'search_value') {
          if (!query) query = value;
        } else if (entryCode === 'scheme_code' || entryCode === 'scheme-code') {
          if (!schemeCodeHint) schemeCodeHint = value;
        } else if (entryCode === 'top_k' || entryCode === 'topk') {
          const n = parseInt(value, 10);
          if (Number.isFinite(n)) topK = n;
        }
      }
    }

    // Clamp top_k
    topK = Math.min(Math.max(topK, 1), 20);

    // If name looks like a bare scheme code and code empty, allow resolve via query
    return { query, schemeCodeHint, topK };
  }

  private supplementalSearchConfig(
    sectionFocus: string | null,
    intent: string | null,
  ): { neededSection: string; expansionKey: string } | null {
    if (sectionFocus === 'eligibility_with_exclusion') {
      return { neededSection: 'exclusion', expansionKey: 'exclusion' };
    }
    if (intent === 'support') {
      return { neededSection: 'support', expansionKey: 'support' };
    }
    if (intent === 'application') {
      return { neededSection: 'application', expansionKey: 'application' };
    }
    return null;
  }

  private async mergeSupplemental(
    query: string,
    results: SchemeSearchHit[],
    supplemental: { neededSection: string; expansionKey: string },
    schemeCode: string | null,
    fetchK: number,
  ): Promise<SchemeSearchHit[]> {
    if (results.some((r) => r.section === supplemental.neededSection)) {
      return results;
    }

    const expansions: Record<string, string> = {
      exclusion:
        'scheme exclusion who cannot apply ineligible not eligible excluded',
      application:
        'application process registration portal documents required how to apply apply online procedure steps',
      support:
        'scheme benefits subsidy assistance financial support pattern of assistance cost norm incentive fund amount',
    };
    const expansion = expansions[supplemental.expansionKey] || '';
    const extraQuery = `${query} ${expansion}`.trim();
    const extraVector = await this.embeddingService.embedQuery(extraQuery);
    const extraHits = await this.qdrantClient.querySchemePoints(extraVector, {
      schemeCode,
      limit: fetchK,
    });

    const seen = new Set(
      results.map((r, i) => String(r.chunk_id || '') || `i-${i}`),
    );
    const merged = [...results];
    extraHits.forEach((hit, i) => {
      const key = String(hit.chunk_id || '') || `extra-${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(hit);
    });
    return merged;
  }
}
