import { it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,symlink,readdir,utimes,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupStaleTemp } from '../src/temporary.js';
it('removes only old own job directories, preserving recent jobs and symlinks',async () => {
 const root = await mkdtemp(join(tmpdir(),'md-cleanup-test-'));
 try {
  await mkdir(join(root,'izipizi-old123')); await writeFile(join(root,'izipizi-old123','partial.mp4'),'partial');
  await mkdir(join(root,'izipizi-new123')); await mkdir(join(root,'unrelated')); await symlink(join(root,'unrelated'),join(root,'izipizi-lnk123'));
  const past = new Date(Date.now() - 7200000); await utimes(join(root,'izipizi-old123'),past,past); await utimes(join(root,'unrelated'),past,past);
  await cleanupStaleTemp(root);
  expect((await readdir(root)).sort()).toEqual(['izipizi-lnk123','izipizi-new123','unrelated']);
 } finally { await rm(root,{recursive:true,force:true}); }
});
