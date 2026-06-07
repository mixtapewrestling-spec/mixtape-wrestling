import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// Copy _worker.js
copyFileSync('./dist/server/entry.mjs', './dist/client/_worker.js');

// Copy all chunks
const chunksDir = './dist/server/chunks';
const destChunks = './dist/client/chunks';
mkdirSync(destChunks, { recursive: true });
readdirSync(chunksDir).forEach(file => {
  copyFileSync(join(chunksDir, file), join(destChunks, file));
});

// Patch wrangler.json
const path = './dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf-8'));

delete config.kv_namespaces;
delete config.assets;
delete config.main;
delete config.rules;

config.pages_build_output_dir = '../client';
config.d1_databases = [{
  binding: 'DB',
  database_name: 'mixtape-tickets',
  database_id: 'db53921c-0d35-4db7-a5a9-65e3137b90f4',
}];

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('Done: _worker.js, chunks, and wrangler.json all patched');
