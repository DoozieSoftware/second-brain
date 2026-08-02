import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  subtype?: string;
  bot_id?: string;
  ts_thread?: string;
}

interface SlackMembersResponse {
  ok?: boolean;
  members?: Array<{ id: string; name?: string; real_name?: string; profile?: { display_name?: string; email?: string } }>;
  response_metadata?: { next_cursor?: string };
}

interface SlackConvoResponse {
  ok?: boolean;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
}

/**
 * Slack adapter — public-channel message history (read-only).
 *
 * Config (env):
 *  - SLACK_TOKEN: bot user token (xoxb-...)
 *  - SLACK_CHANNELS: optional comma-separated channel ids; when unset, syncs
 *    all public channels the bot is in.
 */
export class SlackAdapter extends BaseApiConnector {
  readonly name = 'slack';
  readonly kind = 'sync' as const;
  readonly description = 'Slack public-channel messages';

  private token: string | undefined;
  private channels: string[];

  constructor() {
    super();
    this.token = process.env.SLACK_TOKEN;
    this.channels = (process.env.SLACK_CHANNELS ?? '')
      .split(',').map(c => c.trim()).filter(Boolean);
  }

  get requiredConfig(): string[] {
    return ['SLACK_TOKEN'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.token) missing.push('SLACK_TOKEN');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return 'https://slack.com/api';
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token ?? ''}` };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.get<{ ok: boolean; team?: { name?: string } }>('/auth.test');
      if (!res.ok) return { ok: false, message: 'Slack auth.test failed' };
      return { ok: true, message: `Connected to ${res.team?.name ?? 'Slack'}` };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'SLACK_TOKEN').message };
    }
  }

  private async listChannels(): Promise<SlackChannel[]> {
    const res = await this.get<{ ok: boolean; channels?: SlackChannel[]; response_metadata?: { next_cursor?: string } }>(
      '/conversations.list?types=public_channel&limit=200'
    );
    return res.channels ?? [];
  }

  private async fetchMessages(channelId: string, opts?: SyncOptions): Promise<MemoryDocument[]> {
    const oldest = opts?.since ? Math.floor(new Date(opts.since).getTime() / 1000) : undefined;
    const docs: MemoryDocument[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const params = new URLSearchParams({ channel: channelId, limit: '200' });
      if (oldest) params.set('oldest', String(oldest));
      if (cursor) params.set('cursor', cursor);
      const res = await this.get<SlackConvoResponse>(`/conversations.history?${params}`);
      const messages = res.messages ?? [];
      for (const m of messages) {
        if (m.subtype && m.subtype !== 'message_deleted') continue;
        const text = (m.text ?? '').slice(0, 2000);
        if (!text.trim()) continue;
        const url = `https://slack.com/archives/${channelId}/p${m.ts.replace('.', '')}`;
        docs.push(makeDoc('slack', `${channelId}:${m.ts}`, text, {
          type: 'message',
          author: m.user ?? m.bot_id ?? 'unknown',
          channel: channelId,
          url,
          date: new Date(Number(m.ts) * 1000).toISOString(),
        }));
      }
      cursor = res.response_metadata?.next_cursor;
      if (!cursor || messages.length === 0 || (opts?.limit && docs.length >= opts.limit)) break;
    }
    return docs.slice(0, opts?.limit ?? docs.length);
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.token) throw this.mapError('SLACK_TOKEN not set', 'SLACK_TOKEN');
    const channels = this.channels.length > 0 ? this.channels : (await this.listChannels()).map(c => c.id);
    const docs: MemoryDocument[] = [];
    for (const channelId of channels) {
      try {
        docs.push(...(await this.fetchMessages(channelId, options)));
      } catch (error) {
        console.warn(`[Slack] Skipping channel ${channelId}: ${error instanceof Error ? error.message : error}`);
      }
    }
    return docs;
  }
}
