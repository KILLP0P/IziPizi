import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const url = process.env.IZIPIZI_TEST_URL ?? process.env.MEDIADROP_TEST_URL;
if (!url) throw new Error('Indica IZIPIZI_TEST_URL con una publicación pública para la prueba real.');
const base = process.env.IZIPIZI_API_URL ?? process.env.MEDIADROP_API_URL ?? 'http://127.0.0.1:3001';
const signal = AbortSignal.timeout(180000);
const analyze = await fetch(`${base}/api/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal});
if (!analyze.ok) throw new Error(`Análisis: ${analyze.status} ${await analyze.text()}`);
const result = await analyze.json();
const dir = await mkdtemp(join(tmpdir(),'md-smoke-'));
try {
 for (const media of result.media) {
  const quality = media.qualities[0];
  const response = await fetch(`${base}/api/download`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:result.sessionId,mediaId:media.id,qualityId:quality.id}),signal});
  if (!response.ok) throw new Error(`Descarga: ${response.status} ${await response.text()}`);
  const file = join(dir,`sample.${quality.extension}`); const data = Buffer.from(await response.arrayBuffer());
  await writeFile(file,data);
  const probe = spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height:format=duration,size','-of','json',file],{encoding:'utf8',shell:false,timeout:15000});
  if (probe.status !== 0) throw new Error('FFprobe no pudo validar el archivo descargado.');
  const metadata = JSON.parse(probe.stdout);
  if (!metadata.streams?.length || data.length === 0) throw new Error('El archivo no contiene medios válidos.');
  console.log(`✓ ${media.kind}: ${quality.label}, ${data.length} bytes, ${metadata.streams.length} stream(s) válidos`);
 }
 if (result.warnings.length) console.log(`Avisos: ${result.warnings.join(' ')}`);
 console.log('Prueba real completada; archivos de prueba eliminados.');
} finally { await rm(dir,{recursive:true,force:true}); }
