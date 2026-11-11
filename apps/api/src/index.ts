import { makeServer } from './server.js';
import { config } from './config.js';
const app = await makeServer();
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => { void app.close(); });
try { await app.listen({ host: config.HOST, port: config.PORT }); console.log(`IziPizi API · http://${config.HOST}:${config.PORT} · modo invitado`); }
catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo iniciar IziPizi'); await app.close(); process.exitCode = 1; }
