import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { QdrantClientService } from './qdrant.client';
import { buildSchemeQdrantOnSearch } from './scheme-qdrant.catalog';
import { getBuiltinSchemeList } from './scheme-registry';
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
  ) {}

  async search(body: any): Promise<any> {
    const context = body?.context || {};
    const started = Date.now();

    const { query, schemeCodeHint, topK } = this.parseIntent(body);

    if (!query?.trim()) {
      this.logger.warn('[scheme-qdrant] Missing query in intent');
      return buildSchemeQdrantOnSearch({
        context,
        query: '',
        results: [],
        status: 'failed',
        message: 'Missing search query (item.descriptor.name or search_params.query)',
      });
    }

    if (!this.qdrantClient.isConfigured()) {
      this.logger.error('[scheme-qdrant] QDRANT_URL not configured');
      return buildSchemeQdrantOnSearch({
        context,
        query,
        results: [],
        status: 'error',
        message: 'Qdrant is not configured on the provider',
      });
    }

    if (!this.embeddingService.isConfigured()) {
      this.logger.error('[scheme-qdrant] EMBEDDING_SERVICE_URL not configured');
      return buildSchemeQdrantOnSearch({
        context,
        query,
        results: [],
        status: 'error',
        message: 'Embedding service is not configured on the provider',
      });
    }

    try {
      const schemeList = getBuiltinSchemeList();
      let schemeCode: string | null = null;

      if (schemeCodeHint && isKnownSchemeCode(schemeCodeHint)) {
        schemeCode = schemeCodeHint.toLowerCase();
      } else {
        schemeCode = resolveSchemeCode(query, schemeList);
      }

      if (
        !schemeCode &&
        queryNamesUnindexedScheme(query, schemeList)
      ) {
        this.logger.log(
          `[scheme-qdrant] Query names scheme outside index: ${JSON.stringify(
            query,
          )}`,
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

      this.logger.log(
        `[scheme-qdrant] query=${JSON.stringify(query)} scheme=${
          schemeCode || '(auto)'
        } intent=${intent || '-'} focus=${sectionFocus || '-'} topK=${topK}`,
      );

      const queryVector = await this.embeddingService.embedQuery(expanded);
      let results = await this.qdrantClient.querySchemePoints(queryVector, {
        schemeCode,
        limit: fetchK,
      });

      // Supplemental search when intent needs a missing section
      const supplemental = this.supplementalSearchConfig(sectionFocus, intent);
      if (supplemental) {
        results = await this.mergeSupplemental(
          query,
          results,
          supplemental,
          schemeCode,
          fetchK,
        );
      }

      results = filterResultsByScheme(results, schemeCode);
      results = rerankResults(query, results);
      results = finalizeResults(results, sectionFocus, intent, topK);

      const elapsed = Date.now() - started;
      this.logger.log(
        `[scheme-qdrant] done hits=${results.length} elapsedMs=${elapsed}`,
      );

      if (!results.length) {
        return buildSchemeQdrantOnSearch({
          context,
          query,
          resolvedSchemeCode: schemeCode,
          results: [],
          status: schemeCode ? 'not_found' : 'scheme_unavailable',
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
        `[scheme-qdrant] search failed: ${err?.message || err}`,
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
    let topK = 10;

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
