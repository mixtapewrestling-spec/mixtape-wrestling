import { readFileSync, writeFileSync } from 'fs';

const path = './dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf-8'));

// Remove SESSION KV binding
delete config.kv_namespaces;

// Remove reserved ASSETS binding
if (config.assets?.binding === 'ASSETS') {
  delete config.assets;
}

// Add our D1 binding
config.d1_databases = [{
  binding: 'DB',
  database_name: 'mixtape-tickets',
  database_id: 'db53921c-0d35-4db7-a5a9-65e3137b90f4',
}];

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('wrangler.json patched successfully');
