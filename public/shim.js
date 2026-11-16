/* Sarang Butter – browser connector.
   Gives the shop page the same small database / upload / download interface it was built against,
   but backed by the Netlify server (/api). No keys or secrets live in the browser. */
(() => {
  const clone = x => JSON.parse(JSON.stringify(x));
  async function api(path, body) {
    const r = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    /* a 401 / 403 with no JSON message did not come from this shop's server: the hosting platform's visitor protection (login or password) answered, e.g. on a private preview */
    if (!r.ok && !j.error && (r.status === 401 || r.status === 403)) throw Object.assign(new Error('The site asked for a sign-in again, so your request was not sent. Please reload the page and try again.'), { status: r.status, code: 'host_auth' });
    if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed (' + r.status + ')'), { status: r.status, code: j.code });
    return j;
  }
  window.API = api;
  let ME = null; window.claudeMe = async (force) => (ME && !force ? ME : (ME = await api('me')));
  const snapC = docs => ({ docs: docs.map(d => ({ id: d.id, data: () => clone(d.data) })), empty: !docs.length, size: docs.length, forEach(cb) { this.docs.forEach(cb); } });
  const snapD = r => ({ id: r.id, exists: !!r.exists, data: () => (r.exists ? clone(r.data) : undefined) });
  /* ---- live updates by polling (paused while the tab is hidden) ---- */
  const subs = new Set(); let revs = {}, busy = false, timer = null;
  /* Polling slows down when nobody touches the page, so a forgotten open tab costs almost nothing:
     customers: every 15 s while active, every 45 s after 2 min idle, and STOPPED after 10 min idle (resumes on touch);
     staff: every 12 s while active, every 30 s after 10 min idle (they keep getting new-order alerts). */
  let lastAct = Date.now();
  const idleMs = () => Date.now() - lastAct, isStaff = () => !!(ME && ME.staff);
  const paused = () => !isStaff() && idleMs() > 10 * 60000;
  const every = () => (isStaff() ? (idleMs() > 10 * 60000 ? 30000 : 12000) : (idleMs() > 2 * 60000 ? 45000 : 15000));
  const touched = () => { const was = paused(); lastAct = Date.now(); if (was) poll(); };
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(e => window.addEventListener(e, touched, { passive: true, capture: true }));
  /* Reads that happen together (page start-up, or several things changed) are sent as ONE request. */
  let pend = [], pt = null;
  const opOf = s => (s.type === 'c' ? { op: 'query', col: s.col, q: s.q } : { op: 'get', path: s.path });
  /* Last-seen public shop data (menu, categories, settings…) is kept on this device so a refresh or a new visit
     draws the real shop at once instead of the built-in defaults; fresh data replaces it a moment later.
     Never on the owner site and never for anything personal (orders, status, complaints, filtered queries). */
  const CK = 'td_c1:', canCache = s => !/^\/admin/.test(location.pathname) && (s.type === 'c' ? ['menu', 'cats', 'variants', 'news', 'reviews', 'coupons'].includes(s.col) && !(s.q && s.q.where && s.q.where.length) : /^config\/[a-z0-9]+$/.test(s.path || ''));
  const ckey = s => CK + (s.type === 'c' ? 'c:' + s.col : 'd:' + s.path);
  function apply(s, r) {
    let key, out;
    if (s.type === 'c') { key = JSON.stringify(r.docs); out = snapC(r.docs); } else { key = JSON.stringify(r); out = snapD(r); }
    if (key !== s.last) { s.last = key; s.cb(out); if (!s.cached && canCache(s)) try { localStorage.setItem(ckey(s), key); } catch (e) { } }
  }
  function run(s) { return new Promise(res => { pend.push({ s, res }); if (!pt) pt = setTimeout(flush, 25); }); }
  async function flush() {
    const all = pend; pend = []; pt = null;
    for (let i = 0; i < all.length; i += 40) {
      const L = all.slice(i, i + 40); let rs;
      try { const r = await api('db', L.length === 1 ? opOf(L[0].s) : { op: 'multi', ops: L.map(x => opOf(x.s)) }); rs = L.length === 1 ? [{ r }] : r.results; }
      catch (e) { rs = L.map(() => ({ error: e })); }
      L.forEach(({ s, res }, k) => {
        const x = rs[k] || {};
        try { if (x.error) { if (s.err) s.err(x.error instanceof Error ? x.error : new Error(String(x.error))); } else apply(s, x.r); } catch (e) { if (s.err) s.err(e); }
        res();
      });
    }
  }
  async function poll() {
    if (busy || document.hidden || paused() || !subs.size) return; busy = true;
    try {
      const cols = [...new Set([...subs].map(s => s.col))], r = await api('rev?c=' + cols.join(',')), changed = new Set();
      cols.forEach(c => { if (c in revs && revs[c] !== r.revs[c]) changed.add(c); revs[c] = r.revs[c]; });
      await Promise.all([...subs].filter(s => changed.has(s.col)).map(run));
    } catch (e) { /* offline: try again next tick */ } finally { busy = false; }
  }
  window.pollNow = () => setTimeout(poll, 120);
  window.refetchAll = async () => { await Promise.all([...subs].map(run)); };
  function start() { if (timer) return; const tick = async () => { await poll(); timer = setTimeout(tick, every()); }; timer = setTimeout(tick, every()); document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); }); }
  function subscribe(s) {
    s.last = null; s.col = s.col || s.path.split('/')[0]; subs.add(s);
    if (canCache(s)) { let v = null; try { v = localStorage.getItem(ckey(s)); } catch (e) { } if (v) Promise.resolve().then(() => { if (s.last !== null || !subs.has(s)) return; try { const r = JSON.parse(v); s.cached = true; apply(s, s.type === 'c' ? { docs: r } : r); } catch (e) { s.last = null; } s.cached = false; }); }
    setTimeout(() => run(s).then(() => { if (!(s.col in revs)) poll(); }), 0); start(); return () => subs.delete(s);
  }
  const wr = async body => { const r = await api('db', body); window.pollNow(); return r; };
  const mkq = (col, q) => ({
    where: (f, o, v) => mkq(col, { ...q, where: [...q.where, [f, o, v]] }),
    orderBy: (f, d) => mkq(col, { ...q, order: [f, d || 'asc'] }),
    limit: n => mkq(col, { ...q, limit: n }),
    get: async () => snapC((await api('db', { op: 'query', col, q })).docs),
    onSnapshot: (cb, err) => subscribe({ type: 'c', col, q, cb, err }),
    add: data => wr({ op: 'add', col, data: clone(data) })
  });
  const DB = {
    collection: col => mkq(col, { where: [], order: null, limit: 0 }),
    doc: path => ({
      get: async () => snapD(await api('db', { op: 'get', path })),
      set: data => wr({ op: 'set', path, data: clone(data) }),
      update: data => wr({ op: 'update', path, data: clone(data) }),
      delete: () => wr({ op: 'delete', path }),
      onSnapshot: (cb, err) => subscribe({ type: 'd', path, cb, err })
    })
  };
  const assets = {
    async upload(blob) { const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob, credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Upload failed'); return j; },
    async delete(id) { await fetch('/api/upload?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' }); }
  };
  const downloads = {
    async save({ filename, data }) {
      const type = /\.pdf$/i.test(filename) ? 'application/pdf' : /\.jpe?g$/i.test(filename) ? 'image/jpeg' : 'application/octet-stream';
      const b = data instanceof Blob ? data : new Blob([data], { type }), a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
  };
  window.claude = { use: async k => (k === 'db' ? DB : k === 'user' ? { id: async () => (await window.claudeMe()).uid, canEdit: async () => !!(await window.claudeMe()).staff } : k === 'assets' ? assets : k === 'downloads' ? downloads : null) };
})();
