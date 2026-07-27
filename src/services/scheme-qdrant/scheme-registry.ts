/**
 * Qdrant scheme registry — codes must match payload.scheme_code in schemes-index.
 * Ported from bharat-oan-api/helpers/scheme_qdrant_search.py
 */

export interface SchemeDefinition {
  scheme_name: string;
  scheme_aliases: string[];
}

export interface SchemeListItem {
  scheme_code: string;
  scheme_name: string;
  scheme_aliases: string[];
}

export const QDRANT_SCHEME_DEFINITIONS: Record<string, SchemeDefinition> = {
  cdp: {
    scheme_name: 'Crop Diversification Programme',
    scheme_aliases: [
      'CDP',
      'crop diversification',
      'crop diversification programme',
      'crop diversification program',
      'Crop Diversification Program',
    ],
  },
  'cotton-mission': {
    scheme_name: 'Cotton Mission',
    scheme_aliases: [
      'cotton mission',
      'cotton scheme',
      'nfsm cotton',
      'NFSM Cotton',
    ],
  },
  'e-nam': {
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
  makhana: {
    scheme_name: 'Central Sector Scheme for Development of Makhana',
    scheme_aliases: [
      'makhana',
      'makana',
      'foxnut',
      'horticulture makhana',
      'makhana scheme',
      'development of makhana',
    ],
  },
  midh: {
    scheme_name: 'Mission for Integrated Development of Horticulture',
    scheme_aliases: [
      'MIDH',
      'horticulture mission',
      'krishonnati horticulture',
      'national horticulture mission',
      'integrated development of horticulture',
    ],
  },
  mif: {
    scheme_name: 'Micro Irrigation Fund',
    scheme_aliases: [
      'MIF',
      'micro irrigation fund',
      'Micro Irrigation Fund scheme',
    ],
  },
  nbm: {
    scheme_name: 'National Bamboo Mission',
    scheme_aliases: [
      'NBM',
      'national bamboo mission',
      'bamboo mission',
      'national bamboo',
    ],
  },
  nmeo: {
    scheme_name: 'National Mission on Edible Oils – Oilseeds',
    scheme_aliases: [
      'NMEO',
      'NMEO-OS',
      'NMEO OS',
      'oilseeds mission',
      'nmoe',
      'national mission on edible oils',
      'edible oils oilseeds',
    ],
  },
  pkvy: {
    scheme_name: 'Paramparagat Krishi Vikas Yojana',
    scheme_aliases: [
      'PKVY',
      'paramparagat krishi vikas yojana',
      'paramparagat krishi',
      'organic farming scheme',
    ],
  },
  'pm-ddky': {
    scheme_name: 'Prime Minister Dhan–Dhaanya Krishi Yojana',
    scheme_aliases: [
      'PM-DDKY',
      'PM DDKY',
      'pm ddky',
      'dhan-dhaanya krishi yojana',
      'dhan dhaanya krishi yojana',
      'dhan-dhaanya',
      'dhan dhaanya',
      'PM Dhan Dhaanya Krishi Yojana',
    ],
  },
  'pm-kmy': {
    scheme_name: 'Pradhan Mantri Kisan Maandhan Yojana',
    scheme_aliases: [
      'PM-KMY',
      'PMKMY',
      'pm kmy',
      'Kisan Maandhan Yojana',
      'Kisan Mandhan Yojana',
      'kisan mandhan',
      'PMKMY Yojana',
    ],
  },
  'pm-rkvy': {
    scheme_name: 'Pradhan Mantri Rashtriya Krishi Vikas Yojana',
    scheme_aliases: [
      'PM-RKVY',
      'PM RKVY',
      'pm rkvy',
      'RKVY',
      'rashtriya krishi vikas',
      'rashtriya krishi vikas yojana',
    ],
  },
  'pulses-mission': {
    scheme_name: 'Mission for Aatmanirbharta in Pulses',
    scheme_aliases: [
      'pulses mission',
      'pulses scheme',
      'nfsm pulses',
      'aatmanirbharta in pulses',
      'mission for aatmanirbharta in pulses',
      'aatmanirbharta pulses mission',
      'National Food Security Mission – Pulses',
    ],
  },
  rwbcis: {
    scheme_name: 'Restructured Weather Based Crop Insurance Scheme',
    scheme_aliases: [
      'RWBCIS',
      'weather based crop insurance',
      'weather insurance',
      'weather based crop insurance scheme',
    ],
  },
};

export const QDRANT_SCHEME_CODES = new Set(
  Object.keys(QDRANT_SCHEME_DEFINITIONS),
);

export function getBuiltinSchemeList(): SchemeListItem[] {
  return Object.entries(QDRANT_SCHEME_DEFINITIONS).map(([code, def]) => ({
    scheme_code: code,
    scheme_name: def.scheme_name,
    scheme_aliases: [...def.scheme_aliases],
  }));
}

export const SCHEME_SEARCH_SOURCE = 'Government Scheme Information';
export const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-large';
export const DEFAULT_COLLECTION = 'schemes-index';
export const CATEGORY_CODE_SCHEME_AGRI_QDRANT = 'scheme-agri-qdrant';
