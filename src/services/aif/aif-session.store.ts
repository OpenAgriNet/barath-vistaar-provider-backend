import { Injectable } from "@nestjs/common";

export interface AifSession {
  /** Bearer token issued by AIF on OTP verification. Never leaves the provider network. */
  token: string;
  beneficiaryId: string;
  /** Epoch ms after which the token must not be reused. */
  expiresAt: number;
}

/**
 * Holds verified AIF sessions keyed by context.transaction_id, so status requests
 * that follow a verification do not need a second OTP.
 *
 * In-memory: sessions are lost on restart (the farmer is asked for a fresh OTP) and
 * are not shared across instances. That is acceptable while the backend runs as a
 * single container; move the three methods below onto Redis before scaling out.
 */
@Injectable()
export class AifSessionStore {
  private readonly sessions = new Map<string, AifSession>();

  /** Discarded this many ms before the real expiry, so a token cannot expire mid-call. */
  private static readonly EXPIRY_SAFETY_MARGIN_MS = 60_000;

  set(
    transactionId: string,
    session: Omit<AifSession, "expiresAt"> & { expiresIn: number }
  ) {
    const { expiresIn, ...rest } = session;
    this.sessions.set(transactionId, {
      ...rest,
      expiresAt:
        Date.now() + expiresIn * 1000 - AifSessionStore.EXPIRY_SAFETY_MARGIN_MS,
    });
  }

  /** Returns the session only while still valid; expired entries are evicted on read. */
  get(transactionId: string): AifSession | undefined {
    const session = this.sessions.get(transactionId);
    if (!session) return undefined;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(transactionId);
      return undefined;
    }
    return session;
  }

  /** Drops every expired session. Called opportunistically so the map cannot grow without bound. */
  prune() {
    const now = Date.now();
    for (const [transactionId, session] of this.sessions) {
      if (now >= session.expiresAt) this.sessions.delete(transactionId);
    }
  }
}
