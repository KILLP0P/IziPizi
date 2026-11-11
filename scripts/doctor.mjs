import { spawnSync } from 'node:child_process';
const checks = [[process.execPath,['--version'],'Node.js'],['pnpm',['--version'],'pnpm'],[process.env.YTDLP_BIN ?? 'yt-dlp',['--version'],'yt-dlp'],[process.env.FFMPEG_BIN ?? 'ffmpeg',['-version'],'FFmpeg']];
let failed = false;
for (const [bin,args,label] of checks) { const result = spawnSync(bin,args,{ encoding:'utf8',shell:false }); const ok = result.status === 0; console.log(`${ok ? '✓' : '✗'} ${label}: ${ok ? result.stdout.split('\n')[0] : 'no disponible en PATH'}`); if (!ok) failed = true; }
if (Number(process.versions.node.split('.')[0]) < 24) { failed = true; console.log('Se requiere Node.js 24 LTS o superior.'); }
process.exitCode = failed ? 1 : 0;
