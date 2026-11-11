import { describe,it,expect } from 'vitest';
import { analyzeSchema,normalizePostUrl,downloadSchema } from './index.js';
describe('public post URLs',() => {
 it.each(['https://x.com/hello/status/123?utm_source=foo','https://twitter.com/hello/status/123/video/1','https://mobile.twitter.com/i/web/status/123',' https://www.x.com/hello/status/123/ '])('normalizes %s',url => expect(normalizePostUrl(url)).toBe('https://x.com/i/web/status/123'));
 it.each(['http://x.com/hello/status/123','https://x.com.evil.org/hello/status/123','https://x.com@127.0.0.1/a/status/1','https://x.com:8443/a/status/1','https://x.com/a','https://x.com/a/status/1/../../foo','https://127.0.0.1/status/1','file:///etc/passwd','https://t.co/abc','https://x.com/a/status/1/video/99'])('rejects %s',url => expect(analyzeSchema.safeParse({url}).success).toBe(false));
 it('rejects extra parameters and arbitrary downloader arguments',() => {
  expect(analyzeSchema.safeParse({url:'https://x.com/a/status/1',cookies:'secret'}).success).toBe(false);
  expect(downloadSchema.safeParse({sessionId:'00000000-0000-4000-8000-000000000000',mediaId:'m0',qualityId:'--exec=sh'}).success).toBe(false);
 });
});
