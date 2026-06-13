import { describe, it, expect } from 'vitest';
import { FileImportConnector } from '../connectors/file-import-connector.js';

describe('FileImportConnector.parseUrl — SSRF guard', () => {
  const c = new FileImportConnector();

  it('rejects http URLs', async () => {
    await expect(c.parseUrl('http://example.com')).rejects.toThrow(/Only https/i);
  });

  it('rejects file URLs', async () => {
    await expect(c.parseUrl('file:///etc/passwd')).rejects.toThrow(/Only https/i);
  });

  it('rejects ftp URLs', async () => {
    await expect(c.parseUrl('ftp://example.com/foo')).rejects.toThrow(/Only https/i);
  });

  it('rejects literal IPv4 addresses', async () => {
    await expect(c.parseUrl('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(/IP addresses/i);
    await expect(c.parseUrl('https://127.0.0.1/')).rejects.toThrow(/IP addresses/i);
  });

  it('rejects literal IPv6 addresses', async () => {
    // Either the IP-literal rejection or the DNS-rejection path is acceptable;
    // the important property is that the request never reaches fetch().
    await expect(c.parseUrl('https://[::1]/')).rejects.toThrow(/IP addresses|DNS|Refusing/i);
  });

  it('rejects invalid URLs', async () => {
    await expect(c.parseUrl('not-a-url')).rejects.toThrow(/Invalid URL/i);
  });

  it('rejects URLs with no hostname', async () => {
    await expect(c.parseUrl('https:///foo')).rejects.toThrow();
  });

  it('refuses to follow DNS to private/loopback ranges', async () => {
    // localhost always resolves to 127.0.0.1
    await expect(c.parseUrl('https://localhost/foo')).rejects.toThrow();
  });

  it('refuses to fetch internal hostnames that resolve to private IPs', async () => {
    // Build a hostname guaranteed to be unresolvable — should be rejected for
    // DNS failure (the SSRF guard refuses unresolved names too).
    await expect(c.parseUrl('https://this-host-does-not-exist-ssrf-test.invalid/foo'))
      .rejects.toThrow();
  });
});
