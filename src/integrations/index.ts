import { ConnectorRegistry, connectorRegistry } from './connector-registry.js';
import { GitLabAdapter } from './adapters/gitlab-adapter.js';
import { JiraAdapter } from './adapters/jira-adapter.js';
import { LinearAdapter } from './adapters/linear-adapter.js';
import { SlackAdapter } from './adapters/slack-adapter.js';
import { DiscordAdapter } from './adapters/discord-adapter.js';
import { NotionAdapter } from './adapters/notion-adapter.js';
import { ConfluenceAdapter } from './adapters/confluence-adapter.js';
import { CrmAdapter } from './adapters/crm-adapter.js';
import { GWorkspaceAdapter } from './adapters/gworkspace-adapter.js';
import { InternalApiAdapter } from './adapters/internal-api-adapter.js';

/**
 * Integration framework entry point.
 *
 * Every new source should:
 *  1. Implement SourceConnector in src/integrations/adapters/
 *  2. Register it here (one line)
 *  3. Optionally expose it via the supervisor's sync list
 */
export function registerAllConnectors(registry: ConnectorRegistry = connectorRegistry): ConnectorRegistry {
  registry.registerMany([
    new GitLabAdapter(),
    new JiraAdapter(),
    new LinearAdapter(),
    new SlackAdapter(),
    new DiscordAdapter(),
    new NotionAdapter(),
    new ConfluenceAdapter(),
    new CrmAdapter(),
    new GWorkspaceAdapter(),
    new InternalApiAdapter(),
  ]);
  return registry;
}

export { connectorRegistry, ConnectorRegistry } from './connector-registry.js';
export type { SourceConnector, SyncOptions, ConfigValidation, ConnectorStatus } from './base-connector.js';
export { BaseApiConnector, makeDoc } from './base-connector.js';
