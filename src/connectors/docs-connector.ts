import { readFile, stat } from 'fs/promises';
import { extname, relative } from 'path';
import { glob } from 'glob';
import { v4 as uuid } from 'uuid';
import type { MemoryDocument } from '../core/memory.js';

export interface DocsConfig {
  paths: string[]; // Directories or files to scan
  extensions?: string[]; // File extensions to include (default: md, txt, json, yaml, yml)
  maxFileSize?: number; // Max file size in bytes (default: 500KB)
  maxFiles?: number; // Max files to process (default: 500)
}

const DEFAULT_EXTENSIONS = ['.md', '.txt', '.markdown', '.rst', '.json', '.yaml', '.yml'];
const DEFAULT_MAX_SIZE = 500 * 1024; // 500KB

export class DocsConnector {
  private paths: string[];
  private extensions: string[];
  private maxSize: number;
  private maxFiles: number;

  constructor(config: DocsConfig) {
    this.paths = config.paths;
    this.extensions = config.extensions || DEFAULT_EXTENSIONS;
    this.maxSize = config.maxFileSize || DEFAULT_MAX_SIZE;
    this.maxFiles = config.maxFiles || 500;
  }

  async discoverFiles(): Promise<string[]> {
    const allFiles: string[] = [];

    for (const path of this.paths) {
      try {
        const stats = await stat(path);
        if (stats.isFile()) {
          allFiles.push(path);
        } else if (stats.isDirectory()) {
          const pattern = `${path}/**/*{${this.extensions.join(',')}}`;
          const files = await glob(pattern, {
            nodir: true,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/data/**'],
          });
          allFiles.push(...files);
        }
      } catch {
        console.warn(`  Skipping inaccessible path: ${path}`);
      }
    }

    return allFiles;
  }

  async readFile(filePath: string): Promise<MemoryDocument | null> {
    try {
      const stats = await stat(filePath);
      if (stats.size > this.maxSize) {
        console.warn(`  Skipping large file: ${filePath} (${stats.size} bytes)`);
        return null;
      }

      const content = await readFile(filePath, 'utf-8');
      const ext = extname(filePath);
      const relPath = relative(process.cwd(), filePath);

      // Split long files into chunks (~2000 chars)
      const chunks = this.chunkText(content, 2000);

      // For single-chunk files, return one document
      if (chunks.length === 1) {
        return {
          id: `doc:${uuid()}`,
          text: `File: ${relPath}\n\n${chunks[0]}`,
          metadata: {
            source: relPath,
            type: 'document',
            extension: ext,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          },
        };
      }

      // For multi-chunk files, store the first chunk as the main doc
      // (Caller can handle chunking differently if needed)
      return {
        id: `doc:${uuid()}`,
        text: `File: ${relPath} (${chunks.length} sections)\n\n${chunks.join('\n---\n')}`,
        metadata: {
          source: relPath,
          type: 'document',
          extension: ext,
          size: stats.size,
          chunks: chunks.length,
          modified: stats.mtime.toISOString(),
        },
      };
    } catch {
      console.warn(`  Failed to read: ${filePath}`);
      return null;
    }
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const chunks: string[] = [];
    const lines = text.split('\n');
    let current = '';

    for (const line of lines) {
      if (current.length + line.length > maxChunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }

  async syncAll(): Promise<MemoryDocument[]> {
    const files = await this.discoverFiles();
    console.log(`Found ${files.length} documentation files.`);

    const toProcess = files.slice(0, this.maxFiles);
    if (files.length > this.maxFiles) {
      console.log(`Processing first ${this.maxFiles} files (use --max-files to adjust).`);
    }

    const docs: MemoryDocument[] = [];

    for (const file of toProcess) {
      const doc = await this.readFile(file);
      if (doc) docs.push(doc);
    }

    console.log(`Read ${docs.length} documents.`);
    return docs;
  }
}
