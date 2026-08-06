/**
 * Pure query / ranking utilities for Qdrant scheme document search.
 * Ported from bharat-oan-api/helpers/scheme_qdrant_search.py — no Hasura.
 */

import { SchemeListItem } from './scheme-registry';

export interface SchemeSearchHit {
  score: number;
  scheme_code?: string;
  scheme_name?: string;
  text: string;
  doc_id?: string;
  chunk_id?: string;
  section?: string;
}

const ALIAS_STOPWORDS = new Set([
  'scheme',
  'schemes',
  'mission',
  'national',
  'programme',
  'program',
  'yojana',
  'yojna',
  'development',
  'fund',
  'for',
  'the',
  'and',
  'under',
  'government',
  'india',
  'ministry',
  'guidelines',
  'operational',
]);

const SCHEME_FOCUS_STOPWORDS = new Set([
  ...ALIAS_STOPWORDS,
  'what',
  'who',
  'how',
  'when',
  'where',
  'why',
  'which',
  'about',
  'farmer',
  'farmers',
  'criteria',
  'details',
  'information',
  'available',
  'tell',
  'explain',
  'know',
  'need',
  'want',
  'there',
  'this',
  'that',
]);

const FARMER_TERMS = [
  'farmer',
  'farmers',
  "farmer's",
  "farmers'",
  "farmers' groups",
  'farmer groups',
  'individual farmer',
  'all farmers',
  'small and marginal',
  'land holder',
  'cultivator',
  'for selection of areas',
  'for selection of areas/ farmers',
];

const HOW_TO_APPLY = 'how to apply';
const APPLICATION_PROCESS = 'application process';
const DOCUMENTS_REQUIRED = 'documents required';
const COST_NORM = 'cost norm';
const PATTERN_OF_ASSISTANCE = 'pattern of assistance';
const REGISTRATION_PROCESS = 'registration process';

const APPLICATION_CHUNK_TERMS = [
  HOW_TO_APPLY,
  APPLICATION_PROCESS,
  DOCUMENTS_REQUIRED,
  'registration',
];
const APPLICATION_RERANK_PHRASES = [
  HOW_TO_APPLY,
  APPLICATION_PROCESS,
  REGISTRATION_PROCESS,
  DOCUMENTS_REQUIRED,
  'online portal',
  'apply through',
];
const SUPPORT_CHUNK_TERMS = [
  'support',
  'subsidy',
  'assistance',
  'benefit',
  COST_NORM,
];
const SUBSIDY_QUERY_TERMS = ['subsidy', 'assistance', COST_NORM, 'how much'];
const SUPPORT_RERANK_TERMS = [
  'benefit',
  'subsidy',
  'assistance',
  'support',
  'incentive',
];

const HEADING_FARMER_ELIGIBILITY_MARKERS = [
  '# eligibility',
  '# eligible',
  '# criteria',
  '## eligibility',
  '## eligible',
  '## criteria',
];

const RE_HEADING_ELIGIBILITY =
  /#{1,6}\s+(?:eligibility|eligible criteria|who can apply)/i;
const RE_HEADING_EXCLUSION =
  /#{1,6}\s+(?:exclusion|scheme exclusion|who cannot apply)/i;
const RE_HEADING_SUPPORT =
  /#{1,6}\s+(?:benefits|support|pattern of assistance)/i;
const RE_NUMBERED_STEPS = /^\s*\d+[.)]\s/m;

const INTENT_TERMS: Record<string, string[]> = {
  eligibility: [
    'eligibility',
    'eligible',
    'am i eligible',
    'who can apply',
    'who is eligible',
    'qualify',
    'criteria',
    'qualifying',
    'for selection of',
  ],
  application: [
    HOW_TO_APPLY,
    APPLICATION_PROCESS,
    'application procedure',
    'application',
    'apply',
    'register',
    'registration',
    'portal',
    DOCUMENTS_REQUIRED,
    'how do i apply',
    'apply for',
    'procedure',
    'process',
  ],
  support: [
    'support',
    'financial support',
    'government support',
    'what support',
    'assistance',
    'financial assistance',
    'subsidy',
    'subsidies',
    'benefit',
    'benefits',
    'how much',
    'fund',
    'incentive',
    PATTERN_OF_ASSISTANCE,
    COST_NORM,
    'help available',
  ],
};

