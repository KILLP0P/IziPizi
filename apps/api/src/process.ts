import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { AppError, aborted } from './errors.js';
export async function runProcess(bin: string, args: string[], signal: AbortSignal, maxOutput = 8 * 1024 * 1024): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const proxyIndex = args.indexOf('--proxy');const proxy = proxyIndex >= 0 ? args[proxyIndex+1] : undefined;
    const child = spawn(bin, args, { shell: false, detached:process.platform !== 'win32', stdio: ['ignore','pipe','pipe'], env: {
      PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8',
      ...(proxy ? {http_proxy:proxy,https_proxy:proxy,all_proxy:proxy,no_proxy:'',HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,NO_PROXY:''} : {}),
      // No inherited HTTP proxies, cookies, plugins or user yt-dlp configuration.
    } });
    let output = ''; let error = ''; let size = 0; let failure: Error | undefined;
    const kill = () => {try {if (process.platform !== 'win32' && child.pid) process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');} catch { /* already exited */ }};
    const stop = () => {failure ??= aborted();kill();};
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxOutput) { failure = new AppError('OUTPUT_LIMIT','La respuesta del extractor es demasiado grande.',422); kill(); } else output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-8000); });
    child.on('error', () => { signal.removeEventListener('abort', stop); reject(new AppError('DEPENDENCY_MISSING',`No se puede ejecutar ${bin.includes('ffmpeg') ? 'FFmpeg' : 'yt-dlp'}. Ejecuta pnpm run doctor.`,503)); });
    child.on('close', code => {
      signal.removeEventListener('abort', stop);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new AppError('EXTRACTION_FAILED', /private|protected|login|not authorized|unavailable|not found|404|403/i.test(error)
        ? 'El contenido no está disponible sin iniciar sesión o tiene restricciones de acceso.'
        : 'No se ha podido obtener el contenido. El sitio puede no ser compatible o requerir acceso privado.',422));
      resolve(output);
    });
  });
}

// Stream encoded binary output to disk with backpressure and a hard byte limit.
// Never buffer a whole GIF or return a partially encoded file after a limit.
export async function runProcessToFile(bin: string, args: string[], path: string, signal: AbortSignal, maxBytes: number): Promise<void> {
  signal.throwIfAborted();
  const child = spawn(bin,args,{ shell:false, stdio:['ignore','pipe','pipe'], env:{ PATH:process.env.PATH, LANG:'en_US.UTF-8' } });
  const stop = () => { child.kill('SIGKILL'); };
  signal.addEventListener('abort',stop,{once:true});
  if (signal.aborted) stop();
  child.stderr.resume();
  const completion = new Promise<void>((resolve,reject) => {
    child.once('error',() => reject(new AppError('DEPENDENCY_MISSING','No se puede ejecutar FFmpeg. Ejecuta pnpm run doctor.',503)));
    child.once('close',code => code === 0 ? resolve() : reject(signal.aborted ? aborted() : new AppError('CONVERSION_FAILED','No se ha podido convertir la animación a GIF.',422)));
  });
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer,_encoding,callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new AppError('FILE_TOO_LARGE','El GIF supera el límite de tamaño. Prueba otra calidad.',413) : null,chunk);
  } });
  const transfer = pipeline(child.stdout,limit,createWriteStream(path,{flags:'wx',mode:0o600}),{signal}).catch(error => { stop(); throw error; });
  try {
    const [encoded,exited] = await Promise.allSettled([transfer,completion]);
    if (signal.aborted) throw aborted();
    if (encoded.status === 'rejected' && encoded.reason instanceof AppError) throw encoded.reason;
    if (exited.status === 'rejected') throw exited.reason;
    if (encoded.status === 'rejected') throw encoded.reason;
  } finally { signal.removeEventListener('abort',stop); }
}
