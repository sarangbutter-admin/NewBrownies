// Netlify build step: (1) extract the default product catalog for server-side pricing,
// (2) copy third-party browser libraries into /public/vendor so nothing is loaded from a CDN.
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const m = html.match(/const BASE=(\[[\s\S]*?\]);/); if (!m) throw new Error('BASE catalog not found in public/index.html');
const base = vm.runInNewContext(m[1]).map(({ id, c, n, p, e, d }) => ({ id, c, n, p, e, d }));
fs.writeFileSync(path.join(root, 'netlify/functions/catalog.json'), JSON.stringify(base, null, 1)); console.log('catalog.json:', base.length, 'products');
const vend = path.join(root, 'public/vendor'); fs.mkdirSync(vend, { recursive: true });
const copy = (from, to) => { const f = path.join(root, 'node_modules', from); if (!fs.existsSync(f)) { console.warn('WARNING: missing', from, '(run npm install)'); return; } fs.copyFileSync(f, path.join(vend, to)); console.log('vendor:', to); };
copy('jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'); copy('qrcode-generator/qrcode.js', 'qrcode.js'); copy('leaflet/dist/leaflet.js', 'leaflet.js'); copy('leaflet/dist/leaflet.css', 'leaflet.css');
