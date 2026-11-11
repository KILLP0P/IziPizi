import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { DownloadPlan } from './media.js';
import { createEgressProxy } from './network.js';
import { runProcess } from './process.js';
import { extractorArgs } from './extractor.js';
import { AppError } from './errors.js';

// yt-dlp may delegate an unsupported manifest or a merge to FFmpeg. Wrappers
// prohibit network protocols in every input, including that fallback path.
async function localTools(dir: string, config: Config) {
 const tools = join(dir,'tools');await mkdir(tools,{mode:0o700});
 for (const [name,bin] of [['ffmpeg',config.FFMPEG_BIN],['ffprobe',config.FFPROBE_BIN]]) {
  const script = `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');\nconst input=process.argv.slice(2);const args=['-protocol_whitelist','file,pipe'];\nfor(const arg of input){if(arg==='-i')args.push('-protocol_whitelist','file,pipe');args.push(arg);}\nconst r=spawnSync(${JSON.stringify(bin)},args,{stdio:'inherit',shell:false});process.exit(r.status??1);\n`;
  await writeFile(join(tools,name!),script,{mode:0o700,flag:'wx'});
 }
 return tools;
}
async function directorySize(dir: string): Promise<number> {
 let bytes = 0;
 for (const file of await readdir(dir,{withFileTypes:true})) {
  const path = join(dir,file.name);
  try {bytes += file.isDirectory() ? await directorySize(path) : (await stat(path)).size;} catch { /* completed rename */ }
 }
 return bytes;
}
export async function nativeDownload(plan: DownloadPlan, dir: string, signal: AbortSignal, max: number, config: Config): Promise<string> {
 const controller = new AbortController();const combined = AbortSignal.any([signal,controller.signal]);
 const proxy = await createEgressProxy(combined,max+8*1024*1024);
 let diskError: AppError | undefined;let checking = false;
 const timer = setInterval(() => {
  if (checking) return;checking = true;
  void directorySize(dir).then(bytes => {if (bytes > max*2+2*1024*1024) {diskError = new AppError('FILE_TOO_LARGE','Los archivos temporales superan el límite de tamaño.',413);controller.abort();}}).catch(() => {}).finally(() => {checking = false;});
 },100);timer.unref();
 try {
  const tools = await localTools(dir,config);
  const info = join(dir,'media.json');
  await writeFile(info,JSON.stringify({id:'media',title:'media',extractor:'generic',formats:plan.formats}),{mode:0o600,flag:'wx'});
  await runProcess(config.YTDLP_BIN,[...extractorArgs,'--proxy',proxy.url,'--downloader','native',
   '--ffmpeg-location',tools,'--no-part','--no-continue','--no-mtime','--fragment-retries','0','--concurrent-fragments','1',
   '--max-filesize',String(max),'--format',plan.selection,'--merge-output-format',plan.extension,
   '--paths',dir,'--output','payload.%(ext)s','--load-info-json',info],combined,1024*1024);
  if (diskError) throw diskError;if (proxy.error) throw proxy.error;
  const path = join(dir,`payload.${plan.extension}`);
  let size: number;try {size = (await stat(path)).size;} catch {throw new AppError('DOWNLOAD_FAILED','No se ha generado un archivo válido; puede superar el límite o no ser compatible.',422);}
  if (!size || size > max) throw new AppError('FILE_TOO_LARGE','El archivo supera el límite de tamaño.',413);
  return path;
 } catch (error) {throw diskError ?? proxy.error ?? error;}
 finally {clearInterval(timer);proxy.close();}
}
