import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], target: 'node24', splitting: false, clean: true, noExternal: ['@izipizi/shared'] });
