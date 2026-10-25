#!/usr/bin/env node
// Builds desktop/src/ (what the Tauri app loads) from the website's files. Nothing in the website is changed.
//
//   node scripts/sync.mjs "C:\path\to\site"        (or set SITE_DIR, or put the path in desktop.config.json)
//
// Run it again whenever the website changes. It copies the front end, turns index.php into a plain index.html,
// vendors Konva so the app works offline, and drops in the desktop shim (shim/desktop-shim.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertIndexPhp } from './php-to-html.mjs';
import { vendorKonva } from './vendor-konva.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'src');

function siteDir() {
  const arg = process.argv[2] || process.env.SITE_DIR;
  if (arg) return path.resolve(arg);
  const cfg = path.join(root, 'desktop.config.json');
  if (fs.existsSync(cfg)) return path.resolve(root, JSON.parse(fs.readFileSync(cfg, 'utf8')).siteDir);
  return path.resolve(root, '..', 'site');
}
const site = siteDir();
if (!fs.existsSync(path.join(site, 'index.php'))) {
  console.error(`Cannot find the website at ${site} (no index.php).\nRun:  node scripts/sync.mjs "<path to the site folder>"`);
  process.exit(1);
}

const rm = p => fs.rmSync(p, { recursive: true, force: true });
const mkdir = p => fs.mkdirSync(p, { recursive: true });
const copy = (from, to) => { mkdir(path.dirname(to)); fs.copyFileSync(from, to); };

rm(out); mkdir(out);

// 1. The JavaScript modules, exactly as the website serves them.
const jsFiles = fs.readdirSync(path.join(site, 'js')).filter(f => f.endsWith('.js')).sort();
jsFiles.forEach(f => copy(path.join(site, 'js', f), path.join(out, 'js', f)));

// 2. Images the editor itself uses (not the marketing videos and posters).
['studioLogo.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'].forEach(f => {
  const p = path.join(site, 'images', f);
  if (fs.existsSync(p)) copy(p, path.join(out, 'images', f));
});

// 3. Symbol libraries, bundled. The shim answers list / get from these instead of the server.
const libDir = path.join(site, 'symbol-libraries');
const libraries = [];
fs.readdirSync(libDir).filter(f => f.endsWith('.json')).sort().forEach(f => {
  const raw = fs.readFileSync(path.join(libDir, f), 'utf8');
  const data = JSON.parse(raw);
  if (!data || !data.symbols || typeof data.symbols !== 'object') return;   // not a symbol library
  copy(path.join(libDir, f), path.join(out, 'symbol-libraries', f));
  libraries.push({
    filename: f,
    libraryName: typeof data.libraryName === 'string' && data.libraryName ? data.libraryName : f.replace(/\.json$/, ''),
    symbolCount: Object.keys(data.symbols).length,
  });
});
libraries.sort((a, b) => a.libraryName.localeCompare(b.libraryName, undefined, { sensitivity: 'base' }));
fs.writeFileSync(path.join(out, 'symbol-libraries', 'index.json'), JSON.stringify({ libraries }, null, 2));

// 4. Konva, from npm, so there is no network request at start-up.
vendorKonva();

// 5. The desktop shim.
copy(path.join(root, 'shim', 'desktop-shim.js'), path.join(out, 'desktop-shim.js'));

// 6. index.php -> index.html
const importMap = { imports: Object.fromEntries(jsFiles.map(f => [`./js/${f}`, `./js/${f}`])) };
let html = convertIndexPhp(fs.readFileSync(path.join(site, 'index.php'), 'utf8'), {
  importMapJson: JSON.stringify(importMap),
  moduleSrc: { version: 'desktop' },
});

const must = (re, why) => { if (!re.test(html)) throw new Error(`index.html: expected to find ${why}`); };
const swap = (re, to, why) => { must(re, why); html = html.replace(re, to); };

// the shim goes first, before any other script, so it is in place before the app asks for anything
swap(/<script src="https:\/\/unpkg\.com\/konva@9\/konva\.min\.js"><\/script>/,
  '<script src="desktop-shim.js"></script>\n  <script src="vendor/konva.min.js"></script>', 'the Konva script tag');
// no service worker (the app is installed, so it needs no offline cache) and no web-app manifest
html = html.replace(/<script>\s*if\('serviceWorker' in navigator\)[\s\S]*?<\/script>/, '');
html = html.replace(/<link rel="manifest"[^>]*>\s*/, '');
// the website's login / billing links have no place in the desktop window
html = html.replace(/<a href="\/auth\/stripe-portal\.php"[\s\S]*?<\/a>\s*/, '');
html = html.replace(/<a href="\/auth\/logout\.php"[\s\S]*?<\/a>\s*/, '');
// relative paths so the page does not depend on where it is served from
html = html.replace(/(src|href)="\/(images)\//g, '$1="$2/');
html = html.replace(/<title>[^<]*<\/title>/, '<title>SchematicStudio</title>');
fs.writeFileSync(path.join(out, 'index.html'), html);

console.log(`Synced ${jsFiles.length} modules, ${libraries.length} libraries from ${site}\n  -> ${out}`);
