#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { Command } from 'commander';
import { SupervisorOperator } from './core/supervisor.js';
import { startREPL } from './repl.js';

// Load .env with override:true so a stale shell-exported key can't shadow the .env one.
dotenv.config({ override: true });

const program = new Command();

program
  .name('second-brain')
  .description('AI-powered organizational memory — proactive operators that save time and money')
  .version('1.0.0');

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

// ========== Integration Commands ==========

program
  .command('integrations')
  .description('List integration-framework sources and their config status')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    const statuses = supervisor.getIntegrationStatus();
    console.log('\n🔌 Integration Framework\n');
    console.log('━'.repeat(60));
    if (statuses.length === 0) {
      console.log('\nNo integrations registered.');
      return;
    }
    for (const s of statuses) {
      const icon = s.configured ? '✅' : '⬜';
      console.log(`\n${icon} ${s.name} — ${s.description}`);
      console.log(`   kind: ${s.kind} | configured: ${s.configured ? 'yes' : 'no'}`);
      if (s.requiredConfig.length > 0) {
        console.log(`   requires: ${s.requiredConfig.join(', ')}`);
      }
      if (s.lastSync) console.log(`   last sync: ${s.lastSync}`);
      if (s.itemCount !== undefined) console.log(`   items: ${s.itemCount}`);
    }
    console.log('\n' + '━'.repeat(60));
    console.log('\nSync an integration:  npx tsx src/cli.ts sync --sources gitlab');
    console.log('Test a connection:    POST /integrations/<name>/test');
  });

program
  .command('integration:test')
  .description('Test a connection to an integration')
  .argument('<name>', 'Integration name (gitlab, jira, linear, slack, ...)')
  .action(async (name: string) => {
    const { connectorRegistry } = await import('./integrations/index.js');
    const adapter = connectorRegistry.get(name);
    if (!adapter) {
      console.error(`\n❌ Integration "${name}" not found. Run "integrations" to list them.`);
      process.exit(1);
    }
    const result = await adapter.testConnection();
    console.log(`\n${result.ok ? '✅' : '❌'} ${name}: ${result.message}`);
  });

// ========== Analytics Command ==========

program
  .command('analytics')
  .description('Generate operational analytics: insights and trends')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    const snapshot = await supervisor.generateAnalytics();

    console.log('\n📊 Analytics Snapshot\n');
    console.log('━'.repeat(60));
    console.log(`\nSummary:`);
    console.log(`  Queries: ${snapshot.summary.totalQueries} | Errors: ${snapshot.summary.totalErrors}`);
    console.log(`  Error rate: ${(snapshot.summary.errorRate * 100).toFixed(0)}% | Health: ${snapshot.summary.health}`);
    console.log(`  Documents: ${snapshot.summary.documents} | Decisions: ${snapshot.summary.decisionCount} | Goals: ${snapshot.summary.goals}`);

    if (snapshot.trends.length > 0) {
      console.log('\nTrends:');
      for (const t of snapshot.trends) {
        const icon = t.direction === 'improving' ? '📈' : t.direction === 'worsening' ? '📉' : '➡️';
        console.log(`  ${icon} ${t.title} (${t.direction}, Δ${t.delta.toFixed(1)})`);
      }
    }

    if (snapshot.insights.length > 0) {
      console.log('\nInsights:');
      for (const ins of snapshot.insights) {
        const icon = ins.severity === 'critical' ? '🔴' : ins.severity === 'warning' ? '🟠' : '💡';
        console.log(`  ${icon} [${ins.category}] ${ins.title}`);
        console.log(`     ${ins.detail}`);
        if (ins.recommendation) console.log(`     → ${ins.recommendation}`);
      }
    } else {
      console.log('\nNo insights — system looks healthy.');
    }
    console.log('\n' + '━'.repeat(60));
  });

// ========== Knowledge Commands ==========

program
  .command('knowledge:search')
  .description('Search the knowledge base')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Max results', '5')
  .action(async (query: string, options) => {
    const supervisor = new SupervisorOperator();
    const limit = Number(options.limit) || 5;
    const results = await supervisor.search(query, limit);

    console.log(`\n🔍 "${query}" — ${results.length} result(s)\n`);
    if (results.length === 0) {
      console.log('  No matches found.');
    }
    for (const r of results) {
      console.log(`  • [${String(r.metadata.source ?? 'memory')}] ${r.text.slice(0, 100)}${r.text.length > 100 ? '...' : ''}`);
    }
    console.log('\n' + '━'.repeat(60));
  });

program
  .command('knowledge:tags')
  .description('List all tags in the knowledge base')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    const tags = await supervisor.getMemory().getAllTags();

    console.log('\n🏷️  Tags\n');
    if (tags.length === 0) {
      console.log('  No tags yet. Add them via POST /knowledge/documents/:id/tags');
      console.log('\n' + '━'.repeat(60));
      return;
    }
    for (const { tag, count } of tags) {
      console.log(`  • ${tag} (${count} doc${count === 1 ? '' : 's'})`);
    }
    console.log('\n' + '━'.repeat(60));
  });

