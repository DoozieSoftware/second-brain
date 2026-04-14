export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration?: number;
}

export interface LogConfig {
  level: LogLevel;
  format: 'json' | 'pretty';
  includeTimestamp: boolean;
  includeContext: boolean;
}

class Logger {
  private config: LogConfig = {
    level: (process.env.LOG_LEVEL as LogLevel) || 'info',
    format: (process.env.LOG_FORMAT as 'json' | 'pretty') || 'json',
    includeTimestamp: true,
    includeContext: true,
  };

  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    critical: 4,
  };

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.config.level];
  }

  private formatEntry(entry: LogEntry): string {
    if (this.config.format === 'pretty') {
      return this.formatPretty(entry);
    }
    return JSON.stringify(entry);
  }

  private formatPretty(entry: LogEntry): string {
    const timestamp = entry.timestamp.slice(11, 19);
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      critical: '\x1b[35m\x1b[1m',
    };
    const reset = '\x1b[0m';
    const levelStr = `${levelColors[entry.level]}${entry.level.toUpperCase().padEnd(8)}${reset}`;
    
    let output = `${timestamp} ${levelStr} ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${reset}\x1b[90m${JSON.stringify(entry.context)}\x1b[0m`;
    }
    
    if (entry.duration !== undefined) {
      output += ` \x1b[36m[${entry.duration}ms]\x1b[0m`;
    }
    
    if (entry.error) {
      output += `\n  \x1b[31m${entry.error.name}: ${entry.error.message}\x1b[0m`;
      if (entry.error.stack) {
        output += `\n  \x1b[90m${entry.error.stack.split('\n').slice(1, 4).join('\n  ')}\x1b[0m`;
      }
    }
    
    return output;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error, duration?: number): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context) entry.context = context;
    if (duration !== undefined) entry.duration = duration;
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    console.log(this.formatEntry(entry));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>, duration?: number): void {
    this.log('info', message, context, undefined, duration);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : undefined;
    const ctx = err ? context : { ...context, error };
    this.log('error', message, ctx, err);
  }

  critical(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : undefined;
    const ctx = err ? context : { ...context, error };
    this.log('critical', message, ctx, err);
  }

  time(label: string): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.log('debug', `${label} completed`, {}, undefined, duration);
      return duration;
    };
  }

  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, context);
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  setFormat(format: 'json' | 'pretty'): void {
    this.config.format = format;
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private defaultContext: Record<string, unknown>
  ) {}

  private mergeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!context) return this.defaultContext;
    return { ...this.defaultContext, ...context };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  info(message: string, context?: Record<string, unknown>, duration?: number): void {
    this.parent.info(message, this.mergeContext(context), duration);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.parent.error(message, error, this.mergeContext(context));
  }

  critical(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.parent.critical(message, error, this.mergeContext(context));
  }
}

export const logger = new Logger();
export type { ChildLogger };
