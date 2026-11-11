import { beforeEach,describe,it,expect,vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { connect,createConnection } from 'node:net';
import { request, type IncomingMessage } from 'node:http';
import { Readable,Writable,Duplex } from 'node:stream';
import { createEgressProxy } from '../src/network.js';
vi.mock('node:dns/promises',() => ({lookup:vi.fn()}));
vi.mock('node:net',async original => ({...await original<typeof import('node:net')>(),connect:vi.fn()}));
vi.mock('node:http',async original => ({...await original<typeof import('node:http')>(),request:vi.fn()}));
const dns = vi.mocked(lookup as (host:string,options:{all:true})=>Promise<LookupAddress[]>);
beforeEach(() => vi.resetAllMocks());
async function send(proxy: string, payload: string) {
 const target = new URL(proxy);
 return new Promise<string>((resolve,reject) => {
  const client = createConnection({host:'127.0.0.1',port:Number(target.port)});const chunks: Buffer[] = [];
  client.once('connect',() => client.write(payload));client.on('data',data => {chunks.push(data);if (payload.startsWith('CONNECT') && Buffer.concat(chunks).includes(Buffer.from('\r\n\r\n'))) client.destroy();});
  client.once('error',error => {if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);});client.once('close',() => resolve(Buffer.concat(chunks).toString()));client.setTimeout(2000,() => client.destroy());
 });
}
function httpResponse(body: string) {
 vi.mocked(request).mockImplementationOnce(((_url: unknown,_options: unknown,callback:(response:IncomingMessage)=>void) => {
  const upstream = new Writable({write(_chunk,_encoding,done){done();},final(done){
   const response = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;response.statusCode=200;response.headers={'content-length':String(body.length)};callback(response);done();
  }});
  Object.assign(upstream,{setTimeout:vi.fn()});return upstream;
 }) as unknown as typeof request);
}
describe('guarded yt-dlp proxy',() => {
 it('blocks CONNECT to private DNS answers before opening an upstream socket',async () => {
  dns.mockResolvedValueOnce([{address:'10.0.0.1',family:4}]);const proxy = await createEgressProxy(AbortSignal.timeout(5000));
  try {expect(await send(proxy.url,'CONNECT cdn.example.org:443 HTTP/1.1\r\nHost: cdn.example.org:443\r\n\r\n')).not.toContain('200');expect(connect).not.toHaveBeenCalled();} finally {proxy.close();}
 });
 it('pins an HTTPS tunnel to its validated public IP',async () => {
  dns.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]);
  vi.mocked(connect).mockImplementationOnce((() => {
   const upstream = new Duplex({read(){},write(_chunk,_encoding,done){done();}});Object.assign(upstream,{setTimeout:vi.fn()});queueMicrotask(() => upstream.emit('connect'));return upstream;
  }) as unknown as typeof connect);
  const proxy = await createEgressProxy(AbortSignal.timeout(5000));
  try {expect(await send(proxy.url,'CONNECT media.example.org:443 HTTP/1.1\r\nHost: media.example.org:443\r\n\r\n')).toContain('200 Connection Established');expect(connect).toHaveBeenCalledWith({host:'8.8.8.8',port:443});} finally {proxy.close();}
 });
 it('blocks HTTP forwarding to a rebinding address',async () => {
  dns.mockResolvedValueOnce([{address:'169.254.169.254',family:4}]);const proxy = await createEgressProxy(AbortSignal.timeout(5000));
  try {expect(await send(proxy.url,'GET http://cdn.example.org/private HTTP/1.1\r\nHost: cdn.example.org\r\nConnection: close\r\n\r\n')).toContain('403');expect(request).not.toHaveBeenCalled();} finally {proxy.close();}
 });
 it('forwards public HTTP through a pinned socket and strips proxy credentials',async () => {
  dns.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]);httpResponse('media');const proxy = await createEgressProxy(AbortSignal.timeout(5000));
  try {
   expect(await send(proxy.url,'GET http://cdn.example.org/file.mp4 HTTP/1.1\r\nHost: cdn.example.org\r\nProxy-Authorization: do-not-forward\r\nConnection: close\r\n\r\n')).toContain('media');
   const options = vi.mocked(request).mock.calls[0]![1] as {headers:Record<string,string>;lookup:(host:string,options:unknown,cb:ReturnType<typeof vi.fn>)=>void};
   const callback = vi.fn();options.lookup('cdn.example.org',{},callback);expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4);expect(options.headers['proxy-authorization']).toBeUndefined();
  } finally {proxy.close();}
 });
 it('closes the proxy when its aggregate transfer budget is exceeded',async () => {
  dns.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]);httpResponse('a'.repeat(2000));const proxy = await createEgressProxy(AbortSignal.timeout(5000),100);
  try {await send(proxy.url,'GET http://cdn.example.org/file HTTP/1.1\r\nHost: cdn.example.org\r\nConnection: close\r\n\r\n');expect(proxy.error?.code).toBe('NETWORK_LIMIT');} finally {proxy.close();}
 });
});