program
  .command('knowledge:versions')
  .description('Show version history for a document')
  .argument('<id>', 'Document id')
  .action(async (id: string) => {
    const supervisor = new SupervisorOperator();
    const versions = await supervisor.getMemory().getVersions(id);

    console.log(`\n📜 Versions for ${id}\n`);
    if (versions.length === 0) {
      console.log('  No version history.');
    }
    for (const v of versions) {
      console.log(`  v${v.version} (${v.updatedAt.slice(0, 10)}) ${v.hash}`);
      console.log(`     ${v.text.slice(0, 100)}${v.text.length > 100 ? '...' : ''}`);
    }
    console.log('\n' + '━'.repeat(60));
  });

// ========== Identity Commands ==========

program
  .command('user:create')
  .description('Create a user (prints their API key once)')
  .argument('<email>', 'User email')
  .option('-n, --name <name>', 'Display name')
  .option('-r, --role <role>', 'Role: admin|editor|viewer', 'viewer')
  .action(async (email: string, options) => {
    const { IdentityStore } = await import('./identity/identity-store.js');
    const store = new IdentityStore();
    const { user, apiKey } = store.createUser({ email, name: options.name, role: options.role });
    console.log(`\n✅ User created: ${user.email} (${user.role})`);
    console.log(`   ID: ${user.id}`);
    console.log(`\n   🔑 API Key (shown once): ${apiKey}\n`);
    console.log('   Use it as: Authorization: Bearer <key>');
  });

program
  .command('user:list')
  .description('List all users')
  .action(async () => {
    const { IdentityStore } = await import('./identity/identity-store.js');
    const store = new IdentityStore();
    const users = store.listUsers();
    console.log('\n👥 Users\n');
    console.log('━'.repeat(60));
    if (users.length === 0) {
      console.log('\nNo users yet. Create one with: npx tsx src/cli.ts user:create you@company.com');
      return;
    }
    for (const u of users) {
      console.log(`\n• ${u.name} <${u.email}>`);
      console.log(`  role: ${u.role} | keys: ${u.apiKeysCount} | disabled: ${u.disabled ? 'yes' : 'no'}`);
      console.log(`  id: ${u.id}`);
    }
    console.log('\n' + '━'.repeat(60));
  });

// ========== Strategy Commands ==========

program
  .command('strategy')
  .description('Show strategic overview (goals, initiatives, progress)')
  .option('-q, --quarter <quarter>', 'Filter by quarter, e.g. 2026-Q3')
  .action(async (options) => {
    const supervisor = new SupervisorOperator();
    const view = supervisor.getStrategy().quarterlyView(options.quarter);

    console.log('\n🎯 Strategic Overview\n');
    console.log('━'.repeat(60));
    if (view.length === 0) {
      console.log('\nNo goals recorded yet. Create one with:');
      console.log('  npx tsx src/cli.ts strategy:goal "Reduce infra spend" --quarter 2026-Q3');
      return;
    }

    for (const v of view) {
      const statusIcon = { proposed: '📝', active: '🚀', at_risk: '⚠️', completed: '✅', cancelled: '🚫' }[v.goal.status] || '•';
      console.log(`\n${statusIcon} ${v.goal.title} [${v.goal.status}] — ${v.progress}%`);
      if (v.goal.quarter) console.log(`   Quarter: ${v.goal.quarter}`);
      for (const item of v.initiatives) {
        const p = { p0: '🔴', p1: '🟠', p2: '🟡', p3: '🔵' }[item.initiative.priority] || '•';
        console.log(`   ${p} ${item.initiative.title} [${item.initiative.status}] — ${item.progress}%`);
        for (const m of item.milestones) {
          const mark = m.status === 'done' ? '✅' : m.status === 'in_progress' ? '🔄' : '⬜';
          console.log(`      ${mark} ${m.title}${m.dueDate ? ` (due ${m.dueDate})` : ''}`);
        }
      }
    }
    console.log('\n' + '━'.repeat(60));
  });

program
  .command('strategy:goal')
  .description('Create a new strategic goal')
  .argument('<title>', 'Goal title')
  .option('-q, --quarter <quarter>', 'Quarter, e.g. 2026-Q3', '2026-Q3')
  .option('-o, --owner <owner>', 'Owner')
  .action(async (title: string, options) => {
    const supervisor = new SupervisorOperator();
    const goal = supervisor.getStrategy().createGoal({
      title,
      quarter: options.quarter,
      owner: options.owner,
      tags: [],
    });
    console.log(`\n✅ Goal created: ${goal.title}`);
    console.log(`   ID: ${goal.id}`);
  });

