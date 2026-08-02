import type { MemoryDocument } from '../core/memory.js';

/**
 * Integration Framework — the contract every data source adapter implements.
 *
 * The framework is designed so future integrations (GitLab, Jira, Linear,
 * Slack, Discord, Notion, Confluence, Google Workspace, CRM, internal APIs)
 * plug in with minimal effort:
 *
 *  1. Implement `SourceConnector` (validateConfig / testConnection / fetch).
 *  2. Register it in `ConnectorRegistry`.
 *  3. The framework handles sync orchestration, pagination helper, error
 *     policy, and normalization via `MemoryDocument`.
 *
 * Existing legacy connectors (github-connector.ts etc.) predate this contract
 * and are left as-is; new connectors MUST implement this interface so the
 * platform has a single, well-typed way to add sources.
 */

/** Config validation result. */
export interface ConfigValidation {
  valid: boolean;
  /** Missing/invalid field names, e.g. ['apiToken']. */
  missing: string[];
  message?: string;
}

/** How much of the source to pull. */
export interface SyncOptions {
  /** ISO timestamp — only fetch items updated after this (incremental sync). */
  since?: string;
  /** Hard cap on items fetched this run (safety valve). */
  limit?: number;
  /** Source-specific extra params (channel ids, projects, workspaces...). */
  params?: Record<string, string>;
}

export interface ConnectorStatus {
  configured: boolean;
  healthy: boolean;
  lastSync?: string;
  itemCount?: number;
  message?: string;
}

/**
 * The core contract. Implementations are stateless with respect to sync state
 * (the registry owns state), so they can be instantiated per run cheaply.
 */
export interface SourceConnector {
  readonly name: string;
  readonly kind: 'sync' | 'pull' | 'import';
  /** Human-readable description shown in /integrations. */
  readonly description: string;

  /** Required env/config fields (for the /integrations status page). */
  readonly requiredConfig: string[];

  /** Whether the source is currently configured (env vars / store present). */
  isConfigured(): boolean;

  /** Validates config and returns which fields are missing. */
  validateConfig(): ConfigValidation;

  /** Cheap connectivity check (e.g. GET /v1/me). Throws on failure. */
  testConnection(): Promise<{ ok: boolean; message: string }>;

  /** Pull documents from the source, normalized to MemoryDocument[]. */
  fetch(options?: SyncOptions): Promise<MemoryDocument[]>;
}

/**
 * Shared helpers for REST-API connectors: base URL building, auth header
 * construction, paginated GET with a next-page callback, and error mapping.
 * Keeps each adapter small and consistent.
 */
export abstract class BaseApiConnector implements SourceConnector {
  abstract readonly name: string;
  abstract readonly kind: SourceConnector['kind'];
  abstract readonly description: string;
  abstract readonly requiredConfig: string[];

  protected abstract baseUrl(): string;
  protected abstract authHeaders(): Record<string, string>;

  isConfigured(): boolean {
    return this.validateConfig().valid;
  }

  abstract validateConfig(): ConfigValidation;

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl()}/health`, { headers: this.authHeaders() });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Authentication failed — check your token.' };
      }
      return { ok: true, message: `Reachable (HTTP ${res.status})` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  /** GET helper with timeout, auth headers, and 2xx guard. */
  protected async get<T>(path: string, timeoutMs = 15000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl()}${path}`, {
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`${this.name} API error ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Paginated fetch: repeatedly calls `pageFetcher(pageToken)` and appends
   * results until `nextToken()` returns null, the page returns empty, or the
   * item cap is reached. Implements the standard "loop until next is null"
   * pattern so adapters don't each reinvent it.
   */
  protected async paginate<T>(
    pageFetcher: (pageToken: string | undefined) => Promise<{ items: T[]; nextToken: string | null }>,
    opts?: SyncOptions
  ): Promise<T[]> {
    const all: T[] = [];
    const limit = opts?.limit ?? 1000;
    let token: string | undefined;
    let guard = 0;

    do {
      const page = await pageFetcher(token);
      all.push(...page.items);
      token = page.nextToken ?? undefined;
      guard++;
      if (all.length >= limit || guard > 100 || (page.items.length === 0 && !token)) break;
    } while (token);

    return all.slice(0, limit);
  }

  /** Map a source error to a stable, actionable message. */
  protected mapError(error: unknown, field: string): Error {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('401') || msg.includes('403')) {
      return new Error(`${this.name} auth failed: check ${field} in config`);
    }
    return new Error(`${this.name} sync failed: ${msg}`);
  }

  abstract fetch(options?: SyncOptions): Promise<MemoryDocument[]>;
}

/** Normalize a raw title+body pair into a MemoryDocument. */
export function makeDoc(
  prefix: string,
  rawId: string | number,
  text: string,
  metadata: Record<string, string | number | boolean>
): MemoryDocument {
  return {
    id: `${prefix}:${rawId}`,
    text: text.slice(0, 8000),
    metadata: { source: prefix, ...metadata },
  };
}
