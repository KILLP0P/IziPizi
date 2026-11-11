import { describe,it,expect } from 'vitest';
import { allowedHost,checkedUrl,isPublicAddress } from '../src/network.js';
import { Gate } from '../src/limits.js';
import { runProcess } from '../src/process.js';
describe('egress protection',() => {
 it.each(['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:10.0.0.1','2001:db8::1'])('blocks internal or reserved address %s',address => expect(isPublicAddress(address)).toBe(false));
 it.each(['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])('accepts public address %s',address => expect(isPublicAddress(address)).toBe(true));
 it.each(['https://video.twimg.com.evil.com/a.mp4','https://pbs.twimg.com@127.0.0.1/a','http://video.twimg.com/a','https://video.twimg.com:444/a','https://t.co/foo','https://evil.twimg.com/foo'])('blocks unsafe target %s',url => expect(() => checkedUrl(url,true)).toThrow());
 it('restricts media downloads to the two media hosts',() => {
  expect(allowedHost('cdn.syndication.twimg.com')).toBe(true); expect(allowedHost('cdn.syndication.twimg.com',true)).toBe(false); expect(checkedUrl('https://pbs.twimg.com/media/a.jpg',true).hostname).toBe('pbs.twimg.com');
 });
});
describe('resource limits',() => {
 it('rejects excess concurrency and releases slots on failure',async () => {
  const gate = new Gate(1); let release!: () => void;
  const first = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
  await expect(gate.run(async () => 1)).rejects.toMatchObject({code:'BUSY'}); release(); await first;
  await expect(gate.run(async () => { throw new Error('fail'); })).rejects.toThrow('fail'); expect(gate.active).toBe(0);
 });
 it('executes argument text literally without a shell',async () => {
  const output = await runProcess(process.execPath,['-e','console.log(process.argv[1])','$(echo unsafe); echo nope'],AbortSignal.timeout(5000)); expect(output.trim()).toBe('$(echo unsafe); echo nope');
 });
 it('kills a subprocess when cancelled',async () => {
  await expect(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],AbortSignal.timeout(30))).rejects.toMatchObject({code:'CANCELLED'});
 });
 it('caps subprocess output',async () => {
  await expect(runProcess(process.execPath,['-e','console.log("a".repeat(5000))'],AbortSignal.timeout(5000),100)).rejects.toMatchObject({code:'OUTPUT_LIMIT'});
 });
});

it('stops binary encoding at the output limit instead of returning a truncated GIF',async () => {
 const {runProcessToFile} = await import('../src/process.js');
 const {mkdtemp,rm,stat} = await import('node:fs/promises');
 const {tmpdir} = await import('node:os');
 const {join} = await import('node:path');
 const dir = await mkdtemp(join(tmpdir(),'izipizi-output-test-'));
 try {
  const file = join(dir,'limited.gif');
  await expect(runProcessToFile(process.execPath,['-e','process.stdout.write(Buffer.alloc(200000))'],file,AbortSignal.timeout(5000),1000)).rejects.toMatchObject({code:'FILE_TOO_LARGE'});
  expect((await stat(file)).size).toBeLessThanOrEqual(1000);
 } finally {await rm(dir,{recursive:true,force:true});}
});
