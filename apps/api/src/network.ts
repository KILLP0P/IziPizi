import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';

const apiHosts = new Set(['x.com','www.x.com','twitter.com','www.twitter.com','api.x.com','api.twitter.com','cdn.syndication.twimg.com','syndication.twitter.com','abs.twimg.com']);
export function allowedHost(host: string, mediaOnly = false): boolean {
  return host === 'pbs.twimg.com' || host === 'video.twimg.com' || (!mediaOnly && apiHosts.has(host));
}
export function checkedUrl(raw: string, mediaOnly = false): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError('UNSAFE_URL','Destino multimedia no permitido.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowedHost(url.hostname, mediaOnly)) {
    throw new AppError('UNSAFE_URL','Destino multimedia no permitido.');
  }
  return url;
}
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function resolvePublic(host: string): Promise<string> {
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new AppError('UNSAFE_ADDRESS','El destino de red no está permitido.');
  return addresses[0]!.address;
}
// Pin the connection to the validated IP. TLS still verifies the original hostname.
export async function safeResponse(raw: string, signal: AbortSignal, maxBytes: number, redirects = 0, mediaOnly = true): Promise<import('node:http').IncomingMessage> {
  signal.throwIfAborted();
  const url = checkedUrl(raw, mediaOnly);
  const address = await resolvePublic(url.hostname);
  signal.throwIfAborted();
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(url, { signal, agent: false, servername: url.hostname, family: address.includes(':') ? 6 : 4,
      lookup: (_host, _options, callback) => callback(null, address, address.includes(':') ? 6 : 4),
      headers: { 'User-Agent': 'IziPizi/0.1', Accept: '*/*', 'Accept-Encoding': 'identity' },
    }, resolve);
    req.on('error', reject); req.end();
  });
  if ([301,302,303,307,308].includes(response.statusCode ?? 0)) {
    response.resume();
    if (redirects >= 3 || !response.headers.location) throw new AppError('REDIRECT','Demasiadas redirecciones.');
    return safeResponse(new URL(response.headers.location, url).href, signal, maxBytes, redirects + 1, mediaOnly);
  }
  if (response.statusCode !== 200) { response.resume(); throw new AppError('UPSTREAM','X no permite acceder a este contenido público en este momento.', 422); }
  if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); throw new AppError('FILE_TOO_LARGE','El archivo supera el límite de tamaño.',413); }
  return response;
}
export async function safeBuffer(url: string, signal: AbortSignal, maxBytes: number, mediaOnly = true): Promise<{ data: Buffer; type: string }> {
  const response = await safeResponse(url, signal, maxBytes, 0, mediaOnly);
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of response) {
    const chunk = Buffer.from(part as Uint8Array); size += chunk.length;
    if (size > maxBytes) { response.destroy(); throw new AppError('FILE_TOO_LARGE','El archivo supera el límite de tamaño.',413); }
    chunks.push(chunk);
  }
  return { data: Buffer.concat(chunks), type: response.headers['content-type'] ?? 'application/octet-stream' };
}
// yt-dlp receives only this short-lived local proxy. Every CONNECT is validated;
// redirects and newly resolved CDN hosts cannot escape the same allowlist.
export async function createEgressProxy(signal: AbortSignal) {
  const sockets = new Set<Duplex>(); let total = 0;
  const server = createServer((_req, res) => { res.writeHead(403); res.end(); });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', (req, client, head) => {
    void (async () => {
      const target = new URL(`https://${req.url ?? ''}`);
      if (!req.url?.endsWith(':443') || !allowedHost(target.hostname) || target.username || target.password || target.pathname !== '/') throw new Error('blocked');
      const address = await resolvePublic(target.hostname);
      signal.throwIfAborted();
      const upstream: Socket = connect({ host: address, port: 443 }); sockets.add(upstream);
      const close = () => { client.destroy(); upstream.destroy(); };
      upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
      upstream.on('error', close); client.on('error', close); client.on('close', () => upstream.destroy());
      upstream.setTimeout(15000, close);
      upstream.on('data', chunk => { total += chunk.length; if (total > 16 * 1024 * 1024) close(); });
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
    })().catch(() => client.destroy());
  });
  const close = () => { for (const socket of sockets) socket.destroy(); server.close(); };
  signal.addEventListener('abort', close, { once: true });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy startup failed');
  return { url: `http://127.0.0.1:${address.port}`, close: () => { signal.removeEventListener('abort', close); close(); } };
}
