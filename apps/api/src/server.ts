import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { cleanupStaleTemp } from './temporary.js';
import { analyzeSchema, downloadSchema } from '@izipizi/shared';
import { AppError } from './errors.js';
import { DownloadEngine, createReadStream, type Engine } from './engine.js';
import { config as defaultConfig, type Config } from './config.js';

export async function makeServer(options: { engine?: Engine; config?: Config } = {}) {
 const config = options.config ?? defaultConfig;
 if (!options.engine) await cleanupStaleTemp(config.TEMP_ROOT ?? tmpdir());
 const engine = options.engine ?? new DownloadEngine(config);
 const app = Fastify({ logger: false, bodyLimit: 4096, trustProxy: false, requestTimeout: 15000, connectionTimeout: 15000 });
 await app.register(helmet,{ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'",'blob:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null } }, crossOriginEmbedderPolicy: false, strictTransportSecurity: false });
 await app.register(rateLimit,{ max: 90, timeWindow: '1 minute', errorResponseBuilder: () => ({ statusCode: 429, error: { code: 'RATE_LIMIT', message: 'Has hecho muchas solicitudes. Espera un minuto y vuelve a intentarlo.' } }) });
 app.addHook('onRequest',async (req, reply) => {
   reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
   // No CORS. Reject cross-site requests even if a browser can send a simple request.
   const origin = req.headers.origin;
   const allowed = new Set([config.WEB_ORIGIN,...(config.PUBLIC_ORIGIN ? [config.PUBLIC_ORIGIN] : []),`http://localhost:${config.PORT}`,`http://127.0.0.1:${config.PORT}`]);
   if ((origin && !allowed.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('ORIGIN','Origen de solicitud no permitido.',403);
   const hostname = (req.headers.host ?? '').split(':')[0];
   const allowedHosts = new Set(['localhost','127.0.0.1',...(config.HOST === '0.0.0.0' ? [new URL(config.WEB_ORIGIN).hostname,...(config.PUBLIC_ORIGIN ? [new URL(config.PUBLIC_ORIGIN).hostname] : [])] : [])]);
   if (!allowedHosts.has(hostname ?? '')) throw new AppError('HOST','Host no permitido.',403);
 });
 app.setErrorHandler((error, _req, reply) => {
   if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: error.issues[0]?.message ?? 'Revisa los datos introducidos.' } });
   if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
   const known = error as FastifyError;
   if (known.name === 'AbortError' || known.name === 'TimeoutError') return reply.code(504).send({ error: { code: 'TIMEOUT', message: 'La operación ha tardado demasiado. Vuelve a intentarlo.' } });
   if (known.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Espera un minuto.' } });
   if (known.statusCode && known.statusCode < 500) return reply.code(known.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'La solicitud no es válida.' } });
   return reply.code(500).send({ error: { code: 'INTERNAL', message: 'No se ha podido completar la operación. Inténtalo de nuevo.' } });
 });
 const controllers = new Set<AbortController>();
 function job(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) {
   const controller = new AbortController(); controllers.add(controller);
   const timer = setTimeout(() => controller.abort(new DOMException('Timeout','TimeoutError')),config.JOB_TIMEOUT_SECONDS * 1000); timer.unref();
   const cancel = () => { if (!reply.raw.writableFinished) controller.abort(); };
   req.raw.once('aborted',cancel); reply.raw.once('close',cancel);
   return { signal: controller.signal, done: () => { clearTimeout(timer); controllers.delete(controller); req.raw.off('aborted',cancel); reply.raw.off('close',cancel); } };
 }
 app.get('/api/health',async () => ({ status: 'ok', mode: 'guest' }));
 app.post('/api/analyze',{ config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },async (req,reply) => {
   const input = analyzeSchema.parse(req.body); const task = job(req,reply);
   try { return await engine.analyze(input.url,task.signal); } catch (error) { if (task.signal.aborted) throw task.signal.reason; throw error; } finally { task.done(); }
 });
 app.get('/api/preview/:sessionId/:mediaId',async (req,reply) => {
   const p = z.object({ sessionId: z.string().uuid(), mediaId: z.string().regex(/^m\d{1,2}$/) }).parse(req.params); const task = job(req,reply);
   try { const result = await engine.preview(p.sessionId,p.mediaId,task.signal); return reply.type(result.type).send(result.data); } finally { task.done(); }
 });
 app.post('/api/download',{ config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },async (req,reply) => {
   const input = downloadSchema.parse(req.body); const task = job(req,reply);
   try {
     const file = await engine.download(input.sessionId,input.mediaId,input.qualityId,task.signal);
     let cleaned = false;
     const cleanup = () => { if (cleaned) return; cleaned = true; task.done(); void file.cleanup().catch(() => {}); };
     const stream = createReadStream(file.path);
     const abortStream = () => { stream.destroy(); reply.raw.destroy(); cleanup(); };
     task.signal.addEventListener('abort',abortStream,{ once:true });
     if (task.signal.aborted) abortStream();
     reply.raw.once('finish',cleanup); reply.raw.once('close',() => { stream.destroy(); cleanup(); }); stream.once('error',cleanup);
     reply.header('Content-Disposition',`attachment; filename="${file.filename}"`).header('Content-Length',file.size);
     return reply.type(file.type).send(stream);
   } catch (error) { task.done(); if (task.signal.aborted) throw task.signal.reason; throw error; }
 });
 const webRoot = fileURLToPath(new URL('../../web/dist/',import.meta.url));
 if (existsSync(webRoot)) {
   await app.register(fastifyStatic,{ root: webRoot });
   app.setNotFoundHandler((req,reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } }) : reply.sendFile('index.html'));
 }
 app.addHook('preClose',async () => { for (const controller of controllers) controller.abort(); });
 app.addHook('onClose',async () => engine.close());
 return app;
}
