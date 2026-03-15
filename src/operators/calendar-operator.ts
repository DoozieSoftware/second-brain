import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { CalendarConnector } from '../connectors/calendar-connector.js';

export class CalendarOperator extends Operator {
  private connector: CalendarConnector;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    const tools = new ToolRegistry();
    super('calendar', reasoning, memory, tools);

    this.connector = new CalendarConnector({
      apiKey: process.env.GOOGLE_CALENDAR_API_KEY,
    });
  }

  async sync(since?: Date): Promise<number> {
    console.log('[Calendar] Starting sync...');
    const docs = await this.connector.fetchEvents(since);
    return this.memory.ingest(docs);
  }
}
