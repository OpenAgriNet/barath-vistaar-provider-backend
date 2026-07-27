import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DEFAULT_EMBEDDING_MODEL } from './scheme-registry';

/**
 * HTTP client for E5-compatible embeddings.
 * Index vectors use intfloat/multilingual-e5-large with "query: " prefix.
 * Does NOT call Hasura — vector path only.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  private getBaseUrl(): string {
    return (
      process.env.EMBEDDING_SERVICE_URL ||
      process.env.SCHEME_EMBEDDING_URL ||
      ''
    ).replace(/\/$/, '');
  }

  private getModel(): string {
    return (
      process.env.EMBEDDING_MODEL ||
      process.env.SCHEME_EMBEDDING_MODEL ||
      DEFAULT_EMBEDDING_MODEL
    );
  }

  private getTimeoutMs(): number {
    const raw = process.env.EMBEDDING_TIMEOUT_MS || '15000';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 15000;
  }

  isConfigured(): boolean {
    return Boolean(this.getBaseUrl());
  }

  /**
   * Embed a search query. Applies E5 "query: " prefix when missing.
   */
  async embedQuery(query: string): Promise<number[]> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new Error(
        'EMBEDDING_SERVICE_URL is not configured for scheme-agri-qdrant vector search',
      );
    }

    const prefixed = query.startsWith('query:')
      ? query
      : `query: ${query}`;

    const url = `${baseUrl}/embed`;
    this.logger.log(
      `[scheme-qdrant] Embedding query via ${url} model=${this.getModel()}`,
    );

    const response = await axios.post(
      url,
      {
        texts: [prefixed],
        text: prefixed,
        inputs: [prefixed],
        model: this.getModel(),
        prefix: 'query',
      },
      {
        timeout: this.getTimeoutMs(),
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Embedding service returned HTTP ${response.status}: ${JSON.stringify(
          response.data,
        ).slice(0, 300)}`,
      );
    }

    const vector = this.extractVector(response.data);
    if (!vector?.length) {
      throw new Error('Embedding service returned empty vector');
    }
    return vector;
  }

  private extractVector(data: any): number[] | null {
    if (!data) return null;

    // { embeddings: [[...]] }
    if (Array.isArray(data.embeddings?.[0])) {
      return data.embeddings[0].map(Number);
    }
    // { embedding: [...] }
    if (Array.isArray(data.embedding)) {
      return data.embedding.map(Number);
    }
    // { data: [{ embedding: [...] }] } OpenAI-style
    if (Array.isArray(data.data?.[0]?.embedding)) {
      return data.data[0].embedding.map(Number);
    }
    // TEI: [[...]] or [...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map(Number);
    }
    if (Array.isArray(data) && typeof data[0] === 'number') {
      return data.map(Number);
    }
    // { vectors: [[...]] }
    if (Array.isArray(data.vectors?.[0])) {
      return data.vectors[0].map(Number);
    }

    return null;
  }
}
