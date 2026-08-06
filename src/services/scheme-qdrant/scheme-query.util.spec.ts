import {
  classifyQueryIntent,
  classifySchemeSectionFocus,
  expandQueryForSearch,
  finalizeResults,
  isKnownSchemeCode,
  resolveSchemeCode,
  SchemeSearchHit,
} from './scheme-query.util';
import { buildSchemeQdrantOnSearch } from './scheme-qdrant.catalog';
import { SchemeListItem } from './scheme-registry';

const TEST_SCHEME_LIST: SchemeListItem[] = [
  {
    scheme_code: 'mif',
    scheme_name: 'Micro Irrigation Fund',
    scheme_aliases: ['MIF', 'micro irrigation fund', 'Micro Irrigation Fund scheme'],
  },
  {
    scheme_code: 'e-nam',
    scheme_name: 'Electronic National Agriculture Market',
    scheme_aliases: [
      'e-NAM',
      'eNAM',
      'enam',
      'national agriculture market',
      'electronic nam',
      'electronic national agriculture market',
    ],
  },
];
const TEST_SCHEME_CODES = new Set(TEST_SCHEME_LIST.map((s) => s.scheme_code));

describe('scheme-query.util (vector path only)', () => {
  it('resolves MIF alias to mif', () => {
    expect(resolveSchemeCode('Micro Irrigation Fund eligibility', TEST_SCHEME_LIST)).toBe('mif');
    expect(resolveSchemeCode('what is MIF subsidy', TEST_SCHEME_LIST)).toBe('mif');
  });

  it('resolves e-NAM aliases', () => {
    expect(resolveSchemeCode('eNAM registration process', TEST_SCHEME_LIST)).toBe('e-nam');
    expect(
      resolveSchemeCode('electronic national agriculture market', TEST_SCHEME_LIST),
    ).toBe('e-nam');
  });

  it('classifies eligibility intent and section focus', () => {
    expect(classifyQueryIntent('who is eligible for MIF')).toBe('eligibility');
    expect(classifySchemeSectionFocus('who is eligible for MIF')).toBe(
      'eligibility_with_exclusion',
    );
    expect(classifySchemeSectionFocus('who cannot apply for MIF')).toBe(
      'exclusion_only',
    );
  });

  it('expands eligibility queries', () => {
    const expanded = expandQueryForSearch('MIF eligibility');
    expect(expanded.toLowerCase()).toContain('eligibility');
    expect(expanded.length).toBeGreaterThan('MIF eligibility'.length);
  });

  it('recognizes known scheme codes only from registry', () => {
    expect(isKnownSchemeCode('mif', TEST_SCHEME_CODES)).toBe(true);
    expect(isKnownSchemeCode('pmkisan', TEST_SCHEME_CODES)).toBe(false);
  });

  it('finalizes eligibility_with_exclusion with balanced sections', () => {
    const results: SchemeSearchHit[] = [
      { score: 0.9, text: 'a', section: 'eligibility', chunk_id: '1' },
      { score: 0.8, text: 'b', section: 'eligibility', chunk_id: '2' },
      { score: 0.7, text: 'c', section: 'exclusion', chunk_id: '3' },
      { score: 0.6, text: 'd', section: 'other', chunk_id: '4' },
    ];
    const out = finalizeResults(results, 'eligibility_with_exclusion', null, 2);
    expect(out.length).toBe(2);
    const sections = out.map((r) => r.section);
    expect(sections).toContain('eligibility');
    expect(sections).toContain('exclusion');
  });
});

describe('scheme-qdrant.catalog', () => {
  it('builds on_search with chunk items and no Hasura fields', () => {
    const response = buildSchemeQdrantOnSearch({
      context: {
        domain: 'schemes:vistaar',
        action: 'search',
        transaction_id: 't1',
        message_id: 'm1',
      },
      query: 'MIF eligibility',
      resolvedSchemeCode: 'mif',
      status: 'success',
      results: [
        {
          score: 0.81,
          scheme_code: 'mif',
          scheme_name: 'Micro Irrigation Fund',
          text: 'Farmers with land holdings ...',
          doc_id: 'doc1',
          chunk_id: 'chunk1',
          section: 'eligibility',
        },
      ],
    });

    expect(response.context.action).toBe('on_search');
    expect(response.message.catalog.descriptor.code).toBe('scheme-agri-qdrant');
    expect(response.message.catalog.providers).toHaveLength(1);
    expect(response.message.catalog.providers[0].items).toHaveLength(1);
    expect(
      response.message.catalog.providers[0].items[0].tags[0].descriptor.code,
    ).toBe('chunk-details');

    const backend = response.message.catalog.tags[0].list.find(
      (x: any) => x.descriptor.code === 'search-backend',
    );
    expect(backend.value).toBe('qdrant');
  });

  it('returns empty providers on scheme_unavailable', () => {
    const response = buildSchemeQdrantOnSearch({
      context: { action: 'search' },
      query: 'unknown scheme',
      results: [],
      status: 'scheme_unavailable',
      message: 'Scheme not available in the document index',
    });
    expect(response.message.catalog.providers).toEqual([]);
    const status = response.message.catalog.tags[0].list.find(
      (x: any) => x.descriptor.code === 'status',
    );
    expect(status.value).toBe('scheme_unavailable');
  });
});
