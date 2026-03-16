#!/usr/bin/env tsx
/**
 * Scheduled scan runner for Second Brain.
 *
 * Usage:
 *   npx tsx src/scan-runner.ts                    # Run scan and save results
 *   npx tsx src/scan-runner.ts --slack <webhook>  # Also send to Slack
 *   npx tsx src/scan-runner.ts --sync             # Sync sources first, then scan
 *
 * Cron example (daily at 9am):
 *   0 9 * * * cd /path/to/second-brain && npx tsx src/scan-runner.ts --sync --slack $SLACK_WEBHOOK
 */

import 'dotenv/config';
import { SupervisorOperator } from './core/supervisor.js';

async function main() {
  const args = process.argv.slice(2);
  const shouldSync = args.includes('--sync');
  const slackWebhookIdx = args.indexOf('--slack');
  const slackWebhook = slackWebhookIdx >= 0 ? args[slackWebhookIdx + 1] : null;

  const supervisor = new SupervisorOperator();

  // Optional: sync first
  if (shouldSync) {
    console.log('🔄 Syncing sources...');
    const results = await supervisor.sync();
    for (const r of results) {
      console.log(`  ${r.source}: ${r.count} documents`);
    }
    console.log('');
  }

  // Run scan and persist
  console.log('🔍 Running savings scan...');
  const report = await supervisor.scanAndStore();

  if (typeof report === 'string') {
    console.log(report);
    return;
  }

  console.log(`\n✅ Found ${report.totalAlerts} issues (${report.highPriority} high priority)`);
  console.log(`   Estimated waste: ${report.totalEstimatedHours.toFixed(0)}h/month = $${report.totalEstimatedDollars.toFixed(0)}/month`);

  // Send to Slack if configured
  if (slackWebhook) {
    console.log('\n📤 Sending to Slack...');
    try {
      const payload = supervisor.getSlackPayload();
      const response = await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        console.log('   ✅ Sent to Slack');
      } else {
        console.log(`   ❌ Slack error: ${response.status}`);
      }
    } catch (error) {
      console.log(`   ❌ Slack error: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Print digest
  const digest = supervisor.getEmailDigest();
  console.log('\n' + '─'.repeat(50));
  console.log(digest.text);
}

main().catch(console.error);