const EXCLUSION_TERMS = [
  'excluded',
  'exclusion',
  'who cannot apply',
  'who is excluded',
  'who are excluded',
  'not eligible',
  'ineligible',
  'cannot apply',
];

const QUERY_EXPANSIONS: Record<string, string> = {
  eligibility:
    'farmer beneficiary selection criteria who is eligible groups clusters scheme exclusion who cannot apply ineligible not eligible',
  exclusion:
    'scheme exclusion who cannot apply ineligible not eligible excluded',
  application: `${APPLICATION_PROCESS} registration portal ${DOCUMENTS_REQUIRED} ${HOW_TO_APPLY} apply online procedure steps`,
  support: `scheme benefits subsidy assistance financial support ${PATTERN_OF_ASSISTANCE} ${COST_NORM} incentive fund amount`,
};

const INTENT_SECTIONS: Record<string, string> = {
  support: 'support',
  application: 'application',
};

const INSTITUTIONAL_TERMS = [
  'regional council',
  'support agency',
  'implementing agency',
  'state government',
  'state/ut',
  'organisation/agency',
  'organization/agency',
  'steering committee',
  'executive committee',
  'district level executive',
  'state technical unit',
  'project management team',
  'state level executive',
  'technical assistant of agencies',
  'seed growers covered',
];

