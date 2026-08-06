import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { SchemeListItem } from './scheme-registry';

/**
 * Live scheme registry — read side of docs-pipeline's `master_catalog` table
 * (Postgres, MASTER_CATALOG_PG_*). A document ingested + promoted there shows
 * up here on the next refresh, with no redeploy of this service required.
 *
 * Only `tool_name = 'search_schemes'` rows are pulled in: those are the ones
 * actually routed to Qdrant vector search. Legacy `get_scheme_info` rows are
 * a different (non-vector) path and are intentionally excluded.
 *
 * Polled + cached in memory rather than queried per-request, and fails open:
 * a DB outage freezes the registry at whatever was last loaded instead of
 * taking scheme search down. See getSchemeList()/getKnownSchemeCodes().
 */
@Injectable()
export class SchemeCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchemeCatalogService.name);
  private pool: Pool | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private schemeList: SchemeListItem[] = [];
  private knownSchemeCodes: Set<string> = new Set();

  isConfigured(): boolean {
    return Boolean(process.env.MASTER_CATALOG_PG_HOST);
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;

    const sslMode = (process.env.MASTER_CATALOG_PG_SSLMODE || '').toLowerCase();
    const sslEnabled = ['require', 'verify-ca', 'verify-full', 'no-verify'].includes(
      sslMode,
    );
    // verify-ca/verify-full ask for real certificate validation; require/no-verify
    // (per libpq's own definition of "require") only mean "encrypt the connection".
    const rejectUnauthorizedDefault = ['verify-ca', 'verify-full'].includes(sslMode);
    const rejectUnauthorized = process.env.MASTER_CATALOG_PG_SSL_REJECT_UNAUTHORIZED
      ? ['1', 'true', 'yes', 'on'].includes(
          process.env.MASTER_CATALOG_PG_SSL_REJECT_UNAUTHORIZED.toLowerCase(),
        )
      : rejectUnauthorizedDefault;

    this.pool = new Pool({
      host: process.env.MASTER_CATALOG_PG_HOST,
      port: parseInt(process.env.MASTER_CATALOG_PG_PORT || '5432', 10),
      database: process.env.MASTER_CATALOG_PG_DB,
      user: process.env.MASTER_CATALOG_PG_USER,
      password: process.env.MASTER_CATALOG_PG_PASSWORD,
      ssl: sslEnabled ? { rejectUnauthorized } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    return this.pool;
  }

  /**
   * `master_catalog.status` accumulates every tier a doc has synced under
   * ({dev} then {dev,live}). 'dev' deployments see dev+live rows (a dev
   * tester should also see promoted entries); 'live' sees live-only.
   * Defaults off the QDRANT_URL host so this doesn't need its own env var
   * in the common case — a *-dev.* Qdrant endpoint implies a dev deployment.
   */
  private getTierStatuses(): string[] {
    const explicit = (process.env.MASTER_CATALOG_TIER || '').trim().toLowerCase();
    if (explicit === 'live' || explicit === 'prod' || explicit === 'production') {
      return ['live'];
    }
    if (explicit === 'dev' || explicit === 'development') {
      return ['dev', 'live'];
    }
    const qdrantUrl = (process.env.QDRANT_URL || '').toLowerCase();
    return qdrantUrl.includes('dev') ? ['dev', 'live'] : ['live'];
  }

  private getRefreshMs(): number {
    const raw = process.env.MASTER_CATALOG_REFRESH_MS || '300000';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 300000;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(
        '[scheme-catalog] MASTER_CATALOG_PG_HOST not configured — scheme registry will stay empty',
      );
      return;
    }

    await this.refresh();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        this.logger.warn(
          `[scheme-catalog] Background refresh failed: ${err?.message || err}`,
        );
      });
    }, this.getRefreshMs());
    this.refreshTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.pool) await this.pool.end();
  }

  /** Best-effort reload from Postgres. Keeps the last known list on failure. */
  async refresh(): Promise<void> {
    try {
      const statuses = this.getTierStatuses();
      const result = await this.getPool().query(
        `SELECT code, name, aliases
         FROM master_catalog
         WHERE tool_name = 'search_schemes'
           AND status && $1::text[]
         ORDER BY code`,
        [statuses],
      );

      const list: SchemeListItem[] = result.rows.map((row: any) => ({
        scheme_code: String(row.code).toLowerCase(),
        scheme_name: String(row.name || row.code),
        scheme_aliases: Array.isArray(row.aliases) ? row.aliases : [],
      }));

      this.schemeList = list;
      this.knownSchemeCodes = new Set(list.map((item) => item.scheme_code));
      this.logger.log(
        `[scheme-catalog] Loaded ${list.length} scheme(s) from master_catalog (tier=${statuses.join('/')})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[scheme-catalog] Refresh failed, keeping last known list (${this.schemeList.length} scheme(s)): ${
          err?.message || err
        }`,
      );
    }
  }

  /** Cached list, no DB round-trip. Empty until the first successful refresh. */
  getSchemeList(): SchemeListItem[] {
    return this.schemeList;
  }

  getKnownSchemeCodes(): Set<string> {
    return this.knownSchemeCodes;
  }
}
