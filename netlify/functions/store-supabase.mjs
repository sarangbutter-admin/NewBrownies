// Storage backed by Supabase (Postgres table `kv` + Storage bucket `media`), using only the REST API (no extra packages).
// The secret key must live ONLY in Netlify environment variables – never in the browser or in git.
export function supabaseStore({ url, key, bucket = 'media' }) {
  const base = String(url).replace(/\/+$/, '');
  const hdr = (extra = {}) => ({ apikey: key, ...(String(key).startsWith('eyJ') ? { authorization: 'Bearer ' + key } : {}), ...extra });
  const enc = encodeURIComponent;
  const bump = p => p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1); // end of a "starts with" range
  async function ok(r, what) { if (!r.ok) throw new Error(`Supabase ${what} failed (${r.status}): ${(await r.text()).slice(0, 200)}`); return r; }
  async function rows(prefix, select) {
    const out = []; for (let off = 0; ; off += 1000) {
      const r = await ok(await fetch(`${base}/rest/v1/kv?select=${select}&key=gte.${enc(prefix)}&key=lt.${enc(bump(prefix))}&order=key.asc&limit=1000&offset=${off}`, { headers: hdr() }), 'list');
      const part = await r.json(); out.push(...part); if (part.length < 1000) return out;
    }
  }
  const objUrl = k => `${base}/storage/v1/object/${bucket}/${k.split('/').map(enc).join('/')}`;
  return {
    async getJSON(k) { const r = await ok(await fetch(`${base}/rest/v1/kv?select=value&key=eq.${enc(k)}`, { headers: hdr() }), 'read'); const a = await r.json(); return a.length ? a[0].value : null; },
    async setJSON(k, v) { await ok(await fetch(`${base}/rest/v1/kv?on_conflict=key`, { method: 'POST', headers: hdr({ 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ key: k, value: v, updated_at: new Date().toISOString() }) }), 'write'); },
    async del(k) {
      if (k.startsWith('bin/')) { const r = await fetch(objUrl(k), { method: 'DELETE', headers: hdr() }); if (!r.ok && r.status !== 404 && r.status !== 400) await ok(r, 'delete file'); return; }
      await ok(await fetch(`${base}/rest/v1/kv?key=eq.${enc(k)}`, { method: 'DELETE', headers: hdr() }), 'delete');
    },
    list: async prefix => (await rows(prefix, 'key')).map(r => r.key),
    listJSON: prefix => rows(prefix, 'key,value'),
    async getBin(k) { const r = await fetch(objUrl(k), { headers: hdr() }); if (!r.ok) return null; return r.arrayBuffer(); },
    async setBin(k, buf, type) { await ok(await fetch(objUrl(k), { method: 'POST', headers: hdr({ 'content-type': type || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '31536000' }), body: buf }), 'upload'); }
  };
}