program
  .command('strategy:initiative')
  .description('Create a new initiative under a goal')
  .argument('<goalId>', 'Goal id (strategy:goal output)')
  .argument('<title>', 'Initiative title')
  .option('-p, --priority <priority>', 'Priority: p0-p3', 'p2')
  .action(async (goalId: string, title: string, options) => {
    const supervisor = new SupervisorOperator();
    const initiative = supervisor.getStrategy().createInitiative({
      goalId,
      title,
      priority: options.priority,
      tags: [],
    });
    if (!initiative) {
      console.error(`\n❌ Goal "${goalId}" not found.`);
      process.exit(1);
    }
    console.log(`\n✅ Initiative created: ${initiative.title}`);
    console.log(`   ID: ${initiative.id}`);
  });

program
  .command('strategy:roadmap')
  .description('List recorded roadmaps')
  .action(async () => {
    const supervisor = new SupervisorOperator();
    const roadmaps = supervisor.getStrategy().listRoadmaps();
    console.log('\n🗺️ Roadmaps\n');
    console.log('━'.repeat(60));
    if (roadmaps.length === 0) {
      console.log('\nNo roadmaps recorded.');
      return;
    }
    for (const r of roadmaps) {
      console.log(`\n• ${r.title} (${r.quarters.join(', ')})`);
      const detail = supervisor.getStrategy().roadmapDetail(r.id);
      for (const i of detail.initiatives) {
        console.log(`   - ${i.title}`);
      }
    }
    console.log('\n' + '━'.repeat(60));
  });

// ========== Decision Commands ==========

program
  .command('decisions')
  .description('List recorded decisions (ADRs)')
  .option('-s, --status <status>', 'Filter by status: proposed|accepted|rejected|superseded|implemented')
  .action(async (options) => {
    const supervisor = new SupervisorOperator();
    const decisions = supervisor.getDecisions().list(options.status);

    console.log('\n📋 Decision Log\n');
    console.log('━'.repeat(60));
    if (decisions.length === 0) {
      console.log('\nNo decisions recorded yet.');
      return;
    }
    for (const d of decisions) {
      console.log(`\n${d.title}`);
      console.log(`   status: ${d.status} | decided: ${d.decidedAt ?? 'n/a'}`);
      console.log(`   decision: ${d.decision}`);
      console.log(`   rationale: ${d.rationale.slice(0, 140)}`);
      if (d.supersedes.length > 0) console.log(`   supersedes: ${d.supersedes.join(', ')}`);
    }
    console.log('\n' + '━'.repeat(60));
  });

program
  .command('decision:record')
  .description('Record a decision (ADR)')
  .argument('<title>', 'Decision title, e.g. "ADR-0003: Use Postgres"')
  .option('-c, --context <context>', 'Context / question being decided')
  .option('-d, --decision <decision>', 'What was decided')
  .option('-r, --rationale <rationale>', 'Why')
  .option('-k, --keywords <keywords>', 'Comma-separated keywords')
  .option('-o, --owner <owner>', 'Owner')
  .option('-s, --status <status>', 'Status', 'proposed')
  .action(async (title: string, options) => {
    const supervisor = new SupervisorOperator();
    const decision = supervisor.getDecisions().record({
      title,
      status: options.status,
      context: options.context || 'No context recorded',
      decision: options.decision || 'No decision statement',
      rationale: options.rationale || 'No rationale recorded',
      options: [],
      owners: options.owner ? [options.owner] : [],
      keywords: options.keywords ? options.keywords.split(',').map((s: string) => s.trim()) : [],
      relatedDocIds: [],
      supersedes: [],
      supersededBy: [],
    });
    console.log(`\n✅ Decision recorded: ${decision.title}`);
    console.log(`   ID: ${decision.id}`);
  });

program
  .command('decision:impact')
  .description('Analyze the impact of a recorded decision')
  .argument('<id>', 'Decision id (adr_...) or keyword')
  .action(async (id: string) => {
    const supervisor = new SupervisorOperator();
    let decisionId = id;
    if (!id.startsWith('adr_')) {
      const matches = supervisor.getDecisions().searchByKeyword(id);
      if (matches.length === 0) {
        console.error(`\n❌ No decision found for "${id}"`);
        process.exit(1);
      }
      decisionId = matches[0].id;
    }
    const impact = await supervisor.analyzeDecisionImpact(decisionId);
    console.log('\n🔍 Decision Impact Analysis\n');
    console.log('━'.repeat(60));
    console.log(`\n${impact.decision.title}`);
    console.log(`   ${impact.summary}`);
    if (impact.relatedDocs.length > 0) {
      console.log('\n📄 Related documents:');
      for (const d of impact.relatedDocs.slice(0, 6)) {
        console.log(`   • [${d.source}/${d.type}] ${d.excerpt.slice(0, 100)}...`);
      }
    }
    if (impact.chainedDecisions.length > 0) {
      console.log('\n🔗 Follow-up decisions:');
      for (const c of impact.chainedDecisions.slice(0, 6)) {
        console.log(`   • ${c.title} [${c.status}]`);
      }
    }
    console.log('\n' + '━'.repeat(60));
  });

// Default command: if first arg doesn't match a command, treat as a question
program.parse();
