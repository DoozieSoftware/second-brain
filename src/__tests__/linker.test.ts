import { describe, it, expect } from 'vitest';
import { CrossSourceLinker } from '../core/linker.js';

describe('CrossSourceLinker entity extraction', () => {
  const linker = new CrossSourceLinker(null as any);

  it('should extract PR numbers', () => {
    const text = 'Fixed in PR #42 and also PR#123 needs review';
    const entities = linker.extractEntities(text, 'github');

    const prEntities = entities.filter(e => e.type === 'pr_number');
    expect(prEntities).toHaveLength(2);
    expect(prEntities[0].value).toBe('42');
    expect(prEntities[1].value).toBe('123');
  });

  it('should extract issue numbers', () => {
    const text = 'Related to issue #56 and Issue #78';
    const entities = linker.extractEntities(text, 'github');

    const issueEntities = entities.filter(e => e.type === 'issue_number');
    expect(issueEntities).toHaveLength(2);
    expect(issueEntities[0].value).toBe('56');
    expect(issueEntities[1].value).toBe('78');
  });

  it('should extract email addresses as persons', () => {
    const text = 'Email from john@example.com about the project';
    const entities = linker.extractEntities(text, 'email');

    const personEntities = entities.filter(e => e.type === 'person');
    expect(personEntities).toHaveLength(1);
    expect(personEntities[0].value).toBe('john@example.com');
  });

  it('should extract @mentions', () => {
    const text = 'Assigned to @alice for review';
    const entities = linker.extractEntities(text, 'github');

    const personEntities = entities.filter(e => e.type === 'person');
    expect(personEntities).toHaveLength(1);
    expect(personEntities[0].value).toBe('@alice');
  });

  it('should extract GitHub URLs', () => {
    const text = 'See https://github.com/org/repo/pull/42 for details';
    const entities = linker.extractEntities(text, 'email');

    const urlEntities = entities.filter(e => e.type === 'url');
    expect(urlEntities).toHaveLength(1);
    expect(urlEntities[0].value).toContain('github.com');
  });

  it('should return empty array for text with no entities', () => {
    const text = 'Just some regular text with no special patterns';
    const entities = linker.extractEntities(text, 'docs');

    expect(entities).toHaveLength(0);
  });

  it('should deduplicate entities', () => {
    const text = 'PR #42 mentioned again as PR #42';
    const entities = linker.extractEntities(text, 'github');

    const prEntities = entities.filter(e => e.type === 'pr_number');
    expect(prEntities).toHaveLength(1);
    expect(prEntities[0].value).toBe('42');
  });
});
