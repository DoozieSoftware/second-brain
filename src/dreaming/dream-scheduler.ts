/**
 * DreamScheduler — triggers the offline consolidation loop ("dreaming") when
 * the server has been idle for a while.
 *
 * Dependency-free: a `setInterval` checks elapsed time since the last request.
 * Env knobs:
 *   DREAM_ENABLED        "true" (default) to run dreams while idle
 *   DREAM_IDLE_MINUTES   idle threshold before a dream fires (default 30)
 *   DREAM_COOLDOWN_MINUTES  minimum gap between dreams (default 120)
 */
export class DreamScheduler {
  private lastActivity: number = Date.now();
  private lastDreamAt: number = 0;
  private running: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private enabled: boolean;
  private idleMinutes: number;
  private cooldownMinutes: number;
  private dreamFn: () => Promise<unknown>;
  private logFn: (msg: string) => void;

  constructor(
    dreamFn: () => Promise<unknown>,
    opts: {
      logFn?: (msg: string) => void;
      enabled?: boolean;
      idleMinutes?: number;
      cooldownMinutes?: number;
    } = {},
  ) {
    this.dreamFn = dreamFn;
    this.logFn = opts.logFn ?? ((msg) => console.log(msg));
    this.enabled = opts.enabled ?? process.env.DREAM_ENABLED !== 'false';
    this.idleMinutes = opts.idleMinutes ?? Number(process.env.DREAM_IDLE_MINUTES ?? 30);
    this.cooldownMinutes = opts.cooldownMinutes ?? Number(process.env.DREAM_COOLDOWN_MINUTES ?? 120);
  }

  /** Call on every HTTP request to reset the idle clock. */
  touch(): void {
    this.lastActivity = Date.now();
  }

  start(checkIntervalMs = 60000): void {
    if (!this.enabled || this.timer) return;
    this.logFn(`💤 Dream scheduler enabled (idle ${this.idleMinutes}m, cooldown ${this.cooldownMinutes}m)`);
    this.timer = setInterval(() => {
      void this.check();
    }, checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private async check(): Promise<void> {
    if (this.running) return;
    const idleMs = Date.now() - this.lastActivity;
    const sinceLastDream = Date.now() - this.lastDreamAt;
    if (idleMs < this.idleMinutes * 60_000) return;
    if (sinceLastDream < this.cooldownMinutes * 60_000) return;

    this.running = true;
    try {
      this.logFn(`💤 Idle for ${Math.round(idleMs / 60000)}m — dreaming...`);
      await this.dreamFn();
      this.lastDreamAt = Date.now();
    } catch (error) {
      this.logFn(`💤 Dream failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
