#!/usr/bin/env node
// Copies Konva (installed by `npm install`) into src/vendor/ so the app never needs the network to start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function vendorKonva() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const from = path.join(root, 'node_modules', 'konva', 'konva.min.js');
  if (!fs.existsSync(from)) {
    console.error('Konva is not installed yet. Run:  npm install');
    process.exit(1);
  }
  const to = path.join(root, 'src', 'vendor', 'konva.min.js');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return to;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('vendor-konva.mjs')) {
  console.log('Konva copied to', vendorKonva());
}
