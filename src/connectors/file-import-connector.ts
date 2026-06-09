import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import type { MemoryDocument } from '../core/memory.js';

export interface FileImport {
  path: string;
  buffer?: Buffer;
  originalName: string;
  mimeType?: string;
  size?: number;
  label?: string;
}

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.log', '.env', '.sh', '.bash', '.zsh', '.fish', '.py', '.js', '.ts', '.tsx', '.jsx', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.html', '.htm', '.sql', '.graphql', '.toml', '.ini', '.cfg', '.conf', '.properties']);

export class FileImportConnector {
  async parseFiles(files: FileImport[]): Promise<MemoryDocument[]> {
    const docs: MemoryDocument[] = [];

    for (const file of files) {
      try {
        const doc = await this.parseFile(file);
        if (doc) docs.push(doc);
      } catch (error) {
        console.error(`[Import] Failed to parse ${file.originalName}:`, error instanceof Error ? error.message : error);
      }
    }

    return docs;
  }

  private async parseFile(file: FileImport): Promise<MemoryDocument | null> {
    const ext = extname(file.originalName).toLowerCase();
    const name = basename(file.originalName, ext);
    const content = file.buffer || readFileSync(file.path);
    const label = file.label || 'import';

    let text = '';

    if (TEXT_EXTENSIONS.has(ext)) {
      text = content.toString('utf-8');
    } else if (ext === '.pdf') {
      text = await this.parsePdf(content);
    } else if (ext === '.docx') {
      text = await this.parseDocx(content);
    } else if (ext === '.xlsx' || ext === '.xls') {
      text = await this.parseExcel(content);
    } else if (ext === '.html' || ext === '.htm') {
      text = await this.parseHtml(content);
    } else if (ext === '.rtf') {
      text = this.parseRtf(content.toString('utf-8'));
    } else if (ext === '.epub') {
      text = await this.parseEpub(content);
    } else if (ext === '.pptx') {
      text = await this.parsePptx(content);
    } else {
      // Try as text, skip binary
      const decoded = content.toString('utf-8');
      if (decoded.includes('\0')) return null;
      text = decoded;
    }

    if (!text || text.trim().length === 0) return null;

    // Truncate very large documents
    text = text.slice(0, 50000);

    return {
      id: `import:${label}:${file.originalName}:${Date.now()}`,
      text: `${name}\n\n${text}`,
      metadata: {
        source: 'import',
        type: 'document',
        label,
        filename: file.originalName,
        format: ext.slice(1),
        size: file.size || content.length,
        date: new Date().toISOString(),
      },
    };
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    const pdfParse = await import('pdf-parse');
    const parser = (pdfParse as any).default || pdfParse;
    const data = await parser(buffer);
    return data.text;
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private async parseExcel(buffer: Buffer): Promise<string> {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`## ${sheetName}\n${csv}`);
    }

    return sheets.join('\n\n');
  }

  private async parseHtml(buffer: Buffer): Promise<string> {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(buffer.toString('utf-8'));
    // Remove script, style, nav elements
    $('script, style, nav, footer, header').remove();
    return $('body').text() || $.text();
  }

  private parseRtf(content: string): string {
    // Basic RTF stripping — remove RTF control words and braces
    return content
      .replace(/\{\\[^{}]*\}/g, '')
      .replace(/\\[a-z]+\d*\s?/gi, '')
      .replace(/[{}]/g, '')
      .trim();
  }

  private async parseEpub(buffer: Buffer): Promise<string> {
    // EPUB is a ZIP of XHTML files — extract text from the content
    const { readFileSync, writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const tmpPath = join(tmpdir(), `import-${Date.now()}.epub`);
    writeFileSync(tmpPath, buffer);

    try {
      const { execSync } = await import('child_process');
      // Use unzip to extract and read HTML content
      const html = execSync(`unzip -p "${tmpPath}" '*.xhtml' '*.html' '*.htm' 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      return $('body').text() || $.text();
    } finally {
      unlinkSync(tmpPath);
    }
  }

  private async parsePptx(buffer: Buffer): Promise<string> {
    // PPTX is a ZIP of XML slides
    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const tmpPath = join(tmpdir(), `import-${Date.now()}.pptx`);
    writeFileSync(tmpPath, buffer);

    try {
      const { execSync } = await import('child_process');
      const xml = execSync(`unzip -p "${tmpPath}" 'ppt/slides/slide*.xml' 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      // Strip XML tags to get plain text
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } finally {
      unlinkSync(tmpPath);
    }
  }

  async parseUrl(url: string, label?: string): Promise<MemoryDocument | null> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());

    let text = '';
    if (contentType.includes('text/html')) {
      text = await this.parseHtml(buffer);
    } else if (contentType.includes('application/pdf')) {
      text = await this.parsePdf(buffer);
    } else {
      text = buffer.toString('utf-8');
    }

    if (!text || text.trim().length === 0) return null;

    const title = url.split('/').pop() || url;
    return {
      id: `import:url:${url}:${Date.now()}`,
      text: `${title}\nSource: ${url}\n\n${text.slice(0, 50000)}`,
      metadata: {
        source: 'import',
        type: 'url',
        label: label || 'url-import',
        url,
        date: new Date().toISOString(),
      },
    };
  }
}
