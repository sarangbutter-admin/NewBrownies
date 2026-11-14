// Local dev server: serves /public and routes /api + /_blob to the same server code used on Netlify.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeApp } from '../netlify/functions/core.mjs'; import { fsStore } from './store-fs.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), port = +process.env.PORT || 8888;
process.env.SESSION_SECRET ||= 'dev-secret-dev-secret-dev-secret-1234'; process.env.OWNER_SETUP_KEY ||= 'dev-setup-key-123456';
const app = makeApp(fsStore(process.env.DATA_DIR || path.join(root, '.data')));
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8'), CSP = (toml.match(/Content-Security-Policy = "([^"]+)"/) || [])[1];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };
http.createServer(async (rq, rs) => {
  try {
    const u = new URL(rq.url, `http://${rq.headers.host}`);
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/_blob/') || ['/', '/feed.xml', '/sitemap.xml', '/robots.txt', '/llms.txt'].includes(u.pathname) || u.pathname.startsWith('/p/')) {
      const chunks = []; for await (const c of rq) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const res = await app.handle(new Request(u, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body }));
      const h = {}; res.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; }); const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []; if (sc.length) h['set-cookie'] = sc;
      rs.writeHead(res.status, h); rs.end(Buffer.from(await res.arrayBuffer())); return;
    }
    let p = path.join(root, 'public', u.pathname === '/' || u.pathname === '/admin' || u.pathname === '/admin/' ? 'index.html' : u.pathname === '/affiliate' ? 'affiliate.html' : u.pathname); if (!p.startsWith(path.join(root, 'public'))) throw 0;
    const b = await fs.promises.readFile(p); rs.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', ...(CSP ? { 'content-security-policy': CSP } : {}) }); rs.end(b);
  } catch { rs.writeHead(404); rs.end('Not found'); }
}).listen(port, () => console.log('dev server on http://localhost:' + port));
