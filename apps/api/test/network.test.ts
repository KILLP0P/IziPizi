import { beforeEach,describe,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { safeBuffer } from '../src/network.js';
vi.mock('node:dns/promises',() => ({lookup:vi.fn()}));
vi.mock('node:https',() => ({request:vi.fn()}));
const mockLookup = vi.mocked(lookup as (hostname: string, options: {all:true}) => Promise<LookupAddress[]>);
beforeEach(() => {vi.resetAllMocks();});
function mockResponse(status: number, headers: Record<string,string>, chunks: Buffer[] = []) {
 const response = Readable.from(chunks) as unknown as IncomingMessage;
 response.statusCode = status; response.headers = headers;
 vi.mocked(request).mockImplementationOnce(((_url: unknown,_options: unknown,callback: (r: IncomingMessage) => void) => {
  const req = new EventEmitter() as EventEmitter & {end: () => void};req.end=() => {callback(response);};return req;
 }) as unknown as typeof request);
}
describe('validated outbound requests',() => {
 it('rejects an allowed hostname if any resolved address is private',async () => {
  mockLookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]);
  await expect(safeBuffer('https://pbs.twimg.com/a.jpg',AbortSignal.timeout(1000),1000)).rejects.toMatchObject({code:'UNSAFE_ADDRESS'});expect(request).not.toHaveBeenCalled();
 });
 it('pins the socket lookup to its validated public IP',async () => {
  mockLookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]);mockResponse(200,{'content-type':'image/jpeg'},[Buffer.from('image')]);
  const result = await safeBuffer('https://pbs.twimg.com/a.jpg',AbortSignal.timeout(1000),1000);expect(result.data.toString()).toBe('image');
  const options = vi.mocked(request).mock.calls[0]![1] as {servername:string;family:number;lookup:(host:string,options:unknown,cb:(error:Error|null,address:string,family:number)=>void)=>void};
  const callback = vi.fn();options.lookup('pbs.twimg.com',{},callback);expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4);expect(options.servername).toBe('pbs.twimg.com');expect(options.family).toBe(4);expect(lookup).toHaveBeenCalledTimes(1);
 });
 it('revalidates redirect destinations before resolving or connecting',async () => {
  mockLookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]);mockResponse(302,{location:'https://127.0.0.1/internal'});
  await expect(safeBuffer('https://pbs.twimg.com/a.jpg',AbortSignal.timeout(1000),1000)).rejects.toMatchObject({code:'UNSAFE_URL'});expect(lookup).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1);
 });
 it('rejects an oversized streamed response without Content-Length',async () => {
  mockLookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]);mockResponse(200,{'content-type':'image/jpeg'},[Buffer.alloc(20),Buffer.alloc(20)]);
  await expect(safeBuffer('https://pbs.twimg.com/a.jpg',AbortSignal.timeout(1000),30)).rejects.toMatchObject({code:'FILE_TOO_LARGE'});
 });
});
