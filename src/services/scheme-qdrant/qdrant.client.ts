import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DEFAULT_COLLECTION } from './scheme-registry';
import { SchemeSearchHit, classifyChunkSection } from './scheme-query.util';

/**
 * Qdrant REST client for scheme document vector search only.
 * No Hasura / Postgres involvement.
 */
@Injectable()
export class QdrantClientService {
  private readonly logger = new Logger(QdrantClientService.name);

  private getUrl(): string {
    return (process.env.QDRANT_URL || '').replace(/\/$/, '');
  }

  private getApiKey(): string {
    return process.env.QDRANT_API_KEY || '';
  }

  getCollectionName(): string {
    return (
      process.env.QDRANT_COLLECTION_NAME ||
      process.env.QDRANT_SCHEME_COLLECTION ||
      DEFAULT_COLLECTION
    );
  }

  private getTimeoutMs(): number {
    const raw = process.env.QDRANT_TIMEOUT_MS || '15000';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 15000;
  }

  isConfigured(): boolean {
    return Boolean(this.getUrl());
  }

  /**
   * Dense vector search with type=scheme filter and optional scheme_code.
   */
  async querySchemePoints(
    vector: number[],
    options: {
      schemeCode?: string | null;
      limit?: number;
      collectionName?: string;
    } = {},
  ): Promise<SchemeSearchHit[]> {
    const baseUrl = this.getUrl();
    if (!baseUrl) {
      throw new Error('QDRANT_URL is not configured for scheme-agri-qdrant');
    }

    const collection = options.collectionName || this.getCollectionName();
    const limit = options.limit ?? 40;

    const must: any[] = [
      { key: 'type', match: { value: 'scheme' } },
    ];
    if (options.schemeCode) {
      must.push({
        key: 'scheme_code',
        match: { value: options.schemeCode },
      });
    }

    const url = `${baseUrl}/collections/${encodeURIComponent(
      collection,
    )}/points/query`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.getApiKey();
    if (apiKey) {
      headers['api-key'] = apiKey;
    }

    this.logger.log(
      `[scheme-qdrant] Qdrant query collection=${collection} limit=${limit} scheme_code=${
        options.schemeCode || '(any)'
      }`,
    );

    const response = await axios.post(
      url,
      {
        query: vector,
        filter: { must },
        limit,
        with_payload: true,
      },
      {
        headers,
        timeout: this.getTimeoutMs(),
        validateStatus: () => true,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Qdrant query failed HTTP ${response.status}: ${JSON.stringify(
          response.data,
        ).slice(0, 400)}`,
      );
    }

    const points =
      response.data?.result?.points ??
      response.data?.result ??
      response.data?.points ??
      [];

    if (!Array.isArray(points)) {
      this.logger.warn('[scheme-qdrant] Unexpected Qdrant response shape');
      return [];
    }

    return points.map((hit: any) => this.hitToResult(hit));
  }

  private hitToResult(hit: any): SchemeSearchHit {
    const payload = hit?.payload || {};
    const text = String(payload.text ?? '');
    return {
      score: Number(hit?.score ?? 0),
      scheme_code: payload.scheme_code,
      scheme_name: payload.scheme_name,
      text,
      doc_id: payload.doc_id,
      chunk_id: payload.chunk_id,
      section: classifyChunkSection(text),
    };
  }
}
