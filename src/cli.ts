#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { SupervisorOperator } from './core/supervisor.js';
import { startREPL } from './repl.js';

const program = new Command();

program
  .name('second-brain')
  .description('AI-powered organizational memory — proactive operators that save time and money')
  .version('0.1.0');

program
  .command('chat')
  .description('Start interactive chat session')
  .option('-v, --verbose', 'Show reasoning steps')
  .action(async () => {
    await startREPL();
  });

program
  .command('ask')
  .description('Ask a single question')
  .argument('<question>', 'The question to ask')
  .option('-v, --verbose', 'Show reasoning steps')
  .action(async (question: string, options) => {
    const supervisor = new SupervisorOperator();

    console.log(`\n🤔 ${question}\n`);

    const result = await supervisor.ask(question, options.verbose);

    console.log('━'.repeat(60));
    console.log(`\n📝 ${result.answer}`);

    if (result.citations.length > 0) {
      console.log('\n📚 Citations:');
      for (const cite of result.citations) {
        console.log(`   • [${cite.type}] ${cite.source}`);
        if (cite.url) console.log(`     ${cite.url}`);
        if (cite.excerpt) console.log(`     "${cite.excerpt.slice(0, 120)}..."`);
      }
    }

    console.log(`\n   Confidence: ${(result.confidence * 100).toFixed(0)}%`);

    if (options.verbose && result.steps.length > 0) {
      console.log('\n🔍 Reasoning steps:');
      for (const step of result.steps) {
        console.log(`   • ${step.thought}`);
        if (step.action) console.log(`     → ${step.action}`);
      }
    }

    console.log('\n' + '━'.repeat(60));
  });

program
  .command('sync')
  .description('Sync data from connected sources into memory')
  .option('-s, --sources <sources>', 'Comma-separated sources (github,docs,email,calendar)')
  .action(async (options) => {
    const supervisor = new SupervisorOperator();

    const sources = options.sources ? options.sources.split(',') : undefined;
    console.log(`\n🔄 Syncing${sources ? ` sources: ${sources.join(', ')}` : ' all sources'}...\n`);

    const results = await supervisor.sync(sources);

    console.log('\n━'.repeat(60));
    console.log('\nSync results:');
    for (const r of results) {
      console.log(`  ${r.source}: ${r.count} documents`);
    }
    console.log('\nSync complete!');
  });

program
  .command('scan')
  .description('Proactively scan for savings opportunities')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    const report = await supervisor.scan();
    console.log('\n' + '━'.repeat(60));
    console.log('\n' + report);
  });

program
  .command('status')
  .description('Show configured data sources and memory stats')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    const status = await supervisor.getStatus();

    console.log('\n📊 Data Source Status:\n');
    for (const s of status) {
      const icon = s.configured ? '✅' : '❌';
      const count = s.docCount ? ` (${s.docCount} docs in memory)` : '';
      console.log(`  ${icon} ${s.source}${s.configured ? '' : ' (not configured)'}${count}`);
    }
    console.log('\nSet credentials in .env to enable more sources.');
    console.log('See .env.example for required variables.');
  });

// ========== Learning Commands ==========

program
  .command('profile')
  .description('Show your learned decision profile')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    console.log('\n' + supervisor.getProfile());
    console.log('\n' + '━'.repeat(50));
  });

program
  .command('evolution')
  .description('Show system evolution and self-improvement report')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    console.log('\n' + supervisor.getEvolution());
    console.log('\n' + '━'.repeat(50));
  });

program
  .command('learn')
  .description('Start interactive learning session (answer questions)')
  .option('-c, --count <number>', 'Number of questions', '5')
  .action(async (options) => {
    const supervisor = new SupervisorOperator();
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

    console.log('\n🧠 Interactive Learning Session');
    console.log('━'.repeat(50));
    console.log('\nI\'ll ask you questions to learn how you think and decide.');
    console.log('Your answers help me reason more like you.\n');

    const questions = await supervisor.getDailyQuestions(parseInt(options.count));

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      console.log(`\n📝 Question ${i + 1}/${questions.length} (${q.domain.replace(/_/g, ' ')})`);
      console.log('─'.repeat(40));
      console.log(q.question);

      if (q.type === 'preference' || q.type === 'tradeoff') {
        console.log('\n(Take your time - I\'m learning your reasoning, not just your answer)');
      }

      const answer = await ask('\n💭 Your answer: ');

      if (answer.trim()) {
        console.log('\n🔄 Processing your response...');
        const analysis = await supervisor.submitAnswer(q.id, answer);
        console.log(`   ✓ Extracted ${analysis.extractedValues.length} value signals`);
        console.log(`   ✓ Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
      } else {
        console.log('   (Skipped)');
      }
    }

    console.log('\n' + '━'.repeat(50));
    console.log('\n✅ Learning session complete!');
    console.log('   Run `npx tsx src/cli.ts profile` to see your updated profile');
    rl.close();
  });

program
  .command('feedback')
  .description('Provide feedback on a recent answer')
  .argument('<quality>', 'good, partial, or bad')
  .option('-q, --query <query>', 'The original question')
  .option('-c, --correction <correction>', 'What you would have answered instead')
  .action(async (quality: string, options) => {
    if (!['good', 'partial', 'bad'].includes(quality)) {
      console.error('\n❌ Quality must be: good, partial, or bad');
      process.exit(1);
    }

    const supervisor = new SupervisorOperator();
    await supervisor.giveFeedback(
      options.query || 'recent query',
      quality as 'good' | 'partial' | 'bad',
      options.correction
    );

    console.log('\n✅ Feedback recorded. I\'ll learn from this!');
  });

program
  .command('analyze')
  .description('Analyze system performance and suggest improvements')
  .option('-d, --days <number>', 'Analysis window in days', '7')
  .action(async (options) => {
    const supervisor = new SupervisorOperator();
    const analysis = await supervisor.getAnalysis(parseInt(options.days));

    console.log('\n📊 Performance Analysis');
    console.log('━'.repeat(50));
    console.log(`\nPeriod: ${analysis.period}`);
    console.log(`Total queries: ${analysis.totalQueries}`);
    console.log(`Average confidence: ${(analysis.avgConfidence * 100).toFixed(0)}%`);
    console.log(`Average reasoning loops: ${analysis.avgLoops.toFixed(1)}`);
    console.log(`Search success rate: ${(analysis.searchSuccessRate * 100).toFixed(0)}%`);
    console.log(`Confidence trend: ${analysis.confidenceTrend}`);

    if (analysis.strongDomains.length > 0) {
      console.log('\n📈 Strong domains:');
      for (const d of analysis.strongDomains) {
        console.log(`   • ${d.domain}: ${(d.confidence * 100).toFixed(0)}%`);
      }
    }

    if (analysis.weakDomains.length > 0) {
      console.log('\n⚠️ Domains needing improvement:');
      for (const d of analysis.weakDomains) {
        console.log(`   • ${d.domain}: ${(d.confidence * 100).toFixed(0)}%`);
      }
    }

    if (analysis.improvements.length > 0) {
      console.log('\n💡 Suggested improvements:');
      for (const imp of analysis.improvements) {
        console.log(`   • ${imp.description}`);
        console.log(`     Expected: +${(imp.expectedImprovement * 100).toFixed(0)}% improvement`);
      }
    }

    console.log('\n' + '━'.repeat(50));
  });

// Default command: if first arg doesn't match a command, treat as a question
program.parse();
