import { createInterface } from 'readline';
import { SupervisorOperator } from './core/supervisor.js';

const WELCOME = `
┌─────────────────────────────────────────────────┐
│          Second Brain — Interactive Chat         │
│                                                  │
│  Ask anything about your organization's memory. │
│  I'll search across all connected sources.       │
│                                                  │
│  Commands:                                       │
│    /sources   — Show connected data sources      │
│    /sync      — Sync all data sources            │
│    /scan      — Find savings opportunities       │
│    /clear     — Clear conversation history        │
│    /verbose   — Toggle verbose reasoning output   │
│    /help      — Show this help                   │
│    /exit      — Exit                             │
└─────────────────────────────────────────────────┘
`;

export async function startREPL(): Promise<void> {
  const supervisor = new SupervisorOperator();
  let verbose = false;

  console.log(WELCOME);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n🧠 You: ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      await handleCommand(input, supervisor, rl, () => { verbose = !verbose; });
      rl.prompt();
      return;
    }

    // Process question
    try {
      process.stdout.write('\n🤔 Thinking...\n');

      const result = await supervisor.ask(input, verbose);

      console.log('\n' + '─'.repeat(50));
      console.log(`\n📝 ${result.answer}`);

      if (result.citations.length > 0) {
        console.log('\n📚 Sources:');
        for (const cite of result.citations) {
          console.log(`   • [${cite.type}] ${cite.source}`);
          if (cite.url) console.log(`     ${cite.url}`);
        }
      }

      console.log(`\n   Confidence: ${(result.confidence * 100).toFixed(0)}%`);

      if (verbose && result.steps.length > 0) {
        console.log('\n🔍 Reasoning steps:');
        for (const step of result.steps) {
          console.log(`   • ${step.thought}`);
          if (step.action) console.log(`     → ${step.action}`);
        }
      }

      console.log('─'.repeat(50));
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye! 👋');
    process.exit(0);
  });
}

async function handleCommand(
  input: string,
  supervisor: SupervisorOperator,
  rl: ReturnType<typeof createInterface>,
  toggleVerbose: () => void
): Promise<void> {
  const cmd = input.toLowerCase();

  switch (cmd) {
    case '/exit':
    case '/quit':
    case '/q':
      rl.close();
      break;

    case '/sources':
    case '/status': {
      const status = await supervisor.getStatus();
      console.log('\n📊 Data Sources:');
      for (const s of status) {
        const icon = s.configured ? '✅' : '❌';
        const count = s.docCount ? ` (${s.docCount} docs)` : '';
        console.log(`   ${icon} ${s.source}${count}`);
      }
      break;
    }

    case '/sync':
      console.log('\n🔄 Syncing all sources...');
      const results = await supervisor.sync();
      console.log('\nSync results:');
      for (const r of results) {
        console.log(`   ${r.source}: ${r.count} documents`);
      }
      break;

    case '/scan':
      console.log('\n🔍 Scanning for savings opportunities...');
      const report = await supervisor.scan();
      console.log('\n' + report);
      break;

    case '/clear':
      supervisor.clearHistory();
      console.log('\n🗑️  Conversation history cleared.');
      break;

    case '/verbose':
      toggleVerbose();
      console.log('\nVerbose mode toggled.');
      break;

    case '/help':
      console.log(WELCOME);
      break;

    default:
      console.log(`\nUnknown command: ${input}. Type /help for available commands.`);
  }
}
