// A tiny local imitation of the two Supabase REST endpoints the adapter uses (for offline testing only).
import http from 'node:http';
export function startMock(port) {
  const kv = new Map(), bins = new Map();
  const srv = http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, 'http://x'); const chunks = []; for await (const c of rq) chunks.push(c); const body = Buffer.concat(chunks);
    const send = (st, data, type = 'application/json') => { rs.writeHead(st, { 'content-type': type }); rs.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
    if (rq.headers.apikey !== 'test-secret-key') return send(401, { message: 'bad key' });
    if (u.pathname === '/rest/v1/kv') {
      const f = u.searchParams; const eq = (f.get('key') || '').startsWith('eq.') ? f.get('key').slice(3) : null;
      if (rq.method === 'POST') { const b = JSON.parse(body); kv.set(b.key, b.value); return send(201, ''); }
      if (rq.method === 'DELETE') { kv.delete(eq); return send(204, ''); }
      let keys = [...kv.keys()].sort(); if (eq !== null) keys = keys.filter(k => k === eq); else { const all = f.getAll('key'); const gte = all.find(x => x.startsWith('gte.')).slice(4), lt = all.find(x => x.startsWith('lt.')).slice(3); keys = keys.filter(k => k >= gte && k < lt); }
      const off = +f.get('offset') || 0, lim = +f.get('limit') || 1000; const sel = f.get('select'); return send(200, keys.slice(off, off + lim).map(k => sel === 'value' ? { value: kv.get(k) } : sel === 'key' ? { key: k } : { key: k, value: kv.get(k) }));
    }
    const m = u.pathname.match(/^\/storage\/v1\/object\/media\/(.+)$/);
    if (m) { const k = decodeURIComponent(m[1]); if (rq.method === 'POST') { bins.set(k, body); return send(200, { Key: k }); } if (rq.method === 'DELETE') { bins.delete(k); return send(200, {}); } if (!bins.has(k)) return send(400, { error: 'not_found' }); return send(200, bins.get(k), 'application/octet-stream'); }
    send(404, {});
  }); return new Promise(ok => srv.listen(port, () => ok(srv)));
}
if (process.argv[1].endsWith('mock-supabase.mjs')) { await startMock(54399); console.log('mock on 54399'); }
