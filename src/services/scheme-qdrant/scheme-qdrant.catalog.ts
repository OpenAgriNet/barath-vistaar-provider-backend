import { getStateDisplayName } from './scheme-registry';
import { SchemeSearchHit } from './scheme-query.util';

export type CatalogStatus =
  | 'success'
  | 'not_found'
  | 'scheme_unavailable'
  | 'failed'
  | 'error';

export interface BuildCatalogOptions {
  context: any;
  query: string;
  resolvedSchemeCode?: string | null;
  results: SchemeSearchHit[];
  status: CatalogStatus;
  message?: string;
}

/**
 * Build Beckn on_search catalog from Qdrant document chunks only.
 * No Hasura Content rows.
 */
export function buildSchemeQdrantOnSearch(options: BuildCatalogOptions) {
  const {
    context,
    query,
    resolvedSchemeCode,
    results,
    status,
    message = '',
  } = options;

  const items = results.map((hit, index) => {
    const section = hit.section || 'other';
    const sectionLabel =
      section.charAt(0).toUpperCase() + section.slice(1);
    const score = Number(hit.score) || 0;
    const schemeName = String(hit.scheme_name || '');
    const schemeCode = String(hit.scheme_code || '');
    const stateCode = String(hit.state_code || '');
    const stateName = getStateDisplayName(stateCode);
    const sourceLabel = stateName
      ? `${schemeName || schemeCode} (${stateName})`
      : schemeName || schemeCode;
    const text = String(hit.text || '');
    const id =
      String(hit.chunk_id || '') ||
      `${hit.doc_id || 'doc'}:${index}`;

    return {
      id,
      descriptor: {
        name: schemeName || schemeCode || 'Scheme Document Chunk',
        code: schemeCode,
        short_desc: `section=${sectionLabel} score=${score.toFixed(4)}`,
        long_desc: text,
      },
      tags: [
        {
          display: true,
          descriptor: {
            code: 'chunk-details',
            name: 'Chunk Details',
          },
          list: [
            {
              descriptor: { code: 'scheme_code', name: 'Scheme Code' },
              value: schemeCode,
              display: true,
            },
            {
              descriptor: { code: 'scheme_name', name: 'Scheme Name' },
              value: schemeName,
              display: true,
            },
            {
              descriptor: { code: 'state_code', name: 'State Code' },
              value: stateCode,
              display: true,
            },
            {
              descriptor: { code: 'source', name: 'Source' },
              value: sourceLabel,
              display: true,
            },
            {
              descriptor: { code: 'section', name: 'Section' },
              value: section,
              display: true,
            },
            {
              descriptor: { code: 'score', name: 'Score' },
              value: score.toFixed(4),
              display: true,
            },
            {
              descriptor: { code: 'doc_id', name: 'Document ID' },
              value: String(hit.doc_id || ''),
              display: true,
            },
            {
              descriptor: { code: 'chunk_id', name: 'Chunk ID' },
              value: String(hit.chunk_id || ''),
              display: true,
            },
            {
              descriptor: { code: 'text', name: 'Text' },
              value: text,
              display: true,
            },
          ],
        },
      ],
    };
  });

  const providers =
    items.length > 0
      ? [
          {
            id: 'scheme-documents',
            descriptor: {
              name: 'Scheme Document Index',
              short_desc: 'Qdrant-backed guideline document chunks',
              code: 'scheme-agri-qdrant',
            },
            items,
          },
        ]
      : [];

  return {
    context: {
      ...context,
      action: 'on_search',
      timestamp: new Date().toISOString(),
    },
    message: {
      catalog: {
        descriptor: {
          name: 'Scheme Document Search',
          code: 'scheme-agri-qdrant',
        },
        tags: [
          {
            descriptor: {
              code: 'search-context',
              name: 'Search Context',
            },
            list: [
              {
                descriptor: { code: 'query', name: 'Query' },
                value: query || '',
              },
              {
                descriptor: {
                  code: 'resolved-scheme-code',
                  name: 'Resolved Scheme Code',
                },
                value: resolvedSchemeCode || '',
              },
              {
                descriptor: { code: 'status', name: 'Status' },
                value: status,
              },
              {
                descriptor: { code: 'message', name: 'Message' },
                value: message,
              },
              {
                descriptor: { code: 'hit-count', name: 'Hit Count' },
                value: String(items.length),
              },
              {
                descriptor: { code: 'search-backend', name: 'Search Backend' },
                value: 'qdrant',
              },
            ],
          },
        ],
        providers,
      },
    },
  };
}
