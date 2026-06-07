import { readFileSync, writeFileSync } from 'fs';

const path = './dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf-8'));

// Remove everything Pages doesn't support
delete config.kv_namespaces;
delete config.assets;
delete config.main;
delete config.rules;

// Add our D1 binding
config.d1_databases = [{
  binding: 'DB',
  database_name: 'mixtape-tickets',
  database_id: 'db53921c-0d35-4db7-a5a9-65e3137b90f4',
}];

// Set required Pages field
config.pages_build_output_dir = 'dist';

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('wrangler.json patched successfully');
