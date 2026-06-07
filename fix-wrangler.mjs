import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  readdirSync(src).forEach(file => {
    const srcPath = join(src, file);
    const destPath = join(dest, file);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  });
}

// Copy everything from server to client
copyDir('./dist/server', './dist/client');

// Rename entry.mjs to _worker.js
copyFileSync('./dist/client/entry.mjs', './dist/client/_worker.js');

// Patch wrangler.json
const path = './dist/client/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf-8'));

delete config.kv_namespaces;
delete config.assets;
delete config.main;
delete config.rules;

config.pages_build_output_dir = '.';
config.d1_databases = [{
  binding: 'DB',
  database_name: 'mixtape-tickets',
  database_id: 'db53921c-0d35-4db7-a5a9-65e3137b90f4',
}];

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('Done: all server files copied to client, _worker.js ready');
