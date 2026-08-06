import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import axios from 'axios';
import { DEFAULT_EMBEDDING_MODEL } from './scheme-registry';

/** ONNX build used by Transformers.js (same architecture as intfloat e5-large). */
const DEFAULT_JS_MODEL = 'Xenova/multilingual-e5-large';

type FeatureExtractor = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims?: number[] } | number[][]>;

/**
 * Embeddings for scheme-agri-qdrant — pure JS (no Python).
 *
 * Primary: @huggingface/transformers (Transformers.js) loads E5 locally.
 * Optional: HTTP POST {EMBEDDING_SERVICE_URL}/embed if EMBEDDING_MODE=http.
 *
 * Env (local JS, same idea as oan-api):
 *   HF_HOME=/opt/hf-cache          # cache dir for model files
 *   EMBEDDING_MODEL=Xenova/multilingual-e5-large  # default
 *   HF_HUB_OFFLINE=1               # optional, after first download
 *   QDRANT_*                       # used by Qdrant client, not here
 */
@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractor: FeatureExtractor | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadedModelName: string | null = null;

  async onModuleInit(): Promise<void> {
    if (this.shouldUseLocal()) {
      // Warm model in background so first search is faster
      this.ensureLocalExtractor().catch((err) => {
        this.logger.warn(
          `[scheme-qdrant] Local JS embedder warm-up failed: ${
            err?.message || err
          }`,
        );
      });
    }
  }

  private getHttpBaseUrl(): string {
    return (
      process.env.EMBEDDING_SERVICE_URL ||
      process.env.SCHEME_EMBEDDING_URL ||
      ''
    ).replace(/\/$/, '');
  }

  private getTimeoutMs(): number {
    const raw = process.env.EMBEDDING_TIMEOUT_MS || '60000';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 60000;
  }

  private getHfHome(): string {
    return (
      process.env.HF_HOME ||
      process.env.TRANSFORMERS_CACHE ||
      ''
    ).replace(/\/$/, '');
  }

  private getMode(): 'local' | 'http' | 'auto' {
    const raw = (
      process.env.EMBEDDING_MODE ||
      process.env.SCHEME_EMBEDDING_MODE ||
      'auto'
    )
      .toLowerCase()
      .trim();
    if (raw === 'local' || raw === 'http') return raw;
    return 'auto';
  }

  /**
   * Prefer local JS when HF_HOME is set, or always in auto unless force http.
   * Default auto → local (no EMBEDDING_SERVICE_URL required).
   */
  private shouldUseLocal(): boolean {
    const mode = this.getMode();
    if (mode === 'http') return false;
    if (mode === 'local') return true;
    // auto: local JS by default; use HTTP only if explicitly no local wanted
    // and EMBEDDING_SERVICE_URL is set without HF_HOME
    if (this.getHttpBaseUrl() && !this.getHfHome() && process.env.EMBEDDING_PREFER_HTTP === '1') {
      return false;
    }
    return true;
  }

  /**
   * Map Python / oan-api model ids to Transformers.js ONNX models.
   */
  private getModel(): string {
    const raw = (
      process.env.EMBEDDING_MODEL ||
      process.env.SCHEME_EMBEDDING_MODEL ||
      DEFAULT_JS_MODEL
    ).trim();

    // Map Python / oan-api model id → Transformers.js ONNX model
    if (
      raw === DEFAULT_EMBEDDING_MODEL ||
      raw === 'intfloat/multilingual-e5-large' ||
      raw === 'multilingual-e5-large'
    ) {
      return DEFAULT_JS_MODEL;
    }
    return raw;
  }

  isConfigured(): boolean {
    if (this.shouldUseLocal()) return true;
    return Boolean(this.getHttpBaseUrl());
  }

  async embedQuery(query: string): Promise<number[]> {
    const prefixed = query.startsWith('query:')
      ? query
      : `query: ${query}`;

    if (this.shouldUseLocal()) {
      try {
        return await this.embedLocal(prefixed);
      } catch (err: any) {
        const httpUrl = this.getHttpBaseUrl();
        if (httpUrl) {
          this.logger.warn(
            `[scheme-qdrant] Local JS embed failed (${err?.message}); falling back to HTTP`,
          );
          return this.embedHttp(prefixed);
        }
        throw err;
      }
    }

    return this.embedHttp(prefixed);
  }

  // ─── Local Transformers.js ──────────────────────────────────────────────

  private async ensureLocalExtractor(): Promise<void> {
    if (this.extractor && this.loadedModelName === this.getModel()) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadLocalExtractor().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async loadLocalExtractor(): Promise<void> {
    const modelName = this.getModel();
    const hfHome = this.getHfHome();
    const offline =
      process.env.HF_HUB_OFFLINE === '1' ||
      process.env.TRANSFORMERS_OFFLINE === '1';

    this.logger.log(
      `[scheme-qdrant] Loading local JS embedder model=${modelName} cache=${
        hfHome || '(default)'
      } offline=${offline}`,
    );

    // Use createRequire so Nest/TS 4.7 does not typecheck transformers.js
    // (its .d.ts needs newer TypeScript). Runtime is pure Node/JS.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRequire } = require('module') as typeof import('module');
    const req = createRequire(__filename);
    const { env, pipeline } = req('@huggingface/transformers') as {
      env: any;
      pipeline: (...args: any[]) => Promise<FeatureExtractor>;
    };

    if (hfHome) {
      // Transformers.js cache (separate from Python hub layout)
      env.cacheDir = path.join(hfHome, 'transformers-js');
      env.localModelPath = env.cacheDir;
    }
    env.allowLocalModels = true;
    if (offline) {
      env.allowRemoteModels = false;
    }

    // feature-extraction with mean pooling matches sentence-transformers E5 usage
    const extractor = await pipeline('feature-extraction', modelName, {
      // dtype optional; default is fine for CPU
    });

    this.extractor = extractor as FeatureExtractor;
    this.loadedModelName = modelName;
    this.logger.log(
      `[scheme-qdrant] Local JS embedder ready model=${modelName}`,
    );
  }

  private async embedLocal(text: string): Promise<number[]> {
    await this.ensureLocalExtractor();
    if (!this.extractor) {
      throw new Error('Local JS embedder is not available');
    }

    const started = Date.now();
    // normalize: false matches oan-api embed_query(normalize_embeddings=False)
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: false,
    });

    const vector = this.tensorToArray(output);
    if (!vector?.length) {
      throw new Error('Local JS embedder returned empty vector');
    }

    this.logger.debug(
      `[scheme-qdrant] Local JS embed dims=${vector.length} elapsedMs=${
        Date.now() - started
      }`,
    );
    return vector;
  }

  private tensorToArray(output: any): number[] | null {
    if (!output) return null;

    // Tensor-like { data: Float32Array, dims: [...] }
    if (output.data) {
      return Array.from(output.data as ArrayLike<number>).map(Number);
    }
    // Nested array [[...]]
    if (Array.isArray(output)) {
      if (Array.isArray(output[0])) {
        return (output[0] as number[]).map(Number);
      }
      if (typeof output[0] === 'number') {
        return output.map(Number);
      }
    }
    // .tolist()
    if (typeof output.tolist === 'function') {
      const list = output.tolist();
      if (Array.isArray(list?.[0])) return list[0].map(Number);
      if (Array.isArray(list)) return list.map(Number);
    }

    return null;
  }

  // ─── Optional HTTP fallback ─────────────────────────────────────────────

  private async embedHttp(query: string): Promise<number[]> {
    const baseUrl = this.getHttpBaseUrl();
    if (!baseUrl) {
      throw new Error(
        'No embedding backend: local JS failed and EMBEDDING_SERVICE_URL is not set',
      );
    }

    const url = `${baseUrl}/embed`;
    this.logger.debug(
      `[scheme-qdrant] Embedding query via ${url} model=${this.getModel()}`,
    );

    const response = await axios.post(
      url,
      {
        texts: [query],
        text: query,
        inputs: [query],
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
    if (Array.isArray(data.embeddings?.[0])) {
      return data.embeddings[0].map(Number);
    }
    if (Array.isArray(data.embedding)) {
      return data.embedding.map(Number);
    }
    if (Array.isArray(data.data?.[0]?.embedding)) {
      return data.data[0].embedding.map(Number);
    }
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map(Number);
    }
    if (Array.isArray(data) && typeof data[0] === 'number') {
      return data.map(Number);
    }
    if (Array.isArray(data.vectors?.[0])) {
      return data.vectors[0].map(Number);
    }
    return null;
  }
}