const APP_UI_NOISE_TERMS = [
  'click on',
  'logout',
  'offline record',
  'sync (offline',
  "registered farmer's list",
  'user manual',
  'app video guide',
  'language change',
  'my profile',
  'triple bar icon',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasInQuery(alias: string, query: string): boolean {
  const a = alias.toLowerCase().trim();
  if (!a) return false;
  if (a.length <= 6 || a.includes('-')) {
    return new RegExp(`\\b${escapeRegExp(a)}\\b`, 'i').test(query);
  }
  return query.includes(a);
}

export function resolveSchemeCode(
  query: string,
  schemeList: SchemeListItem[] = [],
): string | null {
  const q = query.toLowerCase();
  let bestLen = 0;
  let bestCode: string | null = null;

  for (const item of schemeList) {
    const candidates = [
      item.scheme_code,
      item.scheme_name,
      ...(item.scheme_aliases || []),
    ];
    for (const candidate of candidates) {
      const alias = String(candidate).toLowerCase().trim();
      if (!alias || ALIAS_STOPWORDS.has(alias)) continue;
      if (!aliasInQuery(alias, q)) continue;
      if (alias.length > bestLen) {
        bestLen = alias.length;
        bestCode = item.scheme_code;
      }
    }
  }
  return bestCode;
}

function stripIntentTerms(query: string): string {
  let cleaned = query.toLowerCase();
  for (const terms of Object.values(INTENT_TERMS)) {
    for (const term of [...terms].sort((a, b) => b.length - a.length)) {
      cleaned = cleaned.split(term).join(' ');
    }
  }
  for (const term of EXCLUSION_TERMS) {
    cleaned = cleaned.split(term).join(' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function queryNamesUnindexedScheme(
  query: string,
  schemeList: SchemeListItem[] = [],
): boolean {
  if (resolveSchemeCode(query, schemeList)) return false;
  const tokens = stripIntentTerms(query)
    .split(/[\s?,]+/)
    .filter((t) => t.length >= 3 && !SCHEME_FOCUS_STOPWORDS.has(t));
  return tokens.length > 0;
}

export function classifyQueryIntent(query: string): string | null {
  const q = query.toLowerCase();
  let bestIntent: string | null = null;
  let bestScore = 0;
  for (const [intent, terms] of Object.entries(INTENT_TERMS)) {
    const score = terms.reduce((n, term) => n + (q.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }
  return bestScore > 0 ? bestIntent : null;
}

export function classifySchemeSectionFocus(query: string): string | null {
  const q = query.toLowerCase();
  const hasEligibility = INTENT_TERMS.eligibility.some((t) => q.includes(t));
  const hasExclusion = EXCLUSION_TERMS.some((t) => q.includes(t));
  if (hasExclusion && !hasEligibility) return 'exclusion_only';
  if (hasEligibility) return 'eligibility_with_exclusion';
  return null;
}

export function expandQueryForSearch(
  query: string,
  intent?: string | null,
  sectionFocus?: string | null,
): string {
  const focus = sectionFocus ?? classifySchemeSectionFocus(query);
  if (focus === 'exclusion_only') {
    return `${query} ${QUERY_EXPANSIONS.exclusion}`;
  }
  const resolvedIntent = intent ?? classifyQueryIntent(query);
  if (resolvedIntent && QUERY_EXPANSIONS[resolvedIntent]) {
    return `${query} ${QUERY_EXPANSIONS[resolvedIntent]}`;
  }
  return query;
}

export function classifyChunkSection(text: string): string {
  const textL = text.toLowerCase();
  const sectionPatterns: Record<string, string[]> = {
    exclusion: [
      '#+\\s*scheme exclusion',
      '#+\\s*exclusion',
      'scheme exclusion',
      'who are excluded',
      'who cannot apply',
      'not eligible for',
      'ineligible',
    ],
    eligibility: [
      '#+\\s*scheme eligibility',
      '#+\\s*eligibility',
      'scheme eligibility',
      'who can apply',
      'who is eligible',
      'eligible criteria',
      'eligibility criteria',
    ],
    application: [
      `#+\\s*${escapeRegExp(APPLICATION_PROCESS)}`,
      `#+\\s*${escapeRegExp(HOW_TO_APPLY)}`,
      escapeRegExp(APPLICATION_PROCESS),
      escapeRegExp(HOW_TO_APPLY),
      escapeRegExp(DOCUMENTS_REQUIRED),
      escapeRegExp(REGISTRATION_PROCESS),
      'online portal',
    ],
    support: [
      '#+\\s*benefits',
      '#+\\s*support',
      'scheme benefits',
      escapeRegExp(PATTERN_OF_ASSISTANCE),
      'financial support',
      escapeRegExp(COST_NORM),
      'subsidy',
      'assistance to farmers',
    ],
  };

  const scores: Record<string, number> = {};
  for (const [section, patterns] of Object.entries(sectionPatterns)) {
    scores[section] = patterns.reduce(
      (n, p) => n + (new RegExp(p, 'i').test(textL) ? 1 : 0),
      0,
    );
  }
  const bestSection = Object.keys(scores).reduce((a, b) =>
    scores[a] >= scores[b] ? a : b,
  );
  if (scores[bestSection] > 0) {
    if (
      bestSection === 'exclusion' &&
      scores.exclusion <= scores.eligibility
    ) {
      return scores.eligibility > 0 ? 'eligibility' : 'exclusion';
    }
    return bestSection;
  }

  if (
    ['exclusion', 'excluded', 'cannot apply', 'ineligible'].some((t) =>
      textL.includes(t),
    )
  ) {
    return 'exclusion';
  }
  if (
    ['eligibility', 'eligible', 'who can apply'].some((t) => textL.includes(t))
  ) {
    return 'eligibility';
  }
  if (APPLICATION_CHUNK_TERMS.some((t) => textL.includes(t))) {
    return 'application';
  }
  if (SUPPORT_CHUNK_TERMS.some((t) => textL.includes(t))) {
    return 'support';
  }
  return 'other';
}

function resultKey(item: SchemeSearchHit, index: number): string {
  return String(item.chunk_id || '') || `idx-${index}`;
}

function tryAddItem(
  item: SchemeSearchHit,
  selected: SchemeSearchHit[],
  seen: Set<string>,
  index: number,
): boolean {
  const key = resultKey(item, index);
  if (seen.has(key)) return false;
  seen.add(key);
  selected.push(item);
  return true;
}

function fillSectionSlots(
  results: SchemeSearchHit[],
  section: string,
  slotCount: number,
  selected: SchemeSearchHit[],
  seen: Set<string>,
): void {
  let sectionCount = 0;
  results.forEach((item, index) => {
    if (sectionCount >= slotCount) return;
    if (item.section !== section) return;
    if (tryAddItem(item, selected, seen, index)) sectionCount += 1;
  });
}

function fillRemainingSlots(
  results: SchemeSearchHit[],
  topK: number,
  selected: SchemeSearchHit[],
  seen: Set<string>,
): void {
  results.forEach((item, index) => {
    if (selected.length >= topK) return;
    tryAddItem(item, selected, seen, index);
  });
}

function dedupeResults(results: SchemeSearchHit[]): SchemeSearchHit[] {
  const seen = new Set<string>();
  const deduped: SchemeSearchHit[] = [];
  results.forEach((item, index) => {
    const key = resultKey(item, index);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function takeBalanced(
  results: SchemeSearchHit[],
  sections: string[],
  topK: number,
): SchemeSearchHit[] {
  const slotCount = Math.max(Math.floor(topK / sections.length), 1);
  const selected: SchemeSearchHit[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    fillSectionSlots(results, section, slotCount, selected, seen);
  }
  fillRemainingSlots(results, topK, selected, seen);
  return selected.slice(0, topK);
}

export function finalizeResults(
  results: SchemeSearchHit[],
  sectionFocus: string | null,
  intent: string | null,
  topK: number,
): SchemeSearchHit[] {
  if (!results.length) return [];
  let list = dedupeResults(results);

  if (sectionFocus === 'exclusion_only') {
    const preferred = list.filter((r) => r.section === 'exclusion');
    const rest = list.filter((r) => r.section !== 'exclusion');
    return [...preferred, ...rest].slice(0, topK);
  }

  if (sectionFocus === 'eligibility_with_exclusion') {
    return takeBalanced(list, ['eligibility', 'exclusion'], topK);
  }

  const section = intent ? INTENT_SECTIONS[intent] : undefined;
  if (section) {
    const preferred = list.filter((r) => r.section === section);
    const rest = list.filter((r) => r.section !== section);
    return [...preferred, ...rest].slice(0, topK);
  }

  return list.slice(0, topK);
}

function chunkTableScore(text: string): number {
  const textL = text.toLowerCase();
  let score = 0;
  const pipeDensity = (text.match(/\|/g) || []).length / Math.max(text.length, 1);
  score += Math.min(pipeDensity * 10, 0.55);
  if (/rs\.?\s*\d/i.test(textL)) score += 0.12;
  if (
    textL.includes('/ha') ||
    textL.includes('per ha') ||
    textL.includes('per beneficiary')
  ) {
    score += 0.12;
  }
  if (textL.includes(COST_NORM) || textL.includes(PATTERN_OF_ASSISTANCE)) {
    score += 0.18;
  }
  if (textL.includes('annexure') && pipeDensity > 0.015) score += 0.08;
  return Math.min(score, 1.0);
}

function chunkInstitutionalScore(text: string): number {
  const textL = text.toLowerCase();
  const hits = INSTITUTIONAL_TERMS.reduce(
    (n, term) => n + (textL.includes(term) ? 1 : 0),
    0,
  );
  return Math.min(hits * 0.09, 0.45);
}

function chunkFarmerScore(text: string): number {
  const textL = text.toLowerCase();
  let hits = FARMER_TERMS.reduce(
    (n, term) => n + (textL.includes(term) ? 1 : 0),
    0,
  );
  if (
    textL.includes('farmer') &&
    HEADING_FARMER_ELIGIBILITY_MARKERS.some((m) => textL.includes(m))
  ) {
    hits += 2;
  }
  if (textL.includes('for selection of') && textL.includes('farmer')) {
    hits += 3;
  }
  if (textL.includes('3.3') && textL.includes('criteria') && text.includes('#')) {
    hits += 2;
  }
  return Math.min(hits * 0.07, 0.4);
}

function eligibilityRerankAdjustments(
  textL: string,
  instS: number,
  tableS: number,
): [number, number] {
  let bonus = 0;
  if (RE_HEADING_ELIGIBILITY.test(textL)) bonus += 0.1;
  if (RE_HEADING_EXCLUSION.test(textL)) bonus += 0.12;
  let adjInst = instS;
  if (
    textL.includes('regional council') &&
    textL.includes('eligible criteria')
  ) {
    adjInst += 0.35;
  }
  return [bonus, adjInst + tableS * 0.85];
}

function applicationRerankAdjustments(
  text: string,
  textL: string,
  instS: number,
  tableS: number,
): [number, number] {
  let bonus = 0;
  if (APPLICATION_RERANK_PHRASES.some((p) => textL.includes(p))) bonus += 0.18;
  if (RE_NUMBERED_STEPS.test(text)) bonus += 0.05;
  const uiNoise = APP_UI_NOISE_TERMS.reduce(
    (n, t) => n + (textL.includes(t) ? 1 : 0),
    0,
  );
  const penalty = instS * 0.6 + tableS * 0.45 + Math.min(uiNoise * 0.12, 0.45);
  return [bonus, penalty];
}

function supportRerankAdjustments(
  textL: string,
  instS: number,
  tableS: number,
  wantsSubsidyTables: boolean,
): [number, number] {
  let bonus = 0;
  if (SUPPORT_RERANK_TERMS.some((t) => textL.includes(t))) bonus += 0.12;
  if (RE_HEADING_SUPPORT.test(textL)) bonus += 0.1;
  let penalty = instS * 0.25;
  if (wantsSubsidyTables) bonus += tableS * 0.15;
  else penalty += tableS * 0.2;
  return [bonus, penalty];
}

function defaultRerankAdjustments(
  instS: number,
  tableS: number,
): [number, number] {
  return [0, instS * 0.25 + tableS * 0.25];
}

function rerankBonusPenalty(
  intent: string | null,
  text: string,
  textL: string,
  instS: number,
  tableS: number,
  wantsSubsidyTables: boolean,
): [number, number] {
  if (intent === 'eligibility') {
    return eligibilityRerankAdjustments(textL, instS, tableS);
  }
  if (intent === 'application') {
    return applicationRerankAdjustments(text, textL, instS, tableS);
  }
  if (intent === 'support') {
    return supportRerankAdjustments(textL, instS, tableS, wantsSubsidyTables);
  }
  return defaultRerankAdjustments(instS, tableS);
}

export function rerankResults(
  query: string,
  results: SchemeSearchHit[],
): SchemeSearchHit[] {
  if (!results.length) return results;

  const intent = classifyQueryIntent(query);
  const qLower = query.toLowerCase();
  const intentTerms = Object.values(INTENT_TERMS)
    .flat()
    .filter((term) => qLower.includes(term));
  const wantsSubsidyTables = SUBSIDY_QUERY_TERMS.some((t) =>
    qLower.includes(t),
  );

  return [...results].sort((a, b) => {
    const scoreOf = (item: SchemeSearchHit) => {
      const text = String(item.text || '');
      const textL = text.toLowerCase();
      const base = Number(item.score) || 0;
      const keywordHits = intentTerms.reduce(
        (n, term) => n + (textL.includes(term) ? 1 : 0),
        0,
      );
      const farmerS = chunkFarmerScore(text);
      const instS = chunkInstitutionalScore(text);
      const tableS = chunkTableScore(text);
      let bonus = 0.1 * keywordHits + farmerS;
      const [intentBonus, penalty] = rerankBonusPenalty(
        intent,
        text,
        textL,
        instS,
        tableS,
        wantsSubsidyTables,
      );
      return base + bonus + intentBonus - penalty;
    };
    return scoreOf(b) - scoreOf(a);
  });
}

/**
 * `knownSchemeCodes` is the live master_catalog registry. When it's empty
 * (registry not yet loaded / DB unreachable) this skips the allow-list check
 * rather than dropping every result — see SchemeCatalogService's fail-open
 * design.
 */
export function filterResultsByScheme(
  results: SchemeSearchHit[],
  schemeCode: string | null,
  knownSchemeCodes: Set<string> = new Set(),
): SchemeSearchHit[] {
  if (schemeCode) {
    return results.filter((r) => r.scheme_code === schemeCode);
  }
  if (knownSchemeCodes.size === 0) {
    return results;
  }
  return results.filter(
    (r) => r.scheme_code && knownSchemeCodes.has(r.scheme_code),
  );
}

export function isKnownSchemeCode(
  code: string | null | undefined,
  knownSchemeCodes: Set<string>,
): boolean {
  if (!code) return false;
  return knownSchemeCodes.has(code.toLowerCase());
}
