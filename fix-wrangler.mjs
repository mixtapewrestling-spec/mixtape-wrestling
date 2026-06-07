import { readFileSync, writeFileSync, copyFileSync } from 'fs';

// Copy the worker entry point to where Pages expects it
copyFileSync('./dist/server/entry.mjs', './dist/client/_worker.js');

// Read and patch the wrangler.json
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
console.log('wrangler.json patched and _worker.js copied successfully');
