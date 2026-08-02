import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface DiscordMessage {
  id: string;
  content?: string;
  author?: { username?: string };
  timestamp?: string;
  guild_id?: string;
  channel_id?: string;
}

/**
 * Discord adapter — channel message history (read-only).
 *
 * Config (env):
 *  - DISCORD_TOKEN: bot token
 *  - DISCORD_CHANNELS: comma-separated channel ids (required)
 */
export class DiscordAdapter extends BaseApiConnector {
  readonly name = 'discord';
  readonly kind = 'sync' as const;
  readonly description = 'Discord channel messages';

  private token: string | undefined;
  private channels: string[];

  constructor() {
    super();
    this.token = process.env.DISCORD_TOKEN;
    this.channels = (process.env.DISCORD_CHANNELS ?? '')
      .split(',').map(c => c.trim()).filter(Boolean);
  }

  get requiredConfig(): string[] {
    return ['DISCORD_TOKEN', 'DISCORD_CHANNELS'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.token) missing.push('DISCORD_TOKEN');
    if (this.channels.length === 0) missing.push('DISCORD_CHANNELS');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return 'https://discord.com/api/v10';
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bot ${this.token ?? ''}` };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.get<{ id: string }>('/users/@me');
      return { ok: true, message: 'Connected to Discord API' };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'DISCORD_TOKEN').message };
    }
  }

  private async fetchChannel(channelId: string, opts?: SyncOptions): Promise<MemoryDocument[]> {
    const docs: MemoryDocument[] = [];
    let before: string | undefined;
    const limit = opts?.limit ?? 1000;

    for (let guard = 0; guard < 20; guard++) {
      const params = new URLSearchParams({ limit: '100' });
      if (before) params.set('before', before);
      if (opts?.since) params.set('after', opts.since);
      const messages = await this.get<DiscordMessage[]>(`/channels/${channelId}/messages?${params}`);
      if (messages.length === 0) break;
      for (const m of messages) {
        const content = (m.content ?? '').slice(0, 2000);
        if (!content.trim()) continue;
        const date = m.timestamp ? new Date(m.timestamp).toISOString() : new Date(Number(m.id) / 4194304 / 1000 + 1420070400000).toISOString();
        docs.push(makeDoc('discord', `${channelId}:${m.id}`, content, {
          type: 'message',
          author: m.author?.username ?? 'unknown',
          channel: channelId,
          url: `https://discord.com/channels/${m.guild_id ?? '@me'}/${channelId}/${m.id}`,
          date,
        }));
        if (docs.length >= limit) return docs;
      }
      before = messages[messages.length - 1].id;
    }
    return docs;
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.token || this.channels.length === 0) {
      throw this.mapError('DISCORD_TOKEN/DISCORD_CHANNELS not set', 'DISCORD_TOKEN');
    }
    const docs: MemoryDocument[] = [];
    for (const channelId of this.channels) {
      try {
        docs.push(...(await this.fetchChannel(channelId, options)));
      } catch (error) {
        console.warn(`[Discord] Skipping channel ${channelId}: ${error instanceof Error ? error.message : error}`);
      }
    }
    return docs;
  }
}
