import { createInterface } from 'readline';
import { SupervisorOperator } from './core/supervisor.js';
import type { Question } from './learning/question-generator.js';

const WELCOME = `
┌─────────────────────────────────────────────────┐
│          Second Brain — Interactive Chat         │
│                                                  │
│  Ask anything about your organization's memory. │
│  I'll search across all connected sources and    │
│  reason through your decision patterns.          │
│                                                  │
│  Commands:                                       │
│    /sources   — Show connected data sources      │
│    /sync      — Sync all data sources            │
│    /scan      — Find savings opportunities       │
│    /profile   — View your decision profile       │
│    /evolution — System self-improvement report    │
│    /learn     — Start learning session (5 Qs)    │
│    /feedback  — Give feedback on last answer     │
│    /clear     — Clear conversation history        │
│    /verbose   — Toggle verbose reasoning output   │
│    /help      — Show this help                   │
│    /exit      — Exit                             │
└─────────────────────────────────────────────────┘
`;

export async function startREPL(): Promise<void> {
  const supervisor = new SupervisorOperator();
  let verbose = false;
  let lastQuery = '';

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
      await handleCommand(input, supervisor, rl, () => { verbose = !verbose; }, () => lastQuery);
      rl.prompt();
      return;
    }

    // Process question
    try {
      process.stdout.write('\n🤔 Thinking...\n');
      lastQuery = input;

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
  toggleVerbose: () => void,
  getLastQuery: () => string
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

    case '/profile':
      console.log('\n' + supervisor.getProfile());
      break;

    case '/evolution':
      console.log('\n' + supervisor.getEvolution());
      break;

    case '/learn':
      await startLearningSession(supervisor, rl);
      break;

    case '/feedback':
      await handleFeedback(supervisor, rl, getLastQuery());
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

async function startLearningSession(
  supervisor: SupervisorOperator,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  console.log('\n🧠 Interactive Learning Session');
  console.log('─'.repeat(40));
  console.log('I\'ll ask questions to learn how you think.\n');

  const questions = await supervisor.getDailyQuestions(5);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`\n📝 Question ${i + 1}/5 (${q.domain.replace(/_/g, ' ')})`);
    console.log('─'.repeat(30));
    console.log(q.question);

    const answer = await new Promise<string>((resolve) => {
      rl.question('\n💭 Your answer: ', resolve);
    });

    if (answer.trim()) {
      console.log('\n🔄 Processing...');
      const analysis = await supervisor.submitAnswer(q.id, answer);
      console.log(`   ✓ Extracted ${analysis.extractedValues.length} value signals`);
    }
  }

  console.log('\n✅ Learning session complete!');
  console.log('   Run /profile to see your updated profile\n');
}

async function handleFeedback(
  supervisor: SupervisorOperator,
  rl: ReturnType<typeof createInterface>,
  lastQuery: string
): Promise<void> {
  if (!lastQuery) {
    console.log('\nNo recent query to give feedback on.');
    return;
  }

  console.log('\n📝 Give feedback on the last answer');
  console.log('─'.repeat(40));
  console.log(`Query: "${lastQuery.slice(0, 100)}..."`);

  const quality = await new Promise<string>((resolve) => {
    rl.question('\nQuality (good/partial/bad): ', resolve);
  });

  if (!['good', 'partial', 'bad'].includes(quality.toLowerCase())) {
    console.log('\n❌ Invalid quality. Use: good, partial, or bad');
    return;
  }

  let correction: string | undefined;
  if (quality.toLowerCase() === 'bad' || quality.toLowerCase() === 'partial') {
    correction = await new Promise<string>((resolve) => {
      rl.question('What would you have answered? (or press Enter to skip): ', resolve);
    });
  }

  await supervisor.giveFeedback(
    lastQuery,
    quality.toLowerCase() as 'good' | 'partial' | 'bad',
    correction || undefined
  );

  console.log('\n✅ Feedback recorded. I\'ll learn from this!');
}
