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

// Default command: if first arg doesn't match a command, treat as a question
program.parse();
