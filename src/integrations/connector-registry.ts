import type { SourceConnector, SyncOptions, ConnectorStatus, ConfigValidation } from './base-connector.js';

/**
 * ConnectorRegistry — the single place new integrations register themselves.
 *
 * The supervisor and API consult this registry (not per-source if/else) so a
 * new adapter is one import + one `register()` call away. It also exposes the
 * unified status/validation surface used by the /integrations API.
 */
export class ConnectorRegistry {
  private connectors = new Map<string, SourceConnector>();
  private syncState = new Map<string, { lastSync?: string; itemCount?: number }>();

  register(connector: SourceConnector): void {
    this.connectors.set(connector.name, connector);
  }

  registerMany(connectors: SourceConnector[]): void {
    for (const c of connectors) this.register(c);
  }

  get(name: string): SourceConnector | undefined {
    return this.connectors.get(name);
  }

  list(): SourceConnector[] {
    return Array.from(this.connectors.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.connectors.has(name);
  }

  validate(name: string): ConfigValidation | undefined {
    return this.connectors.get(name)?.validateConfig();
  }

  statuses(): Array<ConnectorStatus & { name: string; kind: string; description: string; requiredConfig: string[]; validation: ConfigValidation }> {
    return this.list().map(c => {
      const state = this.syncState.get(c.name);
      const validation = c.validateConfig();
      return {
        name: c.name,
        kind: c.kind,
        description: c.description,
        requiredConfig: c.requiredConfig,
        validation,
        configured: c.isConfigured(),
        healthy: validation.valid,
        lastSync: state?.lastSync,
        itemCount: state?.itemCount,
      };
    });
  }

  /**
   * Sync a source: fetch docs through its adapter and record sync state.
   * The memory ingestion is delegated to the caller (registry stays
   * storage-agnostic).
   */
  async sync(name: string, fetchFn: (docs: Awaited<ReturnType<SourceConnector['fetch']>>) => Promise<number>, options?: SyncOptions): Promise<{ name: string; count: number; configured: boolean }> {
    const connector = this.connectors.get(name);
    if (!connector) return { name, count: 0, configured: false };
    if (!connector.isConfigured()) return { name, count: 0, configured: false };

    const docs = await connector.fetch(options);
    const count = docs.length > 0 ? await fetchFn(docs) : 0;
    this.syncState.set(name, { lastSync: new Date().toISOString(), itemCount: count });
    return { name, count, configured: true };
  }

  getSyncState(name: string): { lastSync?: string; itemCount?: number } | undefined {
    return this.syncState.get(name);
  }
}

export const connectorRegistry = new ConnectorRegistry();
