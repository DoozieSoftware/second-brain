import { execSync } from 'child_process';
import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { GitHubConnector } from '../connectors/github-connector.js';

function getGitHubToken(): string {
  // Try env var first
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // Fall back to gh CLI
  try {
    return execSync('gh auth token', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export class GitHubOperator extends Operator {
  private connector: GitHubConnector;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    const tools = new ToolRegistry();
    super('github', reasoning, memory, tools);

    const token = getGitHubToken();
    this.connector = new GitHubConnector({
      token,
      owner: process.env.GITHUB_ORG || undefined,
    });

    this.registerTools();
  }

  private registerTools(): void {
    this.tools.register({
      name: 'list_repos',
      description: 'List all accessible GitHub repositories',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const repos = await this.connector.fetchRepos();
        return repos.map((r) => `${r.owner}/${r.name}`).join('\n');
      },
    });

    this.tools.register({
      name: 'search_code',
      description: 'Search code in a specific repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          query: { type: 'string', description: 'Search query' },
        },
        required: ['owner', 'repo', 'query'],
      },
      handler: async (args) => {
        try {
          const results = await this.connector['octokit'].rest.search.code({
            q: `${args.query} repo:${args.owner}/${args.repo}`,
            per_page: 10,
          });
          return results.data.items
            .map((item) => `${item.path}: ${item.name}\n${item.html_url}`)
            .join('\n\n');
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });
  }

  async sync(since?: string): Promise<number> {
    const token = getGitHubToken();
    if (!token) {
      console.error('[GitHub] No token available. Set GITHUB_TOKEN or run `gh auth login`');
      return 0;
    }

    console.log('[GitHub] Starting sync...');
    const docs = await this.connector.syncAll(since);
    return this.memory.ingest(docs);
  }
}
