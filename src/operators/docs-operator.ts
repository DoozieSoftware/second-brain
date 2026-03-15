import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { DocsConnector } from '../connectors/docs-connector.js';

export class DocsOperator extends Operator {
  private connector: DocsConnector;

  constructor(reasoning: ReasoningEngine, memory: Memory, paths?: string[]) {
    const tools = new ToolRegistry();
    super('docs', reasoning, memory, tools);

    this.connector = new DocsConnector({
      paths: paths || ['.'],
      extensions: ['.md', '.txt', '.markdown', '.rst', '.json', '.yaml', '.yml', '.ts', '.js'],
    });
  }

  async sync(paths?: string[]): Promise<number> {
    console.log('[Docs] Starting sync...');
    if (paths) {
      this.connector = new DocsConnector({ paths });
    }
    const docs = await this.connector.syncAll();
    return this.memory.ingest(docs);
  }
}
