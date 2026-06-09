import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import type { MemoryDocument } from '../core/memory.js';

const IOS_TS = /^\[\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2}(?::\d{2})\]/;
const ANDROID_TS = /^\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2}/;
const MSG_IOS = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}(?::\d{2})\s*(?:am|pm)?)\]\s*([^:]+?):\s([\s\S]*?)$/i;
const MSG_ANDROID = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}\s*(?:am|pm)?)\s*-\s*([^:]+?):\s([\s\S]*?)$/i;
const SYSTEM_PATTERNS = /(?:end-to-end encrypted|Messages and calls are|added|removed|changed the subject|created group|left|security code changed|deleted this message)/i;

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
      if (ext === '.txt' && this.isWhatsApp(text)) {
        return this.parseWhatsApp(text, name, label);
      }
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

  private isWhatsApp(text: string): boolean {
    const sample = text.slice(0, 500);
    const lines = sample.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;
    const matched = lines.filter(l => IOS_TS.test(l) || ANDROID_TS.test(l));
    return matched.length >= Math.min(2, lines.length);
  }

  private parseWhatsApp(raw: string, chatName: string, label: string): MemoryDocument {
    const lines = raw.split('\n');
    const messages: { date: string; time: string; sender: string; text: string }[] = [];
    const msgRegex = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)\]?\s*-?\s*([^:]+?):\s(.*)/i;

    for (const line of lines) {
      const m = line.match(msgRegex);
      if (m) {
        const [, date, time, sender, text] = m;
        if (SYSTEM_PATTERNS.test(text)) continue;
        if (/<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted/i.test(text)) continue;
        messages.push({ date: date.trim(), time: time.trim(), sender: sender.trim(), text: text.trim() });
      } else if (messages.length > 0 && line.trim()) {
        messages[messages.length - 1].text += '\n' + line;
      }
    }

    if (messages.length === 0) {
      return {
        id: `import:whatsapp:${chatName}:${Date.now()}`,
        text: `${chatName}\n\n${raw.slice(0, 50000)}`,
        metadata: {
          source: 'whatsapp',
          type: 'chat',
          chat_name: chatName,
          label: label || 'whatsapp',
          message_count: 0,
          date: new Date().toISOString(),
        },
      };
    }

    const participants = [...new Set(messages.map(m => m.sender))];
    const dates = messages.map(m => m.date);
    const dateRange = `${dates[0]} to ${dates[dates.length - 1]}`;

    const transcript = messages
      .map(m => `[${m.date} ${m.time}] ${m.sender}: ${m.text}`)
      .join('\n');

    const truncated = transcript.slice(0, 50000);

    return {
      id: `import:whatsapp:${chatName}:${Date.now()}`,
      text: `${chatName}\nChat: ${chatName} · ${participants.length} participants · ${messages.length} messages · ${dateRange}\n\n${truncated}`,
      metadata: {
        source: 'whatsapp',
        type: 'chat',
        chat_name: chatName,
        label: label || 'whatsapp',
        message_count: messages.length,
        participants: participants.join(', '),
        date_range: dateRange,
        date: new Date().toISOString(),
      },
    };
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
