import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { isPublicHostname } from '@izipizi/shared';
import { AppError } from './errors.js';

export const allowedHost = isPublicHostname;
export function checkedUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError('UNSAFE_URL','Destino multimedia no permitido.'); }
  if (!['https:','http:'].includes(url.protocol) || url.port || url.username || url.password || !allowedHost(url.hostname)) throw new AppError('UNSAFE_URL','Solo se permiten destinos web públicos sin credenciales ni puertos alternativos.');
  return url;
}
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function resolvePublic(host: string): Promise<string> {
  if (!allowedHost(host)) throw new AppError('UNSAFE_URL','El destino no es un dominio público.');
  const addresses = await lookup(host,{all:true});
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new AppError('UNSAFE_ADDRESS','El destino de red no está permitido.');
  return addresses[0]!.address;
}
export function mediaHeaders(headers: Record<string,string> = {}): Record<string,string> {
  const result: Record<string,string> = { 'User-Agent':'Mozilla/5.0 (compatible; IziPizi/0.2)', Accept:'*/*', 'Accept-Encoding':'identity' };
  for (const [name,value] of Object.entries(headers)) {
    if (['user-agent','referer','origin','accept'].includes(name.toLowerCase()) && value.length < 4096 && !/[\r\n]/.test(value)) result[name] = value;
  }
  return result;
}
// Resolve once, reject every private/reserved answer and pin the socket to the
// validated IP. HTTPS still validates the original hostname's certificate.
export async function safeResponse(raw: string, signal: AbortSignal, maxBytes: number, redirects = 0, headers: Record<string,string> = {}): Promise<IncomingMessage> {
  signal.throwIfAborted(); const url = checkedUrl(raw);
  const address = await resolvePublic(url.hostname); signal.throwIfAborted();
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const response = await new Promise<IncomingMessage>((resolve,reject) => {
    const req = request(url,{signal,agent:false,servername:url.hostname,family:address.includes(':') ? 6 : 4,
      lookup:(_host,_options,cb) => cb(null,address,address.includes(':') ? 6 : 4),headers:mediaHeaders(headers)},resolve);
    req.on('error',reject);req.end();
  });
  if ([301,302,303,307,308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (redirects >= 3 || !response.headers.location) throw new AppError('REDIRECT','Demasiadas redirecciones.');
    return safeResponse(new URL(response.headers.location,url).href,signal,maxBytes,redirects+1,headers);
  }
  if (response.statusCode !== 200) { response.destroy(); throw new AppError('UPSTREAM','El sitio no permite acceder a este contenido público en este momento.',422); }
  if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); throw new AppError('ENCODING','El sitio ha enviado una respuesta comprimida no compatible.',422); }
  if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); throw new AppError('FILE_TOO_LARGE','El archivo supera el límite de tamaño.',413); }
  response.url = url.href;
  return response;
}
export async function readLimited(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of response) {
    const chunk = Buffer.from(part as Uint8Array); size += chunk.length;
    if (size > maxBytes) { response.destroy(); throw new AppError('FILE_TOO_LARGE','La respuesta supera el límite de tamaño.',413); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function safeBuffer(url: string, signal: AbortSignal, maxBytes: number, headers: Record<string,string> = {}) {
  const response = await safeResponse(url,signal,maxBytes,0,headers);
  return {data:await readLimited(response,maxBytes),type:response.headers['content-type'] ?? 'application/octet-stream'};
}

// HTTPS CONNECT and ordinary HTTP requests both pass the same validation. All
// redirects, manifests, fragments and keys fetched by native yt-dlp downloaders
// must traverse this short-lived loopback proxy. No remote URL reaches FFmpeg.
export async function createEgressProxy(signal: AbortSignal, maxBytes = 32 * 1024 * 1024) {
  signal.throwIfAborted();
  const sockets = new Set<Duplex>(); let total = 0; let requests = 0; let failure: AppError | undefined;
  const server = createServer((req,res) => {
    void (async () => {
      const target = checkedUrl(req.url ?? '');
      if (target.protocol !== 'http:' || !['GET','HEAD','POST'].includes(req.method ?? '')) throw new Error('blocked');
      if (++requests > 512) throw new Error('request limit');
      const address = await resolvePublic(target.hostname); signal.throwIfAborted();
      const headers: OutgoingHttpHeaders = {...req.headers,host:target.host,connection:'close'};
      for (const name of ['proxy-authorization','proxy-connection','forwarded','x-forwarded-for','upgrade','keep-alive','te','trailer']) delete headers[name];
      const upstream = httpRequest(target,{method:req.method,agent:false,signal,headers,family:address.includes(':') ? 6 : 4,
        lookup:(_host,_options,cb) => cb(null,address,address.includes(':') ? 6 : 4)},response => {
        response.on('data',count);res.writeHead(response.statusCode ?? 502,response.headers);response.pipe(res);
        response.on('error',() => res.destroy());
      });
      upstream.on('socket',socket => { sockets.add(socket);socket.once('close',() => sockets.delete(socket)); });
      upstream.setTimeout(15000,() => upstream.destroy());
      upstream.on('error',() => res.destroy());res.once('close',() => upstream.destroy());req.on('data',count);req.pipe(upstream);
    })().catch(() => {res.writeHead(403);res.end();});
  });
  const close = () => {for (const socket of sockets) socket.destroy();server.close();};
  function count(chunk: Buffer) { total += chunk.length; if (total > maxBytes) { failure ??= new AppError('NETWORK_LIMIT','Se ha superado el límite de transferencia de la operación.',413);close(); } }
  server.on('connection',socket => {sockets.add(socket);socket.on('close',() => sockets.delete(socket));});
  server.on('connect',(req,client,head) => {
    void (async () => {
      if (++requests > 512) throw new Error('request limit');
      const target = checkedUrl(`https://${req.url ?? ''}`);
      if (!req.url?.endsWith(':443') || target.pathname !== '/' || target.search || target.hash) throw new Error('blocked');
      const address = await resolvePublic(target.hostname);signal.throwIfAborted();
      const upstream = connect({host:address,port:443});sockets.add(upstream);
      const disconnect = () => {client.destroy();upstream.destroy();};
      upstream.on('close',() => {sockets.delete(upstream);client.destroy();});upstream.on('error',disconnect);client.on('error',disconnect);client.on('close',() => upstream.destroy());
      upstream.setTimeout(15000,disconnect);upstream.on('data',count);client.on('data',count);
      upstream.once('connect',() => {client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if (head.length) upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
    })().catch(() => client.destroy());
  });
  signal.addEventListener('abort',close,{once:true});
  await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  if (signal.aborted) {close();signal.throwIfAborted();}
  const address = server.address();if (!address || typeof address === 'string') throw new Error('Proxy startup failed');
  return {url:`http://127.0.0.1:${address.port}`,get error(){return failure;},close:() => {signal.removeEventListener('abort',close);close();}};
}
