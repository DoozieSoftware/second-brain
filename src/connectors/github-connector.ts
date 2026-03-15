import { Octokit } from 'octokit';
import type { MemoryDocument } from '../core/memory.js';

export interface GitHubConfig {
  token: string;
  owner?: string;
  repos?: string[]; // If not provided, fetches all accessible repos
}

export class GitHubConnector {
  private octokit: Octokit;
  private owner: string | undefined;
  private repos: string[] | undefined;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repos = config.repos;
  }

  async fetchRepos(): Promise<{ owner: string; name: string }[]> {
    if (this.repos && this.owner) {
      return this.repos.map((name) => ({ owner: this.owner!, name }));
    }

    const repos: { owner: string; name: string }[] = [];
    for await (const response of this.octokit.paginate.iterator(
      this.octokit.rest.repos.listForAuthenticatedUser,
      { per_page: 100, sort: 'updated' }
    )) {
      for (const repo of response.data) {
        repos.push({ owner: repo.owner.login, name: repo.name });
      }
    }
    return repos;
  }

  async fetchIssuesAndPRs(
    owner: string,
    repo: string,
    since?: string
  ): Promise<MemoryDocument[]> {
    const docs: MemoryDocument[] = [];
    const sinceDate = since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch issues (includes PRs in the API)
    for await (const response of this.octokit.paginate.iterator(
      this.octokit.rest.issues.listForRepo,
      { owner, repo, state: 'all', since: sinceDate, per_page: 100 }
    )) {
      for (const item of response.data) {
        // Skip pull requests (they show up in issues API)
        if (item.pull_request) continue;

        const body = item.body || '';
        const comments = await this.fetchIssueComments(owner, repo, item.number);
        const fullText = `Issue #${item.number}: ${item.title}\n\n${body}\n\n${comments}`;

        docs.push({
          id: `github:${owner}/${repo}:issue:${item.number}`,
          text: fullText.slice(0, 8000), // Cap length
          metadata: {
            source: `github:${owner}/${repo}`,
            type: 'issue',
            number: item.number,
            title: item.title,
            state: item.state,
            author: item.user?.login || 'unknown',
            url: item.html_url,
            date: item.created_at,
            updated: item.updated_at,
          },
        });
      }
    }

    // Fetch PRs
    for await (const response of this.octokit.paginate.iterator(
      this.octokit.rest.pulls.list,
      { owner, repo, state: 'all', per_page: 50 }
    )) {
      for (const pr of response.data) {
        const body = pr.body || '';
        const fullText = `PR #${pr.number}: ${pr.title}\n\n${body}`;

        docs.push({
          id: `github:${owner}/${repo}:pr:${pr.number}`,
          text: fullText.slice(0, 8000),
          metadata: {
            source: `github:${owner}/${repo}`,
            type: 'pr',
            number: pr.number,
            title: pr.title,
            state: pr.state,
            author: pr.user?.login || 'unknown',
            url: pr.html_url,
            date: pr.created_at,
            updated: pr.updated_at,
            merged: pr.merged_at ? true : false,
          },
        });
      }
    }

    return docs;
  }

  private async fetchIssueComments(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<string> {
    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 20,
      });
      return comments
        .map((c) => `[${c.user?.login}]: ${c.body?.slice(0, 500) || ''}`)
        .join('\n');
    } catch {
      return '';
    }
  }

  async fetchReadme(owner: string, repo: string): Promise<MemoryDocument | null> {
    try {
      const { data } = await this.octokit.rest.repos.getReadme({ owner, repo });
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return {
        id: `github:${owner}/${repo}:readme`,
        text: `README for ${owner}/${repo}:\n\n${content.slice(0, 10000)}`,
        metadata: {
          source: `github:${owner}/${repo}`,
          type: 'readme',
          url: `https://github.com/${owner}/${repo}`,
        },
      };
    } catch {
      return null;
    }
  }

  async syncAll(since?: string): Promise<MemoryDocument[]> {
    const allDocs: MemoryDocument[] = [];
    const repos = await this.fetchRepos();

    console.log(`Syncing ${repos.length} repos...`);

    for (const { owner, name } of repos) {
      console.log(`  Fetching ${owner}/${name}...`);

      const [issuesAndPRs, readme] = await Promise.all([
        this.fetchIssuesAndPRs(owner, name, since),
        this.fetchReadme(owner, name),
      ]);

      allDocs.push(...issuesAndPRs);
      if (readme) allDocs.push(readme);
    }

    console.log(`Total documents fetched: ${allDocs.length}`);
    return allDocs;
  }
}
