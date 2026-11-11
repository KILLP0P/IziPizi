import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// mkdtemp suffixes are six alphanumeric characters. Never follow a symlink,
// delete another user's directory, or touch an unrecognised prefix.
export async function cleanupStaleTemp(root: string, now = Date.now()): Promise<void> {
  const names = await readdir(root);
  for (const name of names) {
    if (!/^(?:izipizi|mediadrop)-[a-zA-Z0-9]{6}$/.test(name)) continue;
    const path = join(root,name);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) continue;
      if (now - info.mtimeMs > 60 * 60 * 1000) await rm(path,{ recursive:true, force:true });
    } catch { /* Another process may have finished cleaning the same job. */ }
  }
}
