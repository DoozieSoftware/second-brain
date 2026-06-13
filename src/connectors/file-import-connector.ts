import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import type { MemoryDocument } from '../core/memory.js';

const IOS_TS = /^\[\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2}(?::\d{2})\]/;
const ANDROID_TS = /^\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2}/;
const MSG_IOS = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}(?::\d{2})\s*(?:am|pm)?)\]\s*([^:]+?):\s([\s\S]*?)$/i;
const MSG_ANDROID = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}\s*(?:am|pm)?)\s*-\s*([^:]+?):\s([\s\S]*?)$/i;
const SYSTEM_PATTERNS = /(?:end-to-end encrypted|Messages and calls are|added|removed|changed the subject|created group|left|security code changed|deleted this message)/i;

const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 50 MB cap on URL-fetched content
const FETCH_TIMEOUT_MS = 10_000;

/** Reject URLs that resolve to private/loopback/link-local/reserved IP ranges.
 *  Protects against SSRF to cloud metadata (169.254.169.254), localhost services,
 *  and internal RFC1918 networks. */
async function assertSafeHttpsUrl(input: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed');
  }
  const hostname = parsed.hostname;
  if (!hostname) throw new Error('URL has no hostname');

  // Literal IPs are rejected up front — only DNS-resolved hostnames pass.
  if (isIP(hostname)) {
    throw new Error('Direct IP addresses are not allowed');
  }

  // Resolve all A/AAAA records and check each one.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS resolution failed: ${err instanceof Error ? err.message : err}`);
  }
  if (addresses.length === 0) throw new Error('No DNS records found');

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch private/internal address: ${address}`);
    }
  }
  return parsed;
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;                        // 10.0.0.0/8
    if (a === 127) return true;                       // 127.0.0.0/8 loopback
    if (a === 0) return true;                         // 0.0.0.0/8
    if (a === 169 && b === 254) return true;          // 169.254.0.0/16 link-local (cloud metadata!)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;          // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;// 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                        // multicast + reserved
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase().split('%')[0]!;
    if (lower === '::1' || lower === '::') return true;            // loopback / unspecified
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('ff')) return true;                       // multicast
    return false;
  }
  return true; // unknown family → treat as private
}

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
    // SSRF guard: enforce https, reject literal IPs, resolve hostname, and refuse
    // any address in private/loopback/link-local/CGNAT ranges.
    const safeUrl = await assertSafeHttpsUrl(url);

    const response = await fetch(safeUrl.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${safeUrl}`);

    // Cap body size — refuse anything larger than MAX_IMPORT_BYTES.
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_IMPORT_BYTES) {
      throw new Error(`Response too large: ${contentLength} bytes (cap ${MAX_IMPORT_BYTES})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMPORT_BYTES) {
      throw new Error(`Response too large: ${arrayBuffer.byteLength} bytes (cap ${MAX_IMPORT_BYTES})`);
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(arrayBuffer);

    let text = '';
    if (contentType.includes('text/html')) {
      text = await this.parseHtml(buffer);
    } else if (contentType.includes('application/pdf')) {
      text = await this.parsePdf(buffer);
    } else {
      text = buffer.toString('utf-8');
    }

    if (!text || text.trim().length === 0) return null;

    const title = safeUrl.pathname.split('/').filter(Boolean).pop() || safeUrl.hostname;
    return {
      id: `import:url:${safeUrl.toString()}:${Date.now()}`,
      text: `${title}\nSource: ${safeUrl.toString()}\n\n${text.slice(0, 50000)}`,
      metadata: {
        source: 'import',
        type: 'url',
        label: label || 'url-import',
        url: safeUrl.toString(),
        date: new Date().toISOString(),
      },
    };
  }
}
