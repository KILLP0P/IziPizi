import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { mkdtemp,writeFile,rm,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/server.js';
import type { Engine } from '../src/engine.js';
import { config } from '../src/config.js';
import { AppError } from '../src/errors.js';
const sid = '00000000-0000-4000-8000-000000000000';
const analysis = {sessionId:sid,sourceUrl:'https://x.com/i/web/status/123',title:'Public post',expiresAt:new Date(Date.now()+600000).toISOString(),media:[{id:'m0',kind:'image' as const,qualities:[{id:'q0',label:'Original',extension:'jpg' as const}]}],warnings:[]};
describe('API integration',() => {
 let app: Awaited<ReturnType<typeof makeServer>>; let dir: string; let engine: Engine;
 beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(),'izipizi-test-')); await writeFile(join(dir,'a.jpg'),Buffer.from([255,216,255,217]));
  engine = {analyze:vi.fn(async () => analysis),download:vi.fn(async () => ({path:join(dir,'a.jpg'),filename:'izipizi-m0.jpg',type:'image/jpeg',size:4,cleanup:async () => {await rm(dir,{recursive:true,force:true});}})),preview:vi.fn(async () => ({data:Buffer.from('preview'),type:'image/jpeg'})),close:vi.fn(async () => {})};
  app = await makeServer({engine});
 });
 afterEach(async () => {await app.close();await rm(dir,{recursive:true,force:true});});
 it('analyzes normalized URLs in guest mode',async () => {
  const response = await app.inject({method:'POST',url:'/api/analyze',payload:{url:'https://twitter.com/a/status/123?s=20'}});
  expect(response.statusCode).toBe(200);expect(response.json().media).toHaveLength(1);expect(engine.analyze).toHaveBeenCalledWith('https://x.com/i/web/status/123',expect.any(AbortSignal));expect(response.headers['cache-control']).toBe('no-store');
 });
 it('rejects invalid URLs before calling the extractor',async () => {
  const response = await app.inject({method:'POST',url:'/api/analyze',payload:{url:'https://127.0.0.1/private'}});expect(response.statusCode).toBe(400);expect(engine.analyze).not.toHaveBeenCalled();
 });
 it('delivers an attachment and cleans its temporary directory',async () => {
  const response = await app.inject({method:'POST',url:'/api/download',payload:{sessionId:sid,mediaId:'m0',qualityId:'q0'}});expect(response.statusCode).toBe(200);expect(response.rawPayload).toEqual(Buffer.from([255,216,255,217]));expect(response.headers['content-disposition']).toContain('attachment');
  await vi.waitFor(async () => { await expect(access(dir)).rejects.toThrow(); });
 });
 it('returns a friendly expired-session error',async () => {
  vi.mocked(engine.download).mockRejectedValueOnce(new AppError('EXPIRED','La vista previa ha caducado.',410));
  const response = await app.inject({method:'POST',url:'/api/download',payload:{sessionId:sid,mediaId:'m0',qualityId:'q0'}});expect(response.statusCode).toBe(410);expect(response.json().error.code).toBe('EXPIRED');
 });
 it('blocks cross-origin writes and DNS rebinding Host headers',async () => {
  expect((await app.inject({method:'POST',url:'/api/analyze',headers:{origin:'https://evil.com'},payload:{url:analysis.sourceUrl}})).statusCode).toBe(403);
  expect((await app.inject({method:'GET',url:'/api/health',headers:{host:'evil.com:3001'}})).statusCode).toBe(403);
 });
 it('allows the configured LAN address and origin while rejecting arbitrary hosts',async () => {
  await app.close();
  app = await makeServer({engine,config:{...config,HOST:'0.0.0.0',WEB_ORIGIN:'http://192.168.0.139:3001'}});
  const headers = {host:'192.168.0.139:3001',origin:'http://192.168.0.139:3001','sec-fetch-site':'same-origin'};
  const response = await app.inject({method:'POST',url:'/api/analyze',headers,payload:{url:analysis.sourceUrl}});
  expect(response.statusCode).toBe(200);
  expect((await app.inject({method:'GET',url:'/api/health',headers:{host:'evil.com:3001'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/analyze',headers:{...headers,origin:'https://evil.com'},payload:{url:analysis.sourceUrl}})).statusCode).toBe(403);
 });
 it('accepts only the configured public tunnel without breaking LAN access',async () => {
  await app.close();
  app = await makeServer({engine,config:{...config,HOST:'0.0.0.0',WEB_ORIGIN:'http://192.168.0.139:3001',PUBLIC_ORIGIN:'https://demo.trycloudflare.com'}});
  for (const origin of ['https://demo.trycloudflare.com','http://192.168.0.139:3001']) {
   const response = await app.inject({method:'POST',url:'/api/analyze',headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin'},payload:{url:analysis.sourceUrl}});
   expect(response.statusCode).toBe(200);
  }
  expect((await app.inject({url:'/api/health',headers:{host:'other.trycloudflare.com'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/analyze',headers:{host:'demo.trycloudflare.com',origin:'https://other.trycloudflare.com'},payload:{url:analysis.sourceUrl}})).statusCode).toBe(403);
 });
 it('caps request body size',async () => {
  const response = await app.inject({method:'POST',url:'/api/analyze',payload:{url:'x'.repeat(5000)}});expect(response.statusCode).toBe(413);
 });
 it('rate limits analysis requests',async () => {
  for(let i=0;i<12;i++) await app.inject({method:'POST',url:'/api/analyze',payload:{url:analysis.sourceUrl}});
  const response = await app.inject({method:'POST',url:'/api/analyze',payload:{url:analysis.sourceUrl}});expect(response.statusCode).toBe(429);
 });
});
