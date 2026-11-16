// Folklore Brownies – server logic. Storage-agnostic: pass a `store` adapter (Netlify Blobs in production, files in dev).
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import pth from 'node:path';
import { promisify } from 'node:util';
import CATALOG from './catalog.json' with { type: 'json' };
import HOSTS from './hosts.json' with { type: 'json' };

const pbkdf2 = promisify(crypto.pbkdf2);
const HOUR = 3600e3;
/*GM-SHARED-START*/
/* Catch the Salt Bread: the same code runs in the browser and on the server, so the "highest possible score" the player sees is the one the server checks */
const gmNorm = g => {
  g = g && typeof g === 'object' ? g : {};
  const n = (v, lo, hi, d) => { v = +v; if (!v) v = d; return Math.min(hi, Math.max(lo, v)); },
    one = (x, d) => { x = x && typeof x === 'object' ? x : {}; return { pid: Math.max(0, Math.floor(+x.pid || 0)), w: +x.w >= 0 ? Math.min(1000, +x.w) : d.w, pts: Math.max(1, Math.min(100000, Math.floor(+x.pts || d.pts || 1))), sec: Math.max(1, Math.min(30, Math.floor(+x.sec || d.sec || 5))) }; };
  return { on: g.on !== false, tt: String(g.tt || '').slice(0, 60), fall: n(g.fall, 2, 30, 8), dur: Math.floor(n(g.dur, 10, 120, 30)), gap: n(g.gap, 0.3, 5, 0.8), need: Math.floor(n(g.need, 10, 100, 70)),
    salt: Array.isArray(g.salt) && g.salt.length ? g.salt.slice(0, 8).map(x => one(x, { w: 60, pts: 10 })) : [{ pid: 0, w: 65, pts: 10, sec: 5 }],
    flame: one(g.flame, { w: 15, pts: 20 }), gold: one(g.gold, { w: 10, pts: 20 }), time: one(g.time, { w: 10, pts: 1, sec: 5 }) };
};
const gmRng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gmMake = (g, L) => {
  const pool = []; g.salt.forEach((x, i) => { if (x.w > 0) pool.push({ k: 's', i, w: x.w, p: x.pts, pid: x.pid }); });
  if (g.flame.w > 0) pool.push({ k: 'f', w: g.flame.w, p: g.flame.pts, pid: g.flame.pid }); if (g.gold.w > 0) pool.push({ k: 'g', w: g.gold.w, p: g.gold.pts, pid: g.gold.pid }); if (g.time.w > 0) pool.push({ k: 't', w: g.time.w, p: 0, sec: g.time.sec, pid: g.time.pid });
  const mult = 2 ** (L - 1), fall = g.fall / mult, tot = pool.reduce((s, e) => s + e.w, 0);
  if (!tot) return { pool, typeAt: () => null, max: 0, cmax: 0, n: 0, total: g.dur, mult, fall, need: 0, shares: [] };
  const ex = pool.map(e => e.w / tot * 100), base = ex.map(Math.floor), rem = 100 - base.reduce((a, b) => a + b, 0), ord = ex.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; j < rem; j++) base[ord[j % ord.length][1]]++;
  const block = []; base.forEach((c, i) => { for (let j = 0; j < c; j++) block.push(i); });
  const rnd = gmRng(1000); for (let i = block.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = block[i]; block[i] = block[j]; block[j] = t; }
  const typeAt = i => pool[block[(i - 1) % block.length]];
  let total = g.dur, i = 1, max = 0, cmax = 0, first = true; for (; i < 5000 && Math.round(i * g.gap * 1000) < Math.round(total * 1000); i++) { const e = typeAt(i); if (e.k === 's' || e.k === 'g') { max += e.p; if (first) first = false; else cmax += Math.ceil(e.p / 2); } else if (e.k === 't') total += e.sec; }
  return { pool, typeAt, max, cmax, n: i - 1, total, mult, fall, need: Math.ceil(max * g.need / 100), shares: base };
};
/*GM-SHARED-END*/
/* names on the minigame board: rude words (English and Indonesian, also with look-alike letters and spacing) are refused */
const GM_BAD_LONG = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard', 'whore', 'slut', 'nigg', 'fagg', 'porn', 'cock', 'anjing', 'bangsat', 'bajingan', 'kontol', 'memek', 'ngentot', 'ngentod', 'jancok', 'jancuk', 'kampret', 'goblok', 'tolol', 'pantek', 'pepek', 'lonte', 'jablay', 'cukimai', 'sange', 'bokep', 'setan', 'iblis', 'brengsek', 'sialan', 'keparat', 'bedebah', 'banci', 'perek', 'celeng', 'bego'], GM_BAD_SHORT = ['asu', 'tai', 'sex', 'babi', 'coli', 'pler', 'tit', 'ass', 'dik', 'jck', 'ngtd', 'anj'];
const gmBad = name => { const lk = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' }, flat = String(name || '').toLowerCase().replace(/[01345788@$!|]/g, c => lk[c] || c).replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'), words = String(name || '').toLowerCase().replace(/[01345788@$!|]/g, c => lk[c] || c).split(/[^a-z]+/).map(w => w.replace(/(.)\1+/g, '$1')).filter(Boolean);
  return GM_BAD_LONG.some(w => flat.includes(w.replace(/(.)\1+/g, '$1'))) || words.some(w => GM_BAD_SHORT.includes(w)); };
const GM_ICONS = ['🥐', '🍞', '🥖', '🧈', '🔥', '⭐', '🎉', '🦄', '🐱', '🐼', '🚀', '👑'];
export { gmNorm, gmMake, gmBad };
export class HttpError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
const E = (s, c, m) => new HttpError(s, c, m);

/* ---------- small helpers ---------- */
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const nwa = s => String(s || '').replace(/\D/g, '').replace(/^0/, '62');
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const rid = (n = 9) => crypto.randomBytes(n).toString('hex');
const b64u = b => Buffer.from(b).toString('base64url');
const SECRET = () => { const s = process.env.SESSION_SECRET; if (!s || s.length < 32) throw E(500, 'server_misconfigured', 'SESSION_SECRET is missing or shorter than 32 characters'); return s; };
const hmac = d => crypto.createHmac('sha256', SECRET()).update(d).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const signTok = (obj, ttlSec) => { const p = b64u(JSON.stringify({ ...obj, exp: Date.now() + ttlSec * 1000 })); return p + '.' + hmac(p); };
const verTok = t => { try { const [p, s] = String(t || '').split('.'); if (!p || !s || !safeEq(s, hmac(p))) return null; const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; } };
const parseCookies = h => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));

/* ---------- defaults (must match the shop page) ---------- */
const DEF = {
  ship: { mode: 'item', rate: 5000, base: 0, freeMin: 300000, discMin: 150000, discPct: 50 },
  fees: { tax: 11, svc: 0, pack: 0, pm: 'order', exp: 24, cw: 48 },
  slots: { dl: '09:00-12:00\n12:00-15:00\n15:00-18:00', pu: '10:00-12:00\n12:00-14:00\n14:00-16:00\n16:00-18:00', days: 5, lead: 2 },
  tiers: { regular: { qty: 10, amt: 0, pct: 5 }, b2b: { qty: 20, amt: 0, pct: 15 } },
  ship2: { mode: 'flat', rate: 20000, base: 0, freeMin: 0, discMin: 0, discPct: 0 },
  methods: { dl: true, sd: false, pu: true, cut: '14:00', sdw: '', sdx: 60 },
  courier: { bs: false, list: 'jne,jnt,sicepat,anteraja,gojek,grab', lat: 0, lng: 0, pc: '', store: 'always', sn: 'Store courier', warn: '', on: '', op: '', oa: '', onote: '', pkc: { on: true, t: '19:00' }, ttl: 30, dd: false, sp: 25000, spk: 3000, skm: 0 },
  fdev: { fs: 0, fe: 0, full: true, amt: 0, min: 0, t: '', cs: [] },
  inv: { logo: '', qr: '', qrc: '', name: '', addr: '', ct: '', tax: '', ft: '', dft: '', col: '', sz: 'a5', dnp: false, dcod: false, qa: false },
  pl: { on: false, launch: 0, limit: 1000, name: 'Prelaunch gift', ttl: '', sub: '', btn: '', cdt: '', ldt: '', ch: false, rw: [], pop: {}, col: '', bg: '', tx: '', full: {}, car: { on: true, ids: [], sp: 30, rs: 1.5 }, bgi: '', bfx: 'pulse', circ: { on: true }, gm: gmNorm({}) },
  bb: { on: false, name: 'Blindbox', fs: 0, fe: 0, amt: 0, box: 0, rep: true, ar: false, mx: 10, uc: 1, ur: false, cap: 3, ch: false, msg: '', rw: [], pop: {} },
  foot: { on: false, t: '', tx: '', cp: '', bg: '', fc: '', logo: '', ln: [], rc: { on: false, t: '', sp: 30, rs: 1.5, cards: [] } },
  aff: { on: true, rate: 10, hold: 7, min: 100000, disc: 5, days: 30, signup: true, pday: 4, email: '', look: {}, sac: { on: true, max: 50, ot: '', nt: '', oc: '', nc: '', oi: '', ni: '' } },
  rrw: { on: false, name: 'Review Box', fs: 0, fe: 0, days: 7, n: 1, min: 5, cap: 3, ch: false, msg: '', rw: [], pop: {} },
  doku: { on: false, sb: true, q: true, o: true, fp: 0, ff: 0 },
  mkt: { on: true, brand: 'Folklore Brownies', gcat: 'Food, Beverages & Tobacco > Food Items > Bakery', site: '', px: '', gt: '', gc: '' }
};
const BS_API = 'https://api.biteship.com/v1', BS_URL = BS_API + '/rates/couriers', GEO_URL = 'https://nominatim.openstreetmap.org';
/* a picture for the shop: an uploaded file id or an https link */
const okMedia = u => /^[0-9a-f]{24}$/.test(u) || /^\/hero\/[\w.-]{1,80}$/.test(u) || (/^https:\/\/[^\s"'<>`\\]{4,500}$/.test(u) && !/^https:\/\/[^/]*@/.test(u));
const COLLECTIONS = new Set(['orders', 'status', 'menu', 'cats', 'variants', 'coupons', 'redeem', 'reviews', 'proofs', 'complaints', 'cmpimgs', 'logs', 'customers', 'config', 'news', 'flash']);
const PUBLIC_CONFIG = new Set(['announce', 'order', 'badges', 'fonts', 'theme', 'pay2', 'thanks', 'thanks2', 'strip2', 'landing', 'marquee', 'ship', 'fees', 'slots', 'tiers', 'shop', 'pm', 'boxlid', 'methods', 'ship2', 'courier', 'fdev', 'bg', 'cdown', 'pdet', 'turnstile', 'mkt', 'doku', 'pl', 'lay', 'bb', 'rrw', 'gbadge', 'aff', 'foot', 'loc', 'faq']);
const pubCourier = d => { const { on, op, oa, onote, pkc, lat, lng, pc, ttl, ...rest } = d || {}; return rest; };
/* The owner site (login, staff, payments, settings) only works on the admin addresses listed in hosts.json (plus ADMIN_HOSTS, comma separated, if set).
   On every other address – the public shop domain, Netlify's own addresses, deploy permalinks – staff sessions are ignored and the owner functions answer "not found". */
const ADMIN_HOSTS = [...HOSTS.admin, ...String(process.env.ADMIN_HOSTS || '').split(',')].map(x => x.trim().toLowerCase()).filter(Boolean);
const isAdminHost = h => ADMIN_HOSTS.includes(String(h || '').toLowerCase().replace(/:\d+$/, ''));
const OWNER_ONLY = new Set(['login', 'setup', 'staff', 'reauth', 'stats', 'courier', 'pickup', 'upload', 'turnstile', 'mkt', 'affo']);
const COMPLAINT_REASONS = ['Damaged item', 'Wrong item', 'Missing item', 'Quality problem', 'Other'];

/* ---------- context / data layer ---------- */
export function makeApp(store, opt = {}) {
  const CACHE = {};
  const revMemo = {};

  const dk = (c, id) => `db/${c}/${id}`;
  async function rev(c) { const m = revMemo[c]; if (m && Date.now() - m.t < 1500) return m.v; const v = (await store.getJSON(`meta/rev/${c}`)) || '0'; revMemo[c] = { v, t: Date.now() }; return v; }
  let revAllMemo = null;
  async function revAll() { if (revAllMemo && Date.now() - revAllMemo.t < 2000) return revAllMemo.v; const v = {}; for (const r of await store.listJSON('meta/rev/')) v[r.key.slice('meta/rev/'.length)] = r.value; revAllMemo = { v, t: Date.now() }; return v; }
  async function touch(c) { revAllMemo = null; const v = Date.now().toString(36) + rid(3); await store.setJSON(`meta/rev/${c}`, v); revMemo[c] = { v, t: Date.now() }; delete CACHE[c]; }
  const getDoc = (c, id) => store.getJSON(dk(c, id));
  async function putDoc(c, id, d) { await store.setJSON(dk(c, id), d); await touch(c); }
  async function delDoc(c, id) { await store.del(dk(c, id)); await touch(c); }
  async function listCol(c) {
    const rv = await rev(c), ce = CACHE[c];
    if (ce && ce.rev === rv) return ce.docs;
    const keys = store.listJSON ? [] : await store.list(`db/${c}/`), docs = [];
    if (store.listJSON) { for (const row of await store.listJSON(`db/${c}/`)) if (row.value) docs.push({ id: row.key.slice(`db/${c}/`.length), data: row.value }); CACHE[c] = { rev: rv, docs }; return docs; }
    for (let i = 0; i < keys.length; i += 25) {
      const part = await Promise.all(keys.slice(i, i + 25).map(async k => ({ id: k.slice(`db/${c}/`.length), data: await store.getJSON(k) })));
      part.forEach(p => { if (p.data) docs.push(p); });
    }
    CACHE[c] = { rev: rv, docs }; return docs;
  }
  const cfgDoc = async (id, def) => ({ ...def, ...((await getDoc('config', id)) || {}) });
  async function cfgAll() {
    const [ship, fees, slots, tiers, ship2, methods, courier, fdev] = await Promise.all([cfgDoc('ship', DEF.ship), cfgDoc('fees', DEF.fees), cfgDoc('slots', DEF.slots), getDoc('config', 'tiers'), cfgDoc('ship2', DEF.ship2), cfgDoc('methods', DEF.methods), cfgDoc('courier', DEF.courier), cfgDoc('fdev', DEF.fdev)]);
    return { ship, fees, slots, ship2, methods, courier, fdev, tiers: { regular: { ...DEF.tiers.regular, ...((tiers || {}).regular || {}) }, b2b: { ...DEF.tiers.b2b, ...((tiers || {}).b2b || {}) } } };
  }
  async function slog(act, tgt, det, by) { const id = Date.now().toString(36) + rid(3); await store.setJSON(dk('logs', id), { at: Date.now(), by, act, tgt: str(tgt, 160), det: str(det, 400) }); await touch('logs'); }
  /* Flash sale history: a sale that ran is kept in 'flash' (until the owner deletes it) when it is stopped, replaced by a new run, or ends. */
  const fsOfDoc = d => d && +d.fp > 0 && +d.fs > 0 && +d.fe > 0 ? { fp: +d.fp, fs: +d.fs, fe: +d.fe } : null;
  async function flashArchive(id, old, nd, by) {
    const fo = fsOfDoc(old), fn = fsOfDoc(nd), t = Date.now(); if (!fo || fo.fs > t) return;
    if (fn && fn.fs === fo.fs && fo.fe > t) return; // same run edited while live (new price or end time)
    const hid = `${id}_${fo.fs}`; if (await getDoc('flash', hid)) return;
    const base = CATALOG.find(b => String(b.id) === String(id)), op = +old.price > 0 ? +old.price : base ? base.p : +old.p || 0;
    await putDoc('flash', hid, { id: hid, pid: base ? base.id : +id, n: old.n || (base && base.n) || 'Item', e: old.e || (base && base.e) || '🍽️', fp: fo.fp, op, fs: fo.fs, fe: fo.fe, end: Math.min(fo.fe, t), why: fo.fe <= t ? 'ended' : fn ? 'replaced' : 'stopped', by, at: t });
  }
  /* Free delivery event history: kept in 'flash' as fd_<start> when the event is stopped, replaced or ends. */
  const fdLive = (f, t = Date.now()) => f && +f.fs > 0 && +f.fe > 0 && t >= +f.fs && t < +f.fe;
  async function fdArchive(old, nd, by) {
    const t = Date.now(); if (!old || !(+old.fs > 0) || +old.fs > t) return;
    if (nd && +nd.fs === +old.fs && +old.fe > t) return; // same event edited while live
    const hid = 'fd_' + (+old.fs); if (await getDoc('flash', hid)) return;
    await putDoc('flash', hid, { id: hid, k: 'fd', n: old.t || 'Free delivery', full: old.full !== false, amt: +old.amt || 0, min: +old.min || 0, fs: +old.fs, fe: +old.fe, end: Math.min(+old.fe, t), why: +old.fe <= t ? 'ended' : nd && +nd.fs > 0 ? 'replaced' : 'stopped', by, at: t });
  }
  /* time to pay: same-day orders have their own (short) limit in minutes, other orders the shop limit in hours; a rejected proof restarts it */
  const payMs = (o, cfg) => o.sd ? Math.max(10, +cfg.methods.sdx || 60) * 60e3 : (+cfg.fees.exp || 24) * HOUR, payTxt = (o, cfg) => o.sd ? `${Math.max(10, +cfg.methods.sdx || 60)} minutes` : `${+cfg.fees.exp || 24} hours`;
  const stageOf = async no => { const s = await getDoc('status', no); return s && typeof s.s === 'number' ? s.s : 0; };

  /* ---------- request context ---------- */
  async function ctxOf(req) {
    const url = new URL(req.url), ck = parseCookies(req.headers.get('cookie'));
    const secure = url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
    const c = { req, url, ck, secure, out: [], ip: req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local' };
    c.cookie = (name, val, maxAge, strict = true) => c.out.push(`${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=${strict ? 'Strict' : 'Lax'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
    c.clear = name => c.out.push(`${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
    // visitor id (customer identity): signed random value
    let vid = null; if (ck.vid) { const [v, s] = ck.vid.split('.'); if (v && s && /^[0-9a-f]{24}$/.test(v) && safeEq(s, hmac('vid:' + v))) vid = v; }
    if (!vid) { vid = rid(12); c.cookie('vid', vid + '.' + hmac('vid:' + vid), 365 * 86400, false); }
    c.vid = vid; c.host = url.hostname.toLowerCase(); c.adminHost = isAdminHost(url.hostname);
    // staff session (only on the admin addresses; an old session cookie on the public domain is removed)
    c.staff = null; const t = verTok(ck.stf); if (ck.stf && !c.adminHost) c.clear('stf');
    if (t && t.k === 'stf' && c.adminHost) { const rec = await store.getJSON('sec/staff/' + t.u); if (rec) c.staff = { u: rec.u, role: rec.role, perms: rec.perms || {} }; }
    // affiliate session (their own login page, separate from the owner site)
    c.aff = null; const at0 = verTok(ck.aff); if (at0 && at0.k === 'aff') { const rec = await store.getJSON('sec/affu/' + at0.u); if (rec && (rec.st === 'active' || rec.st === 'paused') && (at0.v || 0) === (rec.pwv || 0)) c.aff = rec; }
    // b2b session
    c.b2b = null; const b = verTok(ck.b2);
    if (b && b.k === 'b2') { const rec = await store.getJSON('sec/b2b/' + b.u); if (rec) c.b2b = { u: rec.u, name: rec.name || rec.u }; }
    c.reauth = (() => { const r = verTok(ck.rea); return !!(r && r.k === 'rea' && c.staff && r.u === c.staff.u); })();
    c.can = k => !!c.staff && (c.staff.role === 'owner' || !!c.staff.perms[k]);
    c.any = (...ks) => ks.some(k => c.can(k));
    c.owner = () => !!c.staff && c.staff.role === 'owner';
    return c;
  }
  async function bodyOf(req, max = 1_000_000) { const t = await req.text(); if (t.length > max) throw E(413, 'too_large', 'Request too large'); try { const j = JSON.parse(t || '{}'); if (!isObj(j)) throw 0; return j; } catch { throw E(400, 'bad_json', 'Invalid request'); } }

  /* ---------- rate limiting ---------- */
  async function rlGet(key) { const k = 'sec/rl/' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 40); const r = (await store.getJSON(k)) || { n: 0, t: Date.now() }; if (Date.now() - r.t > 15 * 60e3) { r.n = 0; r.t = Date.now(); } return { k, r }; }
  async function rlCheck(key, max = 8) { const { r } = await rlGet(key); if (r.n >= max) throw E(429, 'too_many', 'Too many attempts. Please wait 15 minutes and try again.'); }
  async function rlFail(key) { const { k, r } = await rlGet(key); r.n++; await store.setJSON(k, r); }
  async function rlReset(key) { const { k } = await rlGet(key); await store.del(k); }
  async function rlCount(key, max, msg) { const { k, r } = await rlGet(key); if (r.n >= max) throw E(429, 'too_many', msg || 'Too many requests. Please try again later.'); r.n++; await store.setJSON(k, r); }

  /* ---------- passwords ---------- */
  async function hashPw(pw, salt) { return (await pbkdf2(pw, salt, 210000, 32, 'sha256')).toString('hex'); }
  async function mkCred(pw) { const salt = rid(16); return { salt, hash: await hashPw(pw, salt) }; }
  async function checkPw(rec, pw) { if (!rec) { await hashPw(String(pw || ''), 'dummy-salt-for-timing'); return false; } return safeEq(await hashPw(String(pw || ''), rec.salt), rec.hash); }
  const okUser = u => /^[a-z0-9_.]{3,20}$/.test(u);
  const okPw = p => typeof p === 'string' && p.length >= 10 && p.length <= 200;

  /* ---------- pricing (same rules as the shop page) ---------- */
  function calc(its, o, cfg) {
    const S = o.sd ? cfg.ship2 : cfg.ship, FEE = cfg.fees;
    const sub = its.reduce((s, i) => s + i.u * i.q, 0), qty = its.reduce((s, i) => s + i.q, 0), kg = its.reduce((s, i) => s + i.q * i.w, 0), tr = cfg.tiers[o.tier] || cfg.tiers.regular;
    const td = tr.pct > 0 && qty > 0 && qty >= (tr.qty || 0) && sub >= (tr.amt || 0) ? Math.round(sub * tr.pct / 100) : 0;
    const cl = o.cpns || (o.cpn ? [o.cpn] : []), cd = cl.length ? Math.max(0, Math.min(sub - td, cl.reduce((t, c0) => t + (c0.type === 'pct' ? Math.round(sub * c0.v / 100) : +c0.v), 0))) : 0, net = Math.max(0, sub - td - cd);
    /* the amount a minimum purchase is checked against, set by the owner: 'before' = regular prices before flash sale, tier and coupon discounts (default), 'after' = what the items cost after them */
    const gsub = its.reduce((s, i) => s + (i.ob > i.u ? i.ob : i.u) * i.q, 0), mv = x => (x && x.mb === 'after' ? net : gsub);
    let raw = 0, sh = 0, free = false, fd = 0, rd = 0;
    if (o.mode === 'Delivery' && qty > 0) {
      /* the price: a partner courier's own price (Biteship) or the store formula; then the shop's shipping rules (free from / discounted from a minimum purchase) apply to either */
      raw = o.cr ? Math.max(0, Math.round(+o.cr.raw || 0)) : (S.mode === 'kg' ? S.rate * Math.max(1, Math.ceil(kg - 1e-9)) : S.mode === 'flat' ? +S.rate : S.rate * qty) + (+S.base || 0); sh = raw;
      if (S.freeMin > 0 && mv(S) >= S.freeMin) { sh = 0; free = true; } else if (S.discMin > 0 && S.discPct > 0 && mv(S) >= S.discMin) sh = Math.round(raw * (100 - S.discPct) / 100);
      rd = raw - sh;
      /* free delivery event: FULL free, or a fixed amount off the delivery price */
      if (o.fd && sh > 0 && !(+o.fd.min > 0 && mv(o.fd) < +o.fd.min)) { const n = o.fd.full ? 0 : Math.max(0, sh - Math.max(0, +o.fd.amt || 0)); fd = sh - n; sh = n; if (!sh) free = true; }
    }
    const svc = Math.round(net * (FEE.svc || 0) / 100), pack = qty > 0 ? (FEE.pm === 'item' ? qty * (+FEE.pack || 0) : +FEE.pack || 0) : 0, tax = Math.round((net + svc + pack) * (FEE.tax || 0) / 100);
    return { sub, gsub, qty, kg, td, cd, net, raw, sh, free, fd, rd, svc, pack, tax, total: net + svc + pack + tax + sh };
  }
  async function product(id) {
    const base = CATALOG.find(b => String(b.id) === String(id)), d = (await getDoc('menu', String(id))) || null;
    if (!base && !(d && d.custom)) return null;
    if (d && (d.del || d.off)) return null;
    const now = Date.now(), flash = d && d.fp && d.fs && d.fe && now >= d.fs && now < d.fe;
    const reg = d && +d.price > 0 ? +d.price : base ? base.p : +d.p || 0, price = flash ? +d.fp : reg;
    return { id: base ? base.id : +id, n: (d && d.n) || (base && base.n) || 'Item', e: (d && d.e) || (base && base.e) || '🍽️', price, ob: flash && reg > price ? reg : 0, kg: (d && +d.kg) || .4, stock: d && +d.sou > now ? 0 : d && typeof d.stock === 'number' ? d.stock : null, sot: !!(d && +d.sou > now), vr: ((d && d.vr) || []).filter(v => !((d && d.vd) || []).includes(v)), bx: d && isObj(d.bx) && Array.isArray(d.bx.ids) ? d.bx : null };
  }
  async function buildItems(rawItems, big) {
    const maxQ = big ? 99999 : 50;
    if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > (big ? 300 : 30)) throw E(400, 'bad_items', 'Your cart is empty or too large.');
    const out = [], need = {};
    for (const r of rawItems) {
      const q = Math.floor(+r.q); if (!(q >= 1 && q <= maxQ)) throw E(400, 'bad_qty', 'Invalid quantity.');
      const p = await product(r.id); if (!p) throw E(400, 'gone', 'An item in your cart is no longer available. Please refresh the page.');
      need[p.id] = (need[p.id] || 0) + q; if (p.sot) throw E(400, 'stock', `${p.n} is sold out today. Please remove it from your cart.`); if (p.stock !== null && need[p.id] > Math.max(0, p.stock)) throw E(400, 'stock', `${p.n} is out of stock or has fewer left than requested.`);
      const groups = []; for (const vid of p.vr) { const v = await getDoc('variants', vid); if (v && Array.isArray(v.opts)) groups.push(v); }
      const sel = Array.isArray(r.t) ? [...new Set(r.t.map(String))] : [], names = []; let extra = 0; const used = {};
      for (const key of sel) {
        const m = /^v_(.+)_(\d{1,3})$/.exec(key); const g = m && groups.find(x => x.id === m[1]); const o = g && g.opts[+m[2]];
        if (!g || !o) throw E(400, 'bad_variant', 'A selected option is no longer available. Please refresh the page.');
        if (g.req && used[g.id]) throw E(400, 'bad_variant', `Please choose only one option for ${g.n}.`);
        used[g.id] = (used[g.id] || 0) + 1; extra += Math.max(0, +o.p || 0); names.push((g.n ? g.n + ': ' : '') + o.n);
        /* optional groups can have a maximum number of picks (e.g. up to 4 toppings per brownie) */
        if (!g.req && +g.max > 0 && used[g.id] > +g.max) throw E(400, 'variant_max', `You can choose up to ${+g.max} for ${g.n}.`);
      }
      for (const g of groups) if (g.req && !used[g.id]) throw E(400, 'variant_required', `Please choose an option for ${g.n} (${p.n}).`);
      /* Gift box: the customer fills it with exactly bx.n pieces from the products the owner allowed. The box has its own fixed price;
         the pieces inside are checked for availability and stock like normal items, and listed on the order. */
      let bx = null;
      if (p.bx) {
        const L = Array.isArray(r.b) ? r.b.map(String) : [], allowed = new Set(p.bx.ids.map(String)), cnt = {};
        if (L.length !== p.bx.n) throw E(400, 'box', `Please fill the ${p.n} with ${p.bx.n} pieces.`);
        for (const id of L) { if (!allowed.has(id) || id === String(p.id)) throw E(400, 'box', 'An item in your box is no longer available. Please refresh the page.'); cnt[id] = (cnt[id] || 0) + 1; }
        bx = [];
        for (const [id, k] of Object.entries(cnt)) {
          const c = await product(id); if (!c || c.bx) throw E(400, 'box', 'An item in your box is no longer available. Please refresh the page.');
          if (c.sot) throw E(400, 'stock', `${c.n} is sold out today. Please take it out of your box.`);
          need[c.id] = (need[c.id] || 0) + k * q; if (c.stock !== null && need[c.id] > Math.max(0, c.stock)) throw E(400, 'stock', `${c.n} is out of stock or has fewer left than your box needs.`);
          bx.push({ id: c.id, n: c.n, e: c.e, q: k });
        }
        bx.sort((a, b) => a.n.localeCompare(b.n)); names.push('Box: ' + bx.map(x => x.q + '× ' + x.n).join(', '));
      }
      out.push({ id: p.id, n: p.n, e: p.e, t: names, q, u: p.price + extra, w: p.kg, ...(p.ob ? { ob: p.ob + extra } : {}), ...(bx ? { bx } : {}) });
    }
    return out;
  }
  async function couponCheck(code, sub, ctx = {}) {
    code = String(code || '').toUpperCase(); if (!/^[A-Z0-9]{1,16}$/.test(code)) return { err: 'Sorry, that code is not valid.' };
    let d = await getDoc('coupons', code); if (!d) return { err: 'Sorry, that code is not valid.' };
    if (d.aff) { const ar = await store.getJSON('sec/affu/' + d.aff); if (ar) d = { ...d, v: sacOf(ar, await affCfg()).disc }; } /* the affiliate's discount follows their live sacrifice (it may have ended) */
    if (d.exp && Date.now() > d.exp) return { err: 'This coupon has expired.' };
    if (d.pl) { const L = (await cfgDoc('pl', DEF.pl)).launch; if (L && Date.now() < L) return { err: 'This reward can be used once the shop launches.' }; if (Date.now() > (L || d.at) + (d.dd || 7) * 864e5) return { err: 'This coupon has expired.' }; }
    const used = ((await store.getJSON('meta/rc/' + code)) || { n: 0 }).n; if (d.max && used >= d.max) return { err: 'This coupon has been fully redeemed.' };
    if (d.min > 0 && sub < d.min) return { err: 'Minimum purchase Rp ' + Number(d.min).toLocaleString('id-ID') + ' for this coupon.' };
    if (d.bb) {
      if (!d.pl) { const st = await stageOf(d.bb); if (st < 0) return { err: 'This reward is no longer valid because its order was cancelled.' }; if (st < 1) return { err: `This reward unlocks once your payment for order #${d.bb} is confirmed.` }; }
      if (ctx.phone !== undefined && d.lock && nwa(ctx.phone) !== d.lock) return { err: 'This reward belongs to another WhatsApp number.' };
      if (d.box > 0 && ctx.items && !ctx.items.some(i => i.bx && boxPcs(i) >= d.box)) return { err: `To use this reward, buy a box of ${d.box} or more.` };
      if (d.type === 'item' && ctx.items && !ctx.items.some(i => String(i.id) === String(d.pid))) return { err: `Add ${d.n || 'your reward item'} to your cart to use this reward.` };
    }
    return { d, code, used };
  }
  const rcAdd = async (code, n) => { const k = 'meta/rc/' + code, r = (await store.getJSON(k)) || { n: 0 }; r.n = Math.max(0, r.n + n); await store.setJSON(k, r); };
  async function releaseCoupon(no) { const r = await getDoc('redeem', no); if (r) { await delDoc('redeem', no); if (r.code) await rcAdd(r.code, -1); for (const c0 of r.rw || []) await rcAdd(c0, -1); } }

  /* slots */
  const winsOf = (cfg, mode) => String(mode === 'Delivery' ? cfg.slots.dl : cfg.slots.pu).split('\n').map(x => x.trim().replace(/\s/g, '')).filter(x => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(x));
  const sdWins = cfg => String(cfg.methods.sdw || cfg.slots.dl).split('\n').map(x => x.trim().replace(/\s/g, '')).filter(x => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(x));
  function checkSlot(cfg, mode, slot, sd, keepDay) {
    if (sd) {
      if (!isObj(slot) || !/^\d{4}-\d{2}-\d{2}$/.test(slot.d || '') || !sdWins(cfg).includes(slot.w)) throw E(400, 'bad_slot', 'Please choose a valid same-day time slot.');
      const now = Date.now(), loc = new Date(now + tzH() * 3600e3), mins = loc.getUTCHours() * 60 + loc.getUTCMinutes(), [ch, cm] = String(cfg.methods.cut || '14:00').split(':').map(Number), cut = ch * 60 + cm, today = dayOf(now), tomorrow = dayOf(now + 864e5);
      const ok = [...(mins < cut + 15 ? [today] : []), ...(mins >= cut - 15 ? [tomorrow] : [])];
      if (!ok.includes(slot.d)) throw E(400, 'bad_slot', 'Same-day delivery is for today only (or tomorrow after the cut-off time). Please choose the time again.');
      return { d: slot.d, w: slot.w };
    }
    if (!isObj(slot) || !/^\d{4}-\d{2}-\d{2}$/.test(slot.d || '') || !winsOf(cfg, mode).includes(slot.w)) throw E(400, 'bad_slot', 'Please choose a valid time slot.');
    if (mode === 'Delivery' && cfg.methods.sd && slot.d < dayOf(Date.now() + 864e5) && !keepDay) throw E(400, 'bad_slot', 'Delivery for today is same-day delivery. Please choose tomorrow or later, or choose Same-day.');
    const t = Date.parse(slot.d + 'T00:00:00Z'), today = Math.floor(Date.now() / 864e5) * 864e5, days = Math.max(1, Math.min(14, +cfg.slots.days || 5));
    if (!(t >= today - 864e5 && t <= today + (days + 1) * 864e5)) throw E(400, 'bad_slot', 'That date is not available.');
    return { d: slot.d, w: slot.w };
  }
  const okImg = s => typeof s === 'string' && s.length <= 260000 && /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s);

  /* ---------- customer endpoints ---------- */
  async function ownOrder(c, no) {
    if (!/^D[0-9A-F]{10}$/.test(String(no))) throw E(404, 'not_found', 'Order not found');
    const o = await getDoc('orders', no); if (!o || o.uid !== c.vid) throw E(404, 'not_found', 'Order not found'); return o;
  }
  /* ---------- couriers: partner rates (Biteship) and the store's own courier ---------- */
  /* Biteship API key: the one the owner saved in Shop settings (kept under sec/, never readable through /api/db), else the BITESHIP_API_KEY environment variable */
  const bsKey = async () => String(((await store.getJSON('sec/biteship')) || {}).key || process.env.BITESHIP_API_KEY || '').trim();
  const F = opt.fetch || ((...a) => globalThis.fetch(...a));
  /* which couriers a free delivery event covers: none ticked = every courier; st store courier, sd same-day, in instant (motorbike), car instant car */
  const FD_CS = ['st', 'sd', 'in', 'car'], crCar = o => /\b(car|mobil|van|truck|pick-?up|blind-?van|sedan)\b/i.test(String((o && o.n) || '') + ' ' + String((o && o.s) || ''));
  const fdFits = (fdev, o) => { const cs = Array.isArray(fdev && fdev.cs) ? fdev.cs : []; if (!cs.length) return true; if (!o || o.k === 'st') return cs.includes('st'); if (o.ty === 's') return cs.includes('sd'); if (o.ty === 'i') return cs.includes(crCar(o) ? 'car' : 'in'); return false; };
  const fdOf = cfg => fdLive(cfg.fdev) ? { full: cfg.fdev.full !== false, amt: Math.max(0, +cfg.fdev.amt || 0), min: Math.max(0, +cfg.fdev.min || 0), mb: cfg.fdev.mb === 'after' ? 'after' : 'before' } : null;
  const okLL = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0);
  const cartKey = L => crypto.createHash('sha256').update(JSON.stringify((Array.isArray(L) ? L : []).map(r => [String(isObj(r) ? r.id : ''), Math.floor(+(isObj(r) ? r.q : 0)), Array.isArray(r && r.b) ? r.b.map(String) : []]))).digest('base64url').slice(0, 22);
  async function bsRates(C, la, ln, items, sd, pc, allOpts) {
    const key = await bsKey(); if (!key) throw new Error('no key');
    const body = JSON.stringify({ origin_latitude: +C.lat, origin_longitude: +C.lng, destination_latitude: la, destination_longitude: ln, ...(C.pc ? { origin_postal_code: +C.pc || C.pc } : {}), ...(pc ? { destination_postal_code: +pc } : {}),
      couriers: String(C.list || DEF.courier.list), items: items.map(i => ({ name: i.n.slice(0, 50), value: Math.round(i.u), weight: Math.max(1, Math.round(i.w * 1000)), quantity: i.q })) });
    let r; for (const auth of [/^bearer /i.test(key) ? key : 'Bearer ' + key, key.replace(/^bearer /i, '')]) {
      r = await F(BS_URL, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(9000) });
      if (r.status !== 401) break;
    }
    const j = await r.json().catch(() => ({})); if (!r.ok || !j || j.success === false || !Array.isArray(j.pricing)) throw new Error(String((j && j.error) || 'rates failed ' + r.status));
    const isS = p => /same[_ -]?day/i.test(String(p.service_type || p.type || p.courier_service_code || p.courier_service_name || '')),
      isI = p => isS(p) || /instant/i.test(String(p.service_type || p.type || p.courier_service_code || '')),
      all = j.pricing.filter(p => isObj(p) && +p.price > 0 && (!sd || isI(p))).slice(0, 300).map(p => {
        const cc = str(p.courier_code || p.company, 20).toLowerCase().replace(/[^a-z0-9_-]/g, ''), sc = str(p.courier_service_code || p.type, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return { id: `bs_${cc}_${sc}`.slice(0, 60), k: 'bs', c: cc, s: sc, ty: isS(p) ? 's' : isI(p) ? 'i' : 'r', n: (str(p.courier_name, 30) + ' ' + str(p.courier_service_name, 40)).trim(), d: str(p.duration || [p.shipment_duration_range, p.shipment_duration_unit].filter(Boolean).join(' '), 40), raw: Math.round(+p.price) };
      }).filter((x, i, A) => A.findIndex(y => y.id === x.id) === i).sort((a, b) => a.raw - b.raw);
    if (allOpts) return all;
    /* every courier gets its cheapest services (a long list of regular services must not push instant couriers like GoSend / Grab out) */
    const per = {}; return all.filter(x => (per[x.c] = (per[x.c] || 0) + 1) <= 3).slice(0, 30);
  }
  /* Price checks cost money per call: the answer for the same area, weight and couriers is kept for ttl minutes (default 30) and shared by all customers. */
  async function bsCached(C, la, ln, items, sd, pc) {
    const ttl = Math.max(0, +C.ttl) * 60e3 || 0, kg = items.reduce((t, i) => t + i.w * i.q, 0),
      key = 'cache/rates/' + crypto.createHash('sha256').update(JSON.stringify([sd ? 1 : 0, la.toFixed(3), ln.toFixed(3), Math.ceil(kg * 2) / 2, C.list, +C.lat, +C.lng])).digest('hex').slice(0, 32);
    if (ttl) { const h = await store.getJSON(key); if (h && Date.now() - h.t < ttl && Array.isArray(h.list)) return h.list; }
    const L = await bsRates(C, la, ln, items, sd, pc); if (ttl && L.length) await store.setJSON(key, { t: Date.now(), list: L }); return L;
  }
  /* courier choices for an address pin: each with its price before and after the shop's shipping rules and the free delivery event. Signed so the order can't change a price. */
  async function apiRates(c) {
    await rlCount(`rates:${c.ip}`, 120, 'Too many requests. Please wait a few minutes and try again.');
    const b = await bodyOf(c.req); let tsBad = false; try { await tsCheck(c, b, 'rates'); } catch (e) { if (e.code !== 'turnstile') throw e; tsBad = true; } /* no security check: the paid partner price lookup is skipped, but the store courier is still offered */
    const cfg = await cfgAll(), C = cfg.courier, la = +b.lat, ln = +b.lng, sd = b.sd === true, pc = /^\d{5}$/.test(String(b.pc || '')) ? String(b.pc) : '';
    if (!okLL(la, ln)) throw E(400, 'bad_loc', 'Please set your location on the map first.');
    const out = outOf(C, la, ln); if (out) throw E(400, 'radius', `Sorry, this address is ${out.km} km from us. We deliver up to ${out.max} km.`);
    const items = await buildItems(b.items), tier = c.b2b ? 'b2b' : 'regular', fd = fdOf(cfg), its = items.map(i => ({ u: i.u, q: i.q, w: i.w, ob: i.ob }));
    let L = [], fail = false;
    if (C.bs && okLL(+C.lat, +C.lng) && !tsBad) { try { L = await bsCached(C, la, ln, items, sd, pc); } catch (e) { fail = true; console.error('biteship', e.message); } }
    const opts = L.map(o => { const k = calc(its, { mode: 'Delivery', sd, tier, cr: o, fd: fd && fdFits(cfg.fdev, o) ? fd : null }, cfg); return { ...o, sh: k.sh, fd: k.fd, rd: k.rd }; }), stTop = !!fd && (cfg.fdev.cs || []).includes('st');
    /* a free delivery event on the store courier keeps the store courier on the list, at the top */
    if (C.store !== 'fail' || !opts.length || stTop) { const dd = stDist(C, la, ln), k = calc(its, { mode: 'Delivery', sd, tier, cr: dd ? { raw: dd.raw } : null, fd: fd && fdFits(cfg.fdev, null) ? fd : null }, cfg), st = { id: 'store', k: 'st', n: str(C.sn, 40) || 'Store courier', d: dd ? dd.km + ' km' : '', ...(dd ? { ty: 'd', km: dd.km } : {}), raw: k.raw, sh: k.sh, fd: k.fd, rd: k.rd }; if (stTop) opts.unshift(st); else opts.push(st); }
    const tok = signTok({ k: 'rt', la, ln, pc, sd, h: cartKey(b.items), o: opts.map(o => [o.id, o.k, o.n, o.raw, o.c || '', o.s || '', o.ty || '']) }, 2 * 3600);
    return { opts, tok, fail: fail || (C.bs && !opts.some(o => o.k === 'bs')), ...(tsBad ? { ts: true } : {}) };
  }
  /* address search for the map (OpenStreetMap Nominatim), through the server so the page only talks to this site */
  const GEOC = new Map();
  async function apiGeo(c) {
    await rlCount(`geo:${c.ip}`, 90, 'Too many searches. Please wait a few minutes.');
    const sp = c.url.searchParams, q = str(sp.get('q'), 120), la = +sp.get('lat'), ln = +sp.get('lng');
    let u; if (q) u = `${GEO_URL}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=id&q=${encodeURIComponent(q)}`;
    else if (okLL(la, ln)) u = `${GEO_URL}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${la.toFixed(6)}&lon=${ln.toFixed(6)}`;
    else throw E(400, 'bad_q', 'Type an address to search.');
    if (GEOC.has(u)) return GEOC.get(u);
    let j; try { const r = await F(u, { headers: { 'user-agent': 'FolkloreBrowniesShop/1.0 (online ordering)', 'accept-language': 'id,en' }, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw 0; j = await r.json(); }
    catch { throw E(502, 'geo_down', 'The map search is not answering right now. Please pick your place on the map instead.'); }
    const one = x => ({ n: str(x.display_name, 200), lat: +x.lat, lng: +x.lon, pc: /^\d{5}$/.test(String((x.address || {}).postcode || '')) ? String(x.address.postcode) : '' });
    const out = { r: (Array.isArray(j) ? j : j && j.lat ? [j] : []).map(one).filter(x => okLL(x.lat, x.lng)) };
    if (GEOC.size > 300) GEOC.clear(); GEOC.set(u, out); return out;
  }
  /* owner: Biteship API key and webhook link (Shop settings → Couriers) */
  async function apiCourier(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    const sec = (await store.getJSON('sec/biteship')) || {}, b = c.req.method === 'POST' ? await bodyOf(c.req) : {};
    if (b.op === 'key') {
      const k = String(b.key || '').trim();
      if (k && (k.length < 20 || k.length > 600 || /\s/.test(k))) throw E(400, 'bad_key', 'That does not look like a Biteship API key. Copy it again from the Biteship dashboard (it starts with biteship_live or biteship_test).');
      if (k) sec.key = k; else delete sec.key; sec.kat = Date.now(); await store.setJSON('sec/biteship', sec);
      await slog('set.cfg', 'Couriers', k ? 'Biteship API key saved (…' + k.slice(-4) + ')' : 'Biteship API key removed', c.staff.u);
    }
    if (b.op === 'test') { // what does Biteship return for a short trip from the shop? (couriers asked for vs. couriers answering)
      const cfg = await cfgAll(), C = cfg.courier;
      if (!(await bsKey())) return { err: 'No API key saved yet.' }; if (!okLL(+C.lat, +C.lng)) return { err: 'Set the shop pickup point on the map first (and save).' };
      try { const L = await bsRates(C, +C.lat + .018, +C.lng + .018, [{ n: 'Test cookies', u: 50000, w: .5, q: 1 }], false, '', true), asked = String(C.list || '').split(',').filter(Boolean), got = [...new Set(L.map(x => x.c))];
        return { ok: true, n: L.length, asked, got, missing: asked.filter(x => !got.includes(x)), list: L.slice(0, 60).map(x => ({ c: x.c, n: x.n, ty: x.ty, raw: x.raw })) };
      } catch (e) { return { err: String(e.message || e).slice(0, 200) }; }
    }
    if (b.op === 'hook' || !sec.hook) { sec.hook = rid(16); await store.setJSON('sec/biteship', sec); if (b.op === 'hook') await slog('set.cfg', 'Couriers', 'New Biteship webhook link made (the old link stops working)', c.staff.u); }
    const env = String(process.env.BITESHIP_API_KEY || '').trim(), last = (await store.getJSON('meta/bshook')) || null;
    return { key: !!(sec.key || env), src: sec.key ? 'saved' : env ? 'env' : '', end: sec.key ? sec.key.slice(-4) : env ? env.slice(-4) : '', kat: sec.kat || 0, hook: '/api/bshook?t=' + sec.hook, last };
  }
  /* Biteship webhook: shipment updates. Matched to our order by the Biteship order id (pickup requested from here) or the airway bill (AWB)
     number staff entered at "Out for delivery". Biteship's install test (empty body) just gets 200. */
  async function apiBsHook(c) {
    if (c.req.method !== 'POST') return { ok: true };
    await rlCount(`bshook:${c.ip}`, 600, 'Too many requests.');
    const sec = (await store.getJSON('sec/biteship')) || {}; if (!sec.hook || !safeEq(String(c.url.searchParams.get('t') || ''), sec.hook)) throw E(403, 'forbidden', 'Invalid webhook link.');
    const t = await c.req.text(); let j = {}; try { j = JSON.parse(t || '{}'); } catch { j = {}; } if (!isObj(j)) j = {};
    const ev = str(j.event, 40), st = str(j.status, 40).toLowerCase(), awb = str(j.courier_waybill_id, 60), oid = str(j.order_id, 60), at = Date.now();
    let no = '';
    const all = await listCol('status'), hit = (oid && all.find(d => d.data && d.data.pk && d.data.pk.id === oid)) || (awb && all.find(d => d.data && d.data.awb && String(d.data.awb).trim().toLowerCase() === awb.toLowerCase())); // Biteship order id first, then the airway bill
    if (hit) { no = hit.id; await pkApply(no, hit.data, { st, awb, drv: j.courier_driver_name, ph: j.courier_driver_phone, plate: j.courier_driver_plate_number, link: j.courier_link }, 'webhook'); }
    await store.setJSON('meta/bshook', { at, ev: ev || (t ? 'unknown' : 'test'), st, awb, no });
    return { ok: true };
  }
  /* ---------- request pickup (Biteship orders API) ----------
     pk on the order status: st = finding (looking for a driver) | allocated (driver found) | picking_up | picked | retry (driver cancelled or none found:
     asks again after 1 minute, up to 3 times) | failed | cutoff (still no driver at the cut-off time) | cancelled (by staff) | a courier problem state.
     pk.al = a red alert for staff (failed / cancelled / cut-off / problem). */
  const PK_LIVE = ['finding', 'allocated', 'picking_up', 'retry'], PK_RETRIES = 3;
  async function bsApi(method, p, body) {
    const key = await bsKey(); if (!key) throw E(400, 'no_key', 'Add your Biteship API key in Shop settings → Couriers first.');
    let r; for (const auth of [/^bearer /i.test(key) ? key : 'Bearer ' + key, key.replace(/^bearer /i, '')]) {
      r = await F(BS_API + p, { method, headers: { authorization: auth, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      if (r.status !== 401) break;
    }
    const j = await r.json().catch(() => ({})); return { ok: r.ok && j && j.success !== false, status: r.status, j: j || {} };
  }
  const cutPast = cfg => { const P = cfg.courier.pkc || {}; if (P.on === false) return false; const loc = new Date(Date.now() + tzH() * 3600e3), [h, m] = String(P.t || '19:00').split(':').map(Number); return loc.getUTCHours() * 60 + loc.getUTCMinutes() >= h * 60 + (m || 0); };
  const pkAlert = (pk, why) => ({ ...pk, al: { at: Date.now(), why } });
  async function pkCreate(no, by, n) {
    const cfg = await cfgAll(), C = cfg.courier, o = await getDoc('orders', no), st = (await getDoc('status', no)) || { s: 0 };
    const cc = (o.cour.c || o.cour.id.slice(3).split('_')[0]), ct = (o.cour.s || o.cour.id.slice(4 + cc.length));
    const items = []; for (const i of o.items || []) { const p = await product(i.id); items.push({ name: str(i.n, 50), value: Math.round(+i.u || 0), quantity: +i.q || 1, weight: Math.max(1, Math.round(((p && p.kg) || .4) * 1000)), length: 10, width: 10, height: 10 }); }
    const body = { shipper_contact_name: C.on, shipper_contact_phone: C.op, shipper_organization: C.on, origin_contact_name: C.on, origin_contact_phone: C.op, origin_address: C.oa, origin_note: C.onote || '',
      origin_coordinate: { latitude: +C.lat, longitude: +C.lng }, ...(C.pc ? { origin_postal_code: +C.pc } : {}),
      destination_contact_name: o.name, destination_contact_phone: o.phone, destination_contact_email: o.email, destination_address: o.addr, destination_note: 'Order #' + no,
      destination_coordinate: { latitude: +o.lat, longitude: +o.lng }, ...(o.pc ? { destination_postal_code: +o.pc } : {}),
      courier_company: cc, courier_type: ct, delivery_type: 'now', order_note: 'Folklore Brownies order #' + no, reference_id: `${no}-${n}`, items };
    let pk;
    try {
      const r = await bsApi('POST', '/orders', body);
      if (!r.ok || !r.j.id) pk = pkAlert({ st: 'failed', at: Date.now(), n, by }, 'Pickup request refused by Biteship: ' + str(r.j.error || r.j.message || 'error ' + r.status, 160));
      else { const cr = isObj(r.j.courier) ? r.j.courier : {}; pk = { id: str(r.j.id, 60), st: 'finding', at: Date.now(), n, by, awb: str(cr.waybill_id, 60), price: +r.j.price || 0 }; }
    } catch (e) { pk = pkAlert({ st: 'failed', at: Date.now(), n, by }, e instanceof HttpError ? e.message : 'Biteship did not answer. Please try again.'); }
    await putDoc('status', no, { ...st, pk });
    await slog('order.pickup', `Order #${no} · ${o.name}`, pk.st === 'finding' ? `Pickup requested (${o.cour.n})${n > 1 ? ' – try ' + n : ''} · finding a driver` : 'Pickup request failed – ' + pk.al.why, by);
    return pk;
  }
  async function bsCancel(id) { if (!id) return; try { const r = await bsApi('POST', `/orders/${encodeURIComponent(id)}/cancel`, { cancellation_reason_code: 'others', cancellation_reason: 'Cancelled by the shop' }); if (!r.ok && (r.status === 404 || r.status === 405)) await bsApi('DELETE', `/orders/${encodeURIComponent(id)}`); } catch (e) { console.error('biteship cancel', e.message); } }
  /* one shipment update (from the webhook or from checking Biteship) */
  async function pkApply(no, x, u, src) {
    const at = Date.now(), st = String(u.st || '').toLowerCase(), pk = x.pk ? { ...x.pk } : null, nd = { ...x }, o = await getDoc('orders', no), who = `Order #${no} · ${o ? o.name : ''}`;
    const link = u.link && /^https:\/\//.test(String(u.link)) ? str(u.link, 300) : '';
    nd.trk = { st, at, ...(link ? { link } : {}), ...(u.drv ? { drv: str(u.drv, 60) } : {}), ...(u.ph ? { ph: str(u.ph, 20) } : {}), ...(u.plate ? { plate: str(u.plate, 20) } : {}) };
    if (pk) { if (u.awb) pk.awb = str(u.awb, 60); if (u.drv) pk.drv = str(u.drv, 60); if (u.ph) pk.ph = str(u.ph, 20); if (u.plate) pk.plate = str(u.plate, 20); if (link) pk.link = link; }
    const toOut = () => { if (nd.s === 1 || nd.s === 2) { nd.s = 3; nd.t = at; nd.by = 'courier'; nd.note = 'Picked up by the driver'; nd.awb = (pk && pk.awb) || nd.awb || (pk && pk.id) || ''; nd.courier = o && o.cour ? o.cour.n : nd.courier || ''; return true; } };
    let msg = '';
    if (pk && !['cancelled', 'cutoff', 'failed'].includes(pk.st) || !pk) {
      if (st === 'confirmed' && pk) pk.st = 'finding';
      else if (st === 'allocated' && pk) { pk.st = 'allocated'; msg = 'Driver found' + (pk.drv ? ': ' + pk.drv : ''); }
      else if (st === 'picking_up' && pk) pk.st = 'picking_up';
      else if (['picked', 'dropping_off', 'on_the_way', 'in_transit'].includes(st)) { if (pk) pk.st = 'picked'; if (toOut()) msg = 'Picked up by the driver → Out for delivery'; }
      else if (st === 'delivered') { if (pk) pk.st = 'delivered'; toOut(); if (nd.s === 3) { nd.s = 4; nd.t = at; nd.note = 'Delivered (courier update)'; nd.by = 'courier'; msg = 'Delivered – reported by the courier (Biteship)'; } }
      else if (['cancelled', 'courier_not_found', 'rejected'].includes(st) && pk && PK_LIVE.includes(pk.st)) {
        const why = st === 'courier_not_found' ? 'No driver found' : st === 'rejected' ? 'The courier rejected the pickup' : 'The driver cancelled';
        const cfg = await cfgAll();
        if ((pk.n || 1) < PK_RETRIES && !cutPast(cfg)) { Object.assign(pk, pkAlert(pk, why + ' – finding a new driver in 1 minute'), { st: 'retry', ra: at + 60e3 }); msg = why + ' – will ask again in 1 minute'; }
        else { Object.assign(pk, pkAlert(pk, why + ((pk.n || 1) >= PK_RETRIES ? ` (tried ${pk.n} times)` : ' (after the cut-off time)') + ' – please request again'), { st: 'failed' }); msg = why + ' – pickup failed'; }
      }
      else if (['returned', 'return_in_transit', 'on_hold', 'disposed'].includes(st) && pk) { Object.assign(pk, pkAlert(pk, 'Courier problem: ' + st.replace(/_/g, ' ')), { st }); msg = 'Courier problem: ' + st; }
    }
    if (pk && ['finding', 'allocated', 'picking_up', 'picked', 'delivered'].includes(pk.st)) { delete pk.al; delete pk.ra; } // good news clears an old red alert
    if (pk) nd.pk = pk;
    await putDoc('status', no, nd); if (msg) await slog('order.pickup', who, msg, src === 'webhook' ? 'courier' : 'system');
  }
  /* staff: request or cancel a pickup */
  async function apiPickup(c) {
    if (!c.can('s')) throw E(403, 'forbidden', 'You do not have access to do that.');
    const b = await bodyOf(c.req), no = String(b.no || ''), o = /^D[0-9A-F]{10}$/.test(no) ? await getDoc('orders', no) : null; if (!o) throw E(404, 'not_found', 'Order not found.');
    const st = (await getDoc('status', no)) || { s: 0 }, pk = st.pk || null, cfg = await cfgAll(), C = cfg.courier;
    if (b.act === 'cancel') {
      if (!pk || !PK_LIVE.includes(pk.st)) throw E(409, 'nothing', 'There is no pickup request to cancel.');
      await bsCancel(pk.id); const { al, ...rest } = pk; await putDoc('status', no, { ...st, pk: { ...rest, st: 'cancelled', end: Date.now(), cby: c.staff.u } });
      await slog('order.pickup', `Order #${no} · ${o.name}`, 'Pickup request cancelled', c.staff.u); return { ok: true };
    }
    if (b.act === 'ack') { if (pk && pk.al) { const { al, ...rest } = pk; await putDoc('status', no, { ...st, pk: rest }); } return { ok: true }; }
    if (b.act !== 'request') throw E(400, 'bad_act', 'Unknown action.');
    if (o.mode !== 'Delivery' || !o.cour || o.cour.k !== 'bs') throw E(400, 'no_partner', 'This order does not use a partner courier.');
    if (st.s !== 1 && st.s !== 2) throw E(409, 'stage', 'Request a pickup after the payment is confirmed and before the order is out for delivery.');
    if (pk && ['finding', 'allocated', 'picking_up'].includes(pk.st)) throw E(409, 'busy', 'A pickup is already requested for this order.');
    if (!C.on || !C.op || !C.oa || !okLL(+C.lat, +C.lng)) throw E(400, 'no_origin', 'Add the pickup contact (name, phone, address and map point) in Shop settings → Couriers first.');
    if (!okLL(+o.lat, +o.lng)) throw E(400, 'no_dest', 'This order has no map location.');
    if (cutPast(cfg)) throw E(409, 'cutoff', `Pickup requests close at ${(C.pkc || {}).t || '19:00'}. Please request again tomorrow.`);
    const n = pk && pk.st === 'retry' ? (pk.n || 1) + 1 : 1; if (pk && pk.st === 'retry' && pk.id) await bsCancel(pk.id);
    const r = await pkCreate(no, c.staff.u, n); if (r.st === 'failed') throw E(502, 'pickup_failed', r.al.why); return { ok: true, pk: r };
  }
  /* every ~20 s (driven by the page polling): ask again after a driver cancelled, cancel requests still without a driver at the cut-off,
     and check Biteship directly for live requests that had no update for a while (in case a webhook was missed) */
  let lastPk = 0;
  async function pkSweep() {
    const every = opt.pkEvery ?? 20000; if (Date.now() - lastPk < every) return; lastPk = Date.now();
    const docs = (await listCol('status')).filter(d => d.data && d.data.pk && PK_LIVE.includes(d.data.pk.st)); if (!docs.length) return;
    const last = await store.getJSON('meta/pksweep'); if (last && Date.now() - last.t < every) return; await store.setJSON('meta/pksweep', { t: Date.now() });
    const cfg = await cfgAll(), late = cutPast(cfg);
    for (const { id: no, data: x } of docs) {
      const pk = x.pk;
      if (late && (pk.st === 'finding' || pk.st === 'retry')) { await bsCancel(pk.id); await putDoc('status', no, { ...x, pk: { ...pkAlert(pk, `No driver found before the cut-off time (${(cfg.courier.pkc || {}).t || '19:00'}) – request cancelled`), st: 'cutoff', end: Date.now() } }); await slog('order.pickup', `Order #${no}`, 'Pickup request cancelled at the cut-off time (no driver found)', 'system'); continue; }
      if (pk.st === 'retry') { if (pk.ra <= Date.now()) await pkCreate(no, 'system', (pk.n || 1) + 1); continue; }
      if (pk.id && Date.now() - (pk.chk || pk.at) > 90e3) {
        try { const r = await bsApi('GET', `/orders/${encodeURIComponent(pk.id)}`); const cur = (await getDoc('status', no)) || x; const cp = { ...cur, pk: { ...cur.pk, chk: Date.now() } };
          if (r.ok && r.j.status && String(r.j.status).toLowerCase() !== String((cur.trk || {}).st || '')) { const cr = isObj(r.j.courier) ? r.j.courier : {}; await pkApply(no, cp, { st: r.j.status, awb: cr.waybill_id, drv: cr.name || cr.driver_name, ph: cr.phone || cr.driver_phone, plate: cr.driver_plate_number, link: cr.link }, 'check'); }
          else await putDoc('status', no, cp);
        } catch (e) { console.error('biteship check', e.message); }
      }
    }
  }
  /* delivery radius: distance from the shop pickup point */
  const distKm = (a, b, c2, d) => { const R = 6371, r = x => x * Math.PI / 180, dl = r(c2 - a), dn = r(d - b), h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c2)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  /* store courier price by distance: starter price (covers the first skm km) + spk Rp for every further km (rounded up) */
  const stDist = (C, la, ln) => { if (!(C.dd === true) || !okLL(+C.lat, +C.lng) || !okLL(la, ln)) return null; const km = distKm(+C.lat, +C.lng, la, ln), x = Math.max(0, Math.ceil(km - (+C.skm || 0) - 1e-9)); return { km: Math.round(km * 10) / 10, raw: Math.max(0, Math.round((+C.sp || 0) + x * (+C.spk || 0))) }; };
  const outOf = (C, la, ln) => { const mx = +C.rad || 0; if (!(mx > 0) || !okLL(+C.lat, +C.lng)) return null; const km = distKm(+C.lat, +C.lng, la, ln); return km > mx ? { km: Math.round(km * 10) / 10, max: mx } : null; };
  /* a Delivery order is refused when the address is outside the delivery radius (or has no location while a radius is set), whichever courier is chosen */
  async function radiusGate(b, cfg) {
    const C = cfg.courier; if (!(+C.rad > 0) || !okLL(+C.lat, +C.lng)) return; const la = +b.lat, ln = +b.lng;
    if (!okLL(la, ln)) throw E(400, 'bad_loc', 'Please set your delivery location on the map first.');
    const out = outOf(C, la, ln); if (out) throw E(400, 'radius', `Sorry, this address is ${out.km} km from us. We deliver up to ${out.max} km.`);
  }
  async function apiRadius(c) {
    await rlCount(`rad:${c.ip}`, 200, 'Too many requests. Please wait a few minutes and try again.');
    const b = await bodyOf(c.req), la = +b.lat, ln = +b.lng; if (!okLL(la, ln)) throw E(400, 'bad_loc', 'Please set your location on the map first.');
    const o = outOf((await cfgAll()).courier, la, ln); return o ? { out: true, ...o } : { out: false };
  }
  /* ---------- Cloudflare Turnstile (spam / bot check): the owner pastes the site key and the secret key in Shop settings ---------- */
  const tsSecret = async () => String(((await store.getJSON('sec/turnstile')) || {}).secret || process.env.TURNSTILE_SECRET || '').trim();
  async function tsVerify(secret, token, ip) {
    const r = await F('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: String(token || '').slice(0, 2100), remoteip: ip || '' }), signal: AbortSignal.timeout(6000) });
    const j = await r.json().catch(() => ({})); return { ok: j.success === true, codes: Array.isArray(j['error-codes']) ? j['error-codes'] : [] };
  }
  /* what: place | proof | rates | login. Does nothing when Turnstile is off or not set up for that step. A broken setup (wrong secret, Cloudflare unreachable) never blocks customers. */
  async function tsCheck(c, b, what) {
    const cf = (await getDoc('config', 'turnstile')) || {}; if (!cf.on || !cf[what]) return;
    const secret = await tsSecret(); if (!secret || !cf.sk) return;
    const token = String(b.ts || ''); if (!token) throw E(400, 'turnstile', 'Please complete the quick security check and try again.');
    let r; try { r = await tsVerify(secret, token, c.ip); } catch (e) { console.error('turnstile', e.message); return; }
    if (r.ok) return; if (r.codes.some(x => /invalid-input-secret|missing-input-secret|bad-request|internal-error/.test(x))) { console.error('turnstile setup problem', r.codes.join()); return; }
    throw E(400, 'turnstile', 'The security check did not pass. Please try again.');
  }
  async function apiTurnstile(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    const sec = (await store.getJSON('sec/turnstile')) || {}, b = c.req.method === 'POST' ? await bodyOf(c.req) : {};
    if (b.op === 'key') { const k = String(b.key || '').trim(); if (k && (k.length < 20 || k.length > 200 || /\s/.test(k))) throw E(400, 'bad_key', 'That does not look like a Turnstile secret key. Copy it again from the Cloudflare dashboard.'); if (k) sec.secret = k; else delete sec.secret; sec.kat = Date.now(); await store.setJSON('sec/turnstile', sec); await slog('set.cfg', 'Turnstile', k ? 'Secret key saved (…' + k.slice(-4) + ')' : 'Secret key removed', c.staff.u); }
    if (b.op === 'test') { const secret = await tsSecret(); if (!secret) return { err: 'No secret key saved yet.' }; try { const r = await tsVerify(secret, b.ts, c.ip); return r.ok ? { ok: true } : { err: 'Cloudflare said no: ' + (r.codes.join(', ') || 'check failed') + (r.codes.some(x => /secret/.test(x)) ? ' – the secret key is wrong.' : '') }; } catch (e) { return { err: 'Could not reach Cloudflare.' }; } }
    const env = String(process.env.TURNSTILE_SECRET || '').trim(), k = sec.secret || env; return { key: !!k, src: sec.secret ? 'saved' : env ? 'env' : '', end: k ? k.slice(-4) : '', kat: sec.kat || 0 };
  }
  /* the courier chosen at checkout, checked against the signed price list */
  async function courierOf(b, cfg, sd) {
    const C = cfg.courier, need = !!C.bs && !!(await bsKey());
    if (!isObj(b.cour)) { if (need) throw E(400, 'courier', 'Please choose a courier.'); return null; }
    const t = verTok(b.cour.tok); if (!t || t.k !== 'rt') throw E(400, 'courier', 'The courier prices have expired. Please choose the courier again.');
    if (t.h !== cartKey(b.items) || t.sd !== sd) throw E(400, 'courier', 'Your order changed. Please choose the courier again.');
    const o = t.o.find(x => x[0] === b.cour.id); if (!o) throw E(400, 'courier', 'Please choose a courier.');
    const out = outOf(C, t.la, t.ln); if (out) throw E(400, 'radius', `Sorry, this address is ${out.km} km from us. We deliver up to ${out.max} km.`);
    return { id: o[0], k: o[1], n: o[2], raw: o[3], c: o[4] || '', s: o[5] || '', ty: o[6] || '', lat: t.la, lng: t.ln, pc: t.pc || '' };
  }
  async function apiOrder(c) {
    { const pl = await cfgDoc('pl', DEF.pl); if (!c.staff && pl.on && pl.launch && Date.now() < pl.launch) throw E(403, 'prelaunch', 'The shop opens at launch. Please come back then!'); }
    await rlCount(`order:${c.ip}`, 25, 'Too many orders from this connection. Please try again later.');
    const b = await bodyOf(c.req), cfg = await cfgAll(); await tsCheck(c, b, 'place');
    const name = str(b.name, 60), phone = str(b.phone, 20), email = str(b.email, 100).toLowerCase(), mode = b.mode, method = str(b.method, 30);
    if (!name) throw E(400, 'bad_name', 'Please enter your name.');
    const dg = nwa(phone); if (dg.length < 8 || dg.length > 15) throw E(400, 'bad_phone', 'Please enter a valid WhatsApp number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw E(400, 'bad_email', 'Please enter a valid email address.');
    if (mode !== 'Delivery' && mode !== 'Pickup') throw E(400, 'bad_mode', 'Please choose delivery or pickup.');
    const addr = mode === 'Delivery' ? str(b.addr, 200) : ''; if (mode === 'Delivery' && !addr) throw E(400, 'bad_addr', 'Please enter a delivery address.');
    const pmL = ((await getDoc('config', 'pm')) || {}).list, pmN = Array.isArray(pmL) && pmL.length ? pmL.map(m => String(m && m.n || '')) : ['Bank transfer', 'E-wallet'];
    if (!method || !pmN.includes(method)) throw E(400, 'bad_method', 'Please choose a payment method.');
    const M = cfg.methods, sd = mode === 'Delivery' && b.sd === true;
    if (sd && !M.sd) throw E(400, 'bad_mode', 'Same-day delivery is not available right now. Please choose another option.');
    if ((mode === 'Delivery' && !sd && M.dl === false) || (mode === 'Pickup' && M.pu === false)) throw E(400, 'bad_mode', 'That option is not available right now. Please choose another one.');
    const slot = checkSlot(cfg, mode, b.slot, sd), items = await buildItems(b.items), tier = c.b2b ? 'b2b' : 'regular', cour = mode === 'Delivery' ? (await radiusGate(b, cfg), await courierOf(b, cfg, sd)) : null, fd0 = mode === 'Delivery' ? fdOf(cfg) : null, fd = fd0 && fdFits(cfg.fdev, cour) ? fd0 : null;
    let cpn = null, code = '', cg = null; const sub0 = items.reduce((s, i) => s + i.u * i.q, 0);
    if (b.coupon) { const r = await couponCheck(b.coupon, sub0, { phone, items }); if (r.err) throw E(400, 'coupon', r.err); cpn = r.d.type === 'item' ? { type: 'amt', v: items.find(i => String(i.id) === String(r.d.pid)).u } : { type: r.d.type === 'pct' ? 'pct' : 'amt', v: +r.d.v }; code = r.code; if (r.d.type === 'gift') cg = { c: r.code, n: r.d.n || 'Special', img: r.d.img || '' }; }
    const rwr = await rewardsCheck(b.rewards, sub0, { phone, items }, code), affc = cpn && code ? ((await getDoc('coupons', code)) || {}).aff : '', k = calc(items, { mode, sd, tier, cpns: [...(cpn ? [cpn] : []), ...rwr.specs.map(x => ({ type: x.t, v: x.v }))], cr: cour && (cour.k === 'bs' || cour.ty === 'd') ? cour : null, fd }, cfg), no = 'D' + rid(5).toUpperCase();
    const bbc = await cfgDoc('bb', DEF.bb), bbn = bbLive(bbc, Date.now()) ? bbCount(bbc, items, k.td) : 0;
    const order = { no, uid: c.vid, name, phone, email, mode, addr, method, coupon: code, ...(rwr.specs.length ? { rws: rwr.specs } : {}), ...(cg || rwr.specs.some(x => x.g) ? { gifts: [...(cg ? [cg] : []), ...rwr.specs.filter(x => x.g).map(x => ({ c: x.c, ...x.g }))] } : {}), ...(bbn ? { bbq: true, bbn } : {}), items: items.map(({ id, n, e, t, q, u, bx, ob }) => ({ id, n, e, t, q, u, ...(ob ? { ob } : {}), ...(bx ? { bx } : {}) })), sub: k.sub, tdisc: k.td, disc: k.cd, svc: k.svc, pack: k.pack, tax: k.tax, ship: k.sh, kg: k.kg, total: k.total, tier, b2: c.b2b ? c.b2b.u : '', slot, ...(sd ? { sd: true } : {}), ...(cour ? { cour: { id: cour.id, k: cour.k, n: cour.n, raw: cour.raw, ...(cour.ty === 'd' ? { dv: 1 } : {}), ...(cour.c ? { c: cour.c, s: cour.s } : {}) }, lat: cour.lat, lng: cour.lng, ...(cour.pc ? { pc: cour.pc } : {}) } : {}), ...(fd && k.fd ? { fd, fdv: k.fd } : {}), ...(mode === 'Delivery' ? { sraw: k.raw, rdv: k.rd } : {}), ref: '', at: Date.now() };
    await putDoc('orders', no, order);
    const af = await affAttach(affc || b.aff, { no, phone, email, name, items, k }, affc ? 'coupon' : 'link', b.affs); if (af) { const o1 = (await getDoc('orders', no)) || order, ar = await store.getJSON('sec/affu/' + af); await putDoc('orders', no, { ...o1, aff: af, afn: ar ? str(ar.name, 40) : af }); order.aff = af; order.afn = ar ? str(ar.name, 40) : af; }
    if (code || rwr.specs.length) { await putDoc('redeem', no, { code, at: Date.now(), ...(rwr.specs.length ? { rw: rwr.specs.map(x => x.c) } : {}) }); if (code) await rcAdd(code, 1); for (const x of rwr.specs) await rcAdd(x.c, 1); }
    return { order };
  }
  async function apiEdit(c) {
    const b = await bodyOf(c.req), o = await ownOrder(c, b.no), cfg = await cfgAll();
    if ((await stageOf(o.no)) !== 0 || o.ref || o.proof || Date.now() > Math.max(o.at, +o.rjAt || 0) + payMs(o, cfg)) throw E(409, 'locked', 'This order can no longer be edited (it was paid, cancelled or the payment time ran out).');
    if (!Array.isArray(b.q) || b.q.length !== o.items.length) throw E(400, 'bad_items', 'Invalid items.');
    const items = o.items.map((it, i) => ({ ...it, q: Math.max(0, Math.min(50, Math.floor(+b.q[i] || 0))) })).filter(i => i.q > 0);
    /* "Add more items": new lines are checked and priced here, exactly like a new order. Existing lines keep their price. */
    if (b.add !== undefined) {
      if (!Array.isArray(b.add) || b.add.length > 20) throw E(400, 'bad_items', 'Invalid items.');
      if (b.add.length) {
        const fresh = await buildItems(b.add), need = {};
        for (const f of fresh) {
          const same = items.find(x => x.id === f.id && x.u === f.u && JSON.stringify(x.t || []) === JSON.stringify(f.t || []));
          if (same) same.q = Math.min(50, same.q + f.q); else items.push({ id: f.id, n: f.n, e: f.e, t: f.t, q: f.q, u: f.u, ...(f.bx ? { bx: f.bx } : {}) });
        }
        for (const i of items) { need[i.id] = (need[i.id] || 0) + i.q; for (const x of i.bx || []) need[x.id] = (need[x.id] || 0) + x.q * i.q; }
        const freshIds = new Set(fresh.flatMap(f => [String(f.id), ...(f.bx || []).map(x => String(x.id))]));
        for (const id of Object.keys(need).filter(id => freshIds.has(id))) { const p = await product(id); if (p && p.stock !== null && need[id] > Math.max(0, p.stock)) throw E(400, 'stock', `${p.n} is out of stock or has fewer left than requested.`); }
        if (items.length > 30) throw E(400, 'bad_items', 'Your order is too large.');
      }
    }
    if (!items.length) throw E(400, 'empty', 'An order needs at least one item. Cancel the order instead.');
    const addr = o.mode === 'Delivery' ? str(b.addr, 200) : ''; if (o.mode === 'Delivery' && !addr) throw E(400, 'bad_addr', 'Please enter a delivery address.');
    const slot = checkSlot(cfg, o.mode, b.slot, !!o.sd, !!(o.slot && b.slot && o.slot.d === b.slot.d));
    const prods = await Promise.all(items.map(i => product(i.id))), its = items.map((i, ix) => ({ u: i.u, q: i.q, ob: i.ob, w: prods[ix] ? prods[ix].kg : .4 })), sub0 = its.reduce((s, i) => s + i.u * i.q, 0);
    let cpn = null, coupon = o.coupon, dropped = false; const gifts = [];
    if (o.coupon) { const cd = await getDoc('coupons', o.coupon); const itm = cd && cd.type === 'item' ? items.find(i => String(i.id) === String(cd.pid)) : null; if (cd && !(cd.exp && Date.now() > cd.exp) && !(cd.min > 0 && sub0 < cd.min) && !(cd.type === 'item' && !itm) && !(cd.box > 0 && !items.some(i => i.bx && boxPcs(i) >= cd.box))) { cpn = cd.type === 'item' ? { type: 'amt', v: itm.u } : { type: cd.type === 'pct' ? 'pct' : 'amt', v: +cd.v }; if (cd.type === 'gift') gifts.push({ c: o.coupon, n: cd.n || 'Special', img: cd.img || '' }); } else { coupon = ''; dropped = true; } }
    const keep = []; for (const r of o.rws || []) { const cd = await getDoc('coupons', r.c), itm = cd && cd.type === 'item' ? items.find(i => String(i.id) === String(cd.pid)) : null; if (cd && !(cd.exp && Date.now() > cd.exp) && !(cd.min > 0 && sub0 < cd.min) && !(cd.type === 'item' && !itm) && !(cd.box > 0 && !items.some(i => i.bx && boxPcs(i) >= cd.box))) { keep.push({ c: r.c, t: cd.type === 'pct' ? 'pct' : 'amt', v: cd.type === 'item' ? itm.u : +cd.v, ...(cd.type === 'gift' ? { g: { n: cd.n || 'Special', img: cd.img || '' } } : {}) }); if (cd.type === 'gift') gifts.push({ c: r.c, n: cd.n || 'Special', img: cd.img || '' }); } else dropped = true; }
    const k = calc(its, { mode: o.mode, sd: !!o.sd, tier: o.tier || 'regular', cpns: [...(cpn ? [cpn] : []), ...keep.map(x => ({ type: x.t, v: x.v }))], cr: o.cour && (o.cour.k === 'bs' || o.cour.dv) ? o.cour : null, fd: o.fd || null }, cfg);
    const upd = { ...o, items, ...(o.fd ? { fdv: k.fd } : {}), ...(o.mode === 'Delivery' ? { sraw: k.raw, rdv: k.rd } : {}), sub: k.sub, tdisc: k.td, disc: k.cd, svc: k.svc, pack: k.pack, tax: k.tax, ship: k.sh, kg: k.kg, total: k.total, edited: true, addr, slot, coupon, ...(keep.length ? { rws: keep } : {}) };
    if (!keep.length) delete upd.rws; if (gifts.length) upd.gifts = gifts; else delete upd.gifts;
    if (!o.bbo) { const bbc = await cfgDoc('bb', DEF.bb), n = bbLive(bbc, Date.now()) ? bbCount(bbc, items, k.td) : 0; if (n) { upd.bbq = true; upd.bbn = n; } else { delete upd.bbq; delete upd.bbn; } }
    await putDoc('orders', o.no, upd); if (o.aff) await affRebase(o.aff, o.no, k.sub - k.td - k.cd);
    if (dropped) { const rd = await getDoc('redeem', o.no); if (rd) { const nw = keep.map(x => x.c); for (const c0 of rd.rw || []) if (!nw.includes(c0)) await rcAdd(c0, -1); if (rd.code && !coupon) await rcAdd(rd.code, -1); if (!coupon && !nw.length) await delDoc('redeem', o.no); else await putDoc('redeem', o.no, { code: coupon || '', at: rd.at, ...(nw.length ? { rw: nw } : {}) }); } }
    await slog('order.cedit', `Order #${o.no} · ${o.name}`, (b.add && b.add.length ? 'Customer edited the order and added items before payment' : 'Customer edited the order before payment') + (dropped ? ' · coupon removed' : ''), 'customer');
    return { order: upd };
  }
  async function apiCancel(c) {
    const b = await bodyOf(c.req), o = await ownOrder(c, b.no);
    if ((await stageOf(o.no)) !== 0 || o.ref || o.proof) throw E(409, 'locked', 'This order can no longer be cancelled.');
    await putDoc('status', o.no, { s: -1, t: Date.now(), note: 'Cancelled by customer', by: 'customer' }); await releaseCoupon(o.no);
    await slog('order.cancel', `Order #${o.no} · ${o.name}`, 'Cancelled by the customer before payment', 'customer'); return { ok: true };
  }
  async function apiPay(c) {
    const b = await bodyOf(c.req, 600000), o = await ownOrder(c, b.no), ref = str(b.ref, 60); await tsCheck(c, b, 'proof');
    if ((await stageOf(o.no)) !== 0 || o.proof) throw E(409, 'locked', 'Payment proof was already sent for this order.');
    if (!ref) throw E(400, 'bad_ref', 'Please enter your sender name or payment reference.'); if (!okImg(b.img)) throw E(400, 'bad_img', 'Please upload your payment proof image.');
    await putDoc('proofs', o.no, { no: o.no, img: b.img, at: Date.now() });
    const pmL = ((await getDoc('config', 'pm')) || {}).list, pmN = Array.isArray(pmL) && pmL.length ? pmL.map(m => String(m && m.n || '')) : ['Bank transfer', 'E-wallet'], method = pmN.includes(String(b.method || '')) ? String(b.method) : o.method;
    const upd = { ...o, method, ref, proof: true, paidAt: Date.now() }; await putDoc('orders', o.no, upd); return { order: upd };
  }
  /* Payment review: confirm or reject a customer's payment. The owner's decision applies at once; a staff decision waits for the owner's approval. */
  async function apiPayRev(c) {
    if (!c.staff) throw E(403, 'forbidden', 'You do not have access to do that.');
    const b = await bodyOf(c.req), no = String(b.no || ''), o = /^D[0-9A-F]{10}$/.test(no) ? await getDoc('orders', no) : null; if (!o) throw E(404, 'not_found', 'Order not found.');
    const st = (await getDoc('status', no)) || { s: 0 }, s0 = typeof st.s === 'number' ? st.s : 0, act = String(b.act || ''), who = c.staff.u, tgt = `Order #${no} · ${o.name}`;
    const apply = async (a, note, req) => {
      if (a === 'confirm') { await putDoc('status', no, { s: 1, t: Date.now(), pd: true, by: who, ...(req ? { req } : {}) }); capiPurchase(o).catch(e => console.error('meta capi', e.message)); await slog('order.payment', tgt, `Payment of Rp ${(+o.total || 0).toLocaleString('id-ID')} confirmed${req ? ' (requested by ' + req + ', approved by owner)' : ''}${o.ref ? ' – ref ' + o.ref : ''}`, who); return { ok: true, s: 1 }; }
      const msg = 'Payment proof rejected' + (note ? ': ' + note : ''), t = Date.now();
      await putDoc('orders', no, { ...o, ref: '', proof: false, rj: (+o.rj || 0) + 1, rjAt: t, rjNote: note }); await putDoc('status', no, { s: 0, t, note: msg, by: who, ...(req ? { req } : {}) });
      await slog('order.payrej', tgt, msg + (req ? ' (requested by ' + req + ', approved by owner)' : ''), who); return { ok: true, s: 0, rejected: true };
    };
    if (act === 'confirm' || act === 'reject') {
      if (!c.any('s', 'c')) throw E(403, 'forbidden', 'You do not have access to do that.');
      if (s0 !== 0) throw E(409, 'not_waiting', 'This order is no longer awaiting payment.');
      if (act === 'confirm' && !o.ref && !o.proof) throw E(409, 'no_proof', 'The customer has not sent a payment proof yet.');
      if (act === 'reject' && !o.ref && !o.proof) throw E(409, 'no_proof', 'There is no payment proof to reject.');
      const note = str(b.note, 120);
      if (c.owner()) return apply(act, note, null);
      await putDoc('status', no, { ...st, s: 0, pa: { act, by: who, at: Date.now(), note } });
      await slog('order.payreq', tgt, `${who} ${act === 'confirm' ? 'confirmed' : 'rejected'} the payment${note ? ' – ' + note : ''} · waiting for owner approval`, who); return { ok: true, pending: true };
    }
    if (act === 'approve' || act === 'decline') {
      if (!c.owner()) throw E(403, 'forbidden', 'Only the owner can approve.');
      if (!st.pa || s0 !== 0) throw E(409, 'nothing', 'Nothing is waiting for approval on this order.');
      if (act === 'decline') { const { pa, ...rest } = st; await putDoc('status', no, rest); await slog('order.payreq', tgt, `Owner declined ${pa.by}'s request to ${pa.act} the payment`, who); return { ok: true }; }
      if (!o.ref && !o.proof) { const { pa, ...rest } = st; await putDoc('status', no, rest); throw E(409, 'no_proof', 'There is no payment proof any more.'); }
      if (st.pa.act === 'reject' && !o.ref && !o.proof) { const { pa, ...rest } = st; await putDoc('status', no, rest); throw E(409, 'no_proof', 'There is no payment proof to reject any more.'); }
      return apply(st.pa.act, st.pa.note, st.pa.by);
    }
    throw E(400, 'bad_act', 'Unknown action.');
  }
  async function apiClaim(c) {
    const b = await bodyOf(c.req), key = 'claim:' + c.ip; await rlCheck(key, 8);
    const no = String(b.no || '').trim().toUpperCase().replace(/^#/, ''), o = /^D[0-9A-F]{10}$/.test(no) ? await getDoc('orders', no) : null;
    if (!o || nwa(o.phone) !== nwa(b.phone) || nwa(b.phone).length < 8) { await rlFail(key); throw E(404, 'not_found', 'We could not find an order with that number and WhatsApp number.'); }
    await putDoc('orders', no, { ...o, uid: c.vid }); await rlReset(key); return { ok: true, no };
  }
  async function apiComplaint(c) {
    const b = await bodyOf(c.req, 900000), o = await ownOrder(c, b.no), cfg = await cfgAll(), st = await getDoc('status', o.no);
    if (!st || st.s !== 4) throw E(409, 'not_delivered', 'You can report a problem after the order is delivered or picked up.');
    if (Date.now() > (st.t || o.at) + (+cfg.fees.cw || 48) * HOUR) throw E(409, 'closed', 'Sorry, the complaint period has ended.');
    if (await getDoc('complaints', o.no)) throw E(409, 'exists', 'A complaint was already sent for this order.');
    const reason = COMPLAINT_REASONS.includes(b.reason) ? b.reason : 'Other', text = str(b.text, 400), imgs = Array.isArray(b.imgs) ? b.imgs.slice(0, 3) : [];
    if (text.length < 5) throw E(400, 'bad_text', 'Please describe the problem.'); if (!imgs.length || !imgs.every(okImg)) throw E(400, 'bad_img', 'Please add 1 to 3 photos of the product.');
    for (let i = 0; i < imgs.length; i++) await putDoc('cmpimgs', `${o.no}_${i}`, { img: imgs[i], no: o.no, uid: c.vid });
    await putDoc('complaints', o.no, { id: o.no, no: o.no, uid: c.vid, name: o.name, phone: o.phone, email: o.email || '', reason, item: str(b.item, 80), text, nimg: imgs.length, status: 'open', at: Date.now(), total: +o.total || 0 });
    await slog('cmp.new', `Order #${o.no} · ${o.name}`, 'Complaint: ' + reason, 'customer'); return { ok: true };
  }
  async function apiReview(c) {
    const b = await bodyOf(c.req), o = await ownOrder(c, b.no), pid = +b.pid, stars = Math.floor(+b.stars), it = o.items.find(i => +i.id === pid);
    if ((await stageOf(o.no)) !== 4) throw E(409, 'not_delivered', 'You can rate your order after it is delivered.'); if (!it) throw E(400, 'bad_item', 'Item not found.'); if (!(stars >= 1 && stars <= 5)) throw E(400, 'bad_stars', 'Please choose 1 to 5 stars.');
    const id = `${o.no}_${pid}`; if (await getDoc('reviews', id)) throw E(409, 'exists', 'You already rated this item.');
    await putDoc('reviews', id, { id, pid, pname: it.n, no: o.no, uid: c.vid, name: o.name, stars, text: str(b.text, 200), at: Date.now() });
    /* Review Box: rating every item of the order (5 stars by default, the owner can lower it) within the review window earns a box; a lower rating earns nothing (the customer is not told why) */
    const rc = await cfgDoc('rrw', DEF.rrw), o2 = await getDoc('orders', o.no) || o;
    if (bbLive(rc, Date.now()) && !o2.rvn && !o2.rvx) {
      const revs = []; let all = true; for (const i of o2.items.filter(x => x.id)) { const r = await getDoc('reviews', `${o.no}_${i.id}`); if (r) revs.push(r); else all = false; }
      if (all) { const dv = await getDoc('status', o.no), deadline = ((dv && dv.t) || o2.at) + rc.days * 864e5, win = revs.every(r => r.stars >= (rc.min || 5)) && Date.now() <= deadline; await putDoc('orders', o.no, win ? { ...o2, rvn: rc.n } : { ...o2, rvx: true }); }
    }
    return { ok: true };
  }

  /* ---------- auth endpoints ---------- */
  async function apiMe(c) { const any = (await store.list('sec/staff/')).length > 0; return { uid: c.vid, staff: c.staff, b2b: c.b2b, setup: !any && c.adminHost, pub: c.adminHost ? (HOSTS.shop[c.host] || '') : '' }; }
  async function apiSetup(c) {
    const b = await bodyOf(c.req), key = 'setup:' + c.ip; await rlCheck(key, 5);
    if ((await store.list('sec/staff/')).length) throw E(409, 'done', 'The owner account already exists.');
    const want = process.env.OWNER_SETUP_KEY || ''; if (want.length < 12) throw E(500, 'server_misconfigured', 'OWNER_SETUP_KEY is missing or shorter than 12 characters');
    if (!safeEq(String(b.key || ''), want)) { await rlFail(key); throw E(403, 'bad_key', 'The setup key is not correct.'); }
    const u = String(b.u || '').toLowerCase(); if (!okUser(u)) throw E(400, 'bad_user', 'Username: 3–20 letters, numbers, . or _'); if (!okPw(b.p)) throw E(400, 'bad_pw', 'Password needs at least 10 characters.');
    await store.setJSON('sec/staff/' + u, { u, role: 'owner', perms: {}, ...(await mkCred(b.p)), at: Date.now() });
    c.cookie('stf', signTok({ k: 'stf', u }, 12 * 3600), 12 * 3600); await slog('staff.add', 'Owner account', 'Owner account created', u); return { ok: true, staff: { u, role: 'owner', perms: {} } };
  }
  async function apiLogin(c) {
    const b = await bodyOf(c.req); await tsCheck(c, b, 'login'); const u = String(b.u || '').trim().toLowerCase(), key = `login:${c.ip}:${u}`; await rlCheck(key, 6);
    const rec = okUser(u) ? await store.getJSON('sec/staff/' + u) : null;
    if (!(await checkPw(rec, b.p))) { await rlFail(key); await slog('auth.fail', 'Owner site', 'Wrong username or password', u || '?'); await new Promise(r => setTimeout(r, 400)); throw E(401, 'bad_login', 'Wrong username or password.'); }
    await rlReset(key); c.cookie('stf', signTok({ k: 'stf', u }, 12 * 3600), 12 * 3600); await slog('auth.in', 'Owner site', 'Logged in as ' + rec.role, u);
    return { staff: { u, role: rec.role, perms: rec.perms || {} } };
  }
  async function apiLogout(c) { c.clear('stf'); c.clear('rea'); return { ok: true }; }
  async function apiReauth(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); const b = await bodyOf(c.req), key = `reauth:${c.ip}:${c.staff.u}`; await rlCheck(key, 5);
    const rec = await store.getJSON('sec/staff/' + c.staff.u); if (!(await checkPw(rec, b.p))) { await rlFail(key); throw E(401, 'bad_pw', 'Wrong password.'); }
    await rlReset(key); c.cookie('rea', signTok({ k: 'rea', u: c.staff.u }, 120), 120); return { ok: true };
  }
  async function apiStaff(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    if (c.req.method === 'GET') { const keys = await store.list('sec/staff/'), L = []; for (const k of keys) { const r = await store.getJSON(k); if (r) L.push({ u: r.u, role: r.role, perms: r.perms || {} }); } return { staff: L }; }
    const b = await bodyOf(c.req), u = String(b.u || '').toLowerCase(); if (!okUser(u)) throw E(400, 'bad_user', 'Username: 3–20 letters, numbers, . or _');
    const PERMS = ['o', 'p', 's', 'c', 'k', 'f', 'cp', 'cm'], clean = p => Object.fromEntries(PERMS.filter(k => p && p[k]).map(k => [k, true]));
    if (b.op === 'create') { if (await store.getJSON('sec/staff/' + u)) throw E(409, 'exists', 'That username already exists.'); if (!okPw(b.p)) throw E(400, 'bad_pw', 'Password needs at least 10 characters.'); await store.setJSON('sec/staff/' + u, { u, role: 'staff', perms: clean(b.perms), ...(await mkCred(b.p)), at: Date.now() }); await slog('staff.add', 'Employee: ' + u, 'Access: ' + (Object.keys(clean(b.perms)).join(', ') || 'none'), c.staff.u); return { ok: true }; }
    const rec = await store.getJSON('sec/staff/' + u); if (!rec) throw E(404, 'not_found', 'Employee not found'); if (rec.role === 'owner') throw E(400, 'owner', 'The owner account cannot be changed here.');
    if (b.op === 'perms') { rec.perms = clean(b.perms); await store.setJSON('sec/staff/' + u, rec); await slog('staff.perm', 'Employee: ' + u, 'Access updated', c.staff.u); return { ok: true }; }
    if (b.op === 'delete') { await store.del('sec/staff/' + u); await slog('staff.del', 'Employee: ' + u, '', c.staff.u); return { ok: true }; }
    throw E(400, 'bad_op', 'Unknown action');
  }
  async function apiB2b(c, sub) {
    const b = await bodyOf(c.req);
    if (sub === 'login') {
      await tsCheck(c, b, 'login'); const u = String(b.u || '').trim().toLowerCase(), key = `b2b:${c.ip}:${u}`; await rlCheck(key, 6); const rec = okUser(u) ? await store.getJSON('sec/b2b/' + u) : null;
      if (!(await checkPw(rec, b.p))) { await rlFail(key); await new Promise(r => setTimeout(r, 400)); throw E(401, 'bad_login', 'Wrong username or password.'); }
      await rlReset(key); c.cookie('b2', signTok({ k: 'b2', u }, 14 * 86400), 14 * 86400); return { b2b: { u, name: rec.name || u } };
    }
    if (sub === 'logout') { c.clear('b2'); return { ok: true }; }
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    if (sub === 'set') {
      const u = String(b.u || '').toLowerCase(), cid = String(b.cid || ''); if (!okUser(u)) throw E(400, 'bad_user', 'Username: 3–20 letters, numbers, . or _'); if (!okPw(b.p)) throw E(400, 'bad_pw', 'The password needs at least 10 characters.'); if (!/^\d{8,15}$/.test(cid)) throw E(400, 'bad_cid', 'Invalid customer.');
      const ex = await store.getJSON('sec/b2b/' + u); if (ex && ex.cid !== cid) throw E(409, 'taken', 'That username is already taken.');
      const cu = await getDoc('customers', cid); if (!cu) throw E(404, 'not_found', 'Customer not found.'); if (cu.login && cu.login !== u) await store.del('sec/b2b/' + cu.login);
      await store.setJSON('sec/b2b/' + u, { u, name: cu.name, cid, ...(await mkCred(b.p)) }); await putDoc('customers', cid, { ...cu, login: u }); return { ok: true };
    }
    if (sub === 'remove') { const cid = String(b.cid || ''), cu = await getDoc('customers', cid); if (cu && cu.login) { await store.del('sec/b2b/' + cu.login); await putDoc('customers', cid, { ...cu, login: '' }); } return { ok: true }; }
    throw E(404, 'not_found', 'Not found');
  }

  /* ---------- generic database with per-collection rules ---------- */
  const firstName = n => String(n || '').split(' ')[0];
  const cleanReview = (r, mine) => mine ? r : { id: r.id, pid: r.pid, pname: r.pname, stars: r.stars, text: r.text, at: r.at, hidden: r.hidden, edited: r.edited, name: firstName(r.name), own: r.own, src: r.src };
  const NEWS_KINDS = ['news', 'deal', 'flash', 'info'];
  const REVIEW_SOURCES = ['WhatsApp', 'Instagram', 'In store', 'Google', 'Phone', 'Other'];
  function readRule(c, col) {
    if (['menu', 'cats', 'variants', 'config', 'reviews', 'coupons', 'news'].includes(col)) return 'public';
    if (['orders', 'status', 'complaints'].includes(col)) return c.staff ? (col === 'complaints' ? (c.can('cm') ? 'all' : 'own') : (c.any('o', 's', 'c') ? 'all' : 'own')) : 'own';
    if (col === 'proofs') return c.any('o', 's') ? 'all' : 'none';
    if (col === 'cmpimgs') return c.can('cm') ? 'all' : 'none';
    if (col === 'redeem') return c.any('o', 'cp') ? 'all' : 'none';
    if (col === 'logs' || col === 'customers') return c.owner() ? 'all' : 'none';
    if (col === 'flash') return c.can('f') ? 'all' : 'none';
    return 'none';
  }
  async function myOrderNos(c) { return new Set((await listCol('orders')).filter(d => d.data.uid === c.vid).map(d => d.id)); }
  async function visible(c, col) {
    const rule = readRule(c, col); if (rule === 'none') return [];
    let docs = await listCol(col);
    if (rule === 'own') {
      if (col === 'orders' || col === 'complaints') docs = docs.filter(d => d.data.uid === c.vid);
      else if (col === 'status') { const mine = await myOrderNos(c); docs = docs.filter(d => mine.has(d.id)); }
    }
    if (col === 'reviews') docs = docs.map(d => ({ id: d.id, data: cleanReview(d.data, c.owner() || d.data.uid === c.vid) }));
    if (col === 'config' && !c.staff) docs = docs.filter(d => PUBLIC_CONFIG.has(d.id)).map(d => d.id === 'shop' ? { id: d.id, data: { pay: d.data.pay } } : d.id === 'courier' ? { id: d.id, data: pubCourier(d.data) } : d);
    if (col === 'coupons' && !c.can('cp') && !c.owner()) docs = docs.filter(d => d.data.hint).map(d => ({ id: d.id, data: { type: d.data.type, v: d.data.v, min: d.data.min, hint: true, exp: d.data.exp, max: d.data.max } }));
    return docs;
  }
  const cmp = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
  function applyQuery(docs, q) {
    let L = docs.slice(); for (const w of (q.where || []).slice(0, 5)) { const f = cmp[w[1]]; if (f) L = L.filter(d => f(d.data[w[0]], w[2])); }
    if (q.order && q.order[0]) { const [f, dir] = q.order; L.sort((a, b) => (a.data[f] > b.data[f] ? 1 : a.data[f] < b.data[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const lim = Math.min(Math.max(+q.limit || 0, 0), 1000); return lim ? L.slice(0, lim) : L;
  }
  const splitPath = p => { const [col, id, ...rest] = String(p || '').split('/'); if (!COLLECTIONS.has(col) || !ID.test(id || '') || rest.length) throw E(400, 'bad_path', 'Invalid path'); return [col, id]; };
  function cleanData(d) { if (!isObj(d)) throw E(400, 'bad_data', 'Invalid data'); if (JSON.stringify(d).length > 250000) throw E(413, 'too_large', 'Data too large'); for (const k of Object.keys(d)) if (k.startsWith('__') || k === 'constructor') throw E(400, 'bad_data', 'Invalid data'); return d; }
  function needWrite(c, col, op, id, nd, old, patch) {
    const pt = patch || nd;
    const deny = () => { throw E(403, 'forbidden', 'You do not have access to do that.'); };
    if (!c.staff) deny();
    switch (col) {
      case 'menu': {
        if (op === 'delete' || (nd && nd.del === true)) { if (!c.owner()) deny(); if (!c.reauth) throw E(403, 'reauth', 'Please confirm with the owner password.'); return; }
        if (c.any('p', 'k', 'f')) return;
        if (c.can('s') && old && nd && Object.keys({ ...old, ...nd }).every(k => k === 'stock' || JSON.stringify(old[k]) === JSON.stringify(nd[k])) && typeof nd.stock === 'number' && nd.stock <= (old.stock ?? Infinity)) return; deny(); break; }
      case 'cats': case 'variants': if (!c.can('p')) deny(); break;
      case 'coupons': if (!c.can('cp')) deny(); break;
      case 'config': if (!c.owner() && !(id === 'fdev' && c.can('f'))) deny(); break;
      case 'customers': case 'reviews': if (!c.owner()) deny(); break;
      case 'news': if (!c.owner() || op === 'add') deny(); break;
      case 'orders': if (op === 'set' || op === 'add' || !c.any('s', 'c')) deny(); if (pt && ('uid' in pt || 'no' in pt || 'proof' in pt || 'ref' in pt)) deny(); break;
      case 'status': if (op === 'delete' || op === 'add' || !c.any('s', 'c')) deny(); break;
      case 'complaints': if (op !== 'update' || !c.can('cm')) deny(); if (pt && ('uid' in pt || 'no' in pt)) deny(); break;
      case 'redeem': if (op !== 'delete' || !c.any('s', 'c', 'o')) deny(); break;
      case 'logs': if (op !== 'add' && op !== 'set') deny(); break;
      case 'flash': if (op !== 'delete' || !c.owner()) deny(); break; // history is written by the server only; the owner deletes it
      default: deny();
    }
  }
  /* names must be unique (ignoring case and extra spaces): variants, products, categories. Only checked when the name is new or changed, so old data never blocks an unrelated save. */
  const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  async function checkUnique(col, id, merged, old) {
    const dup = what => { throw E(409, 'duplicate', `A ${what} with this name already exists. Please choose a different name.`); };
    if (col === 'variants') { const n = normName(merged.n); if (!n || (old && normName(old.n) === n)) return; if ((await listCol('variants')).some(d => d.id !== id && normName(d.data.n) === n)) dup('variant'); }
    else if (col === 'menu') {
      if (merged.del === true || merged.n === undefined) return; const n = normName(merged.n); if (!n || (old && normName(old.n) === n)) return;
      const names = new Map(); CATALOG.forEach(b => names.set(String(b.id), b.n)); for (const d of await listCol('menu')) { if (d.data.del) names.delete(d.id); else if (d.data.n) names.set(d.id, d.data.n); }
      for (const [k, v] of names) if (k !== String(id) && normName(v) === n) dup('product');
    } else if (col === 'cats') {
      const n = normName(merged.name); if (!n || (old && normName(old.name) === n)) return;
      const docs = await listCol('cats'), by = Object.fromEntries(docs.map(d => [d.id, d.data])), names = new Map();
      for (const b of CATALOG) { const k = 'b_' + String(b.c).replace(/[^A-Za-z0-9]/g, ''), o = by[k]; if (o && o.gone) continue; names.set(k, o && o.name ? o.name : b.c); }
      for (const d of docs) if (!d.id.startsWith('b_') && !d.data.gone) names.set(d.id, d.data.name);
      for (const [k, v] of names) if (k !== id && normName(v) === n) dup('category');
    }
  }
  async function apiDb(c, body) {
    const b = body || await bodyOf(c.req), op = b.op;
    if (op === 'multi') { // several reads in ONE request (the page uses this at start-up instead of ~20 separate calls)
      const L = Array.isArray(b.ops) ? b.ops.slice(0, 40) : [];
      return { results: await Promise.all(L.map(async o => {
        if (!isObj(o) || (o.op !== 'get' && o.op !== 'query')) return { error: 'Invalid request', code: 'bad_op' };
        try { return { r: await apiDb(c, o) }; } catch (e) { return { error: e instanceof HttpError ? e.message : 'Something went wrong on the server.', code: e.code || 'server_error' }; }
      })) };
    }
    if (op === 'get') {
      const [col, id] = splitPath(b.path), rule = readRule(c, col);
      if (rule === 'none') throw E(403, 'forbidden', 'You do not have access to do that.');
      let d = await getDoc(col, id);
      if (!d) return { exists: false, id };
      if (rule === 'own') {
        if (col === 'orders' || col === 'complaints') { if (d.uid !== c.vid) return { exists: false, id }; }
        else if (col === 'status') { const o = await getDoc('orders', id); if (!o || o.uid !== c.vid) return { exists: false, id }; }
      }
      if (col === 'reviews') d = cleanReview(d, c.owner() || d.uid === c.vid);
      if (col === 'config' && !c.staff) { if (!PUBLIC_CONFIG.has(id)) return { exists: false, id }; if (id === 'shop') d = { pay: d.pay }; if (id === 'courier') d = pubCourier(d); if (id === 'bb' || id === 'rrw') d = pubBb(d); if (id === 'pl') d = pubPl(d); }
      if (col === 'coupons' && !(c.can('cp') || c.owner()) && !d.hint) return { exists: false, id };
      if (col === 'coupons') { const used = ((await store.getJSON('meta/rc/' + id)) || { n: 0 }).n; d = (c.can('cp') || c.owner()) ? { ...d, used } : { type: d.type, v: d.v, min: d.min, max: d.max, exp: d.pl ? await plExp(d) : d.exp, hint: d.hint, used }; }
      return { exists: true, id, data: d };
    }
    if (op === 'query') {
      const col = String(b.col || ''); if (!COLLECTIONS.has(col)) throw E(400, 'bad_path', 'Invalid collection');
      if (readRule(c, col) === 'none') return { docs: [] };
      const docs = applyQuery(await visible(c, col), isObj(b.q) ? b.q : {}); return { docs };
    }
    if (op === 'clearLogs') { if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); if (!c.reauth) throw E(403, 'reauth', 'Please confirm with the owner password.'); const keys = await store.list('db/logs/'); for (const k of keys) await store.del(k); await touch('logs'); await slog('log.clear', 'Activity log', `All ${keys.length} entries were deleted`, c.staff.u); return { ok: true, n: keys.length }; }
    if (op === 'add') { const col = String(b.col || ''); if (!COLLECTIONS.has(col)) throw E(400, 'bad_path', 'Invalid collection'); const d = cleanData(b.data); needWrite(c, col, 'add', null, d, null); const id = Date.now().toString(36) + rid(3); const doc = col === 'logs' ? { at: Date.now(), by: c.staff.u, act: str(d.act, 40), tgt: str(d.tgt, 160), det: str(d.det, 400) } : d; await putDoc(col, id, doc); return { ok: true, id }; }
    const [col, id] = splitPath(b.path);
    if (op === 'delete') { const old = await getDoc(col, id); needWrite(c, col, 'delete', id, null, old); if (col === 'redeem') await releaseCoupon(id); else await delDoc(col, id); return { ok: true }; }
    if (op === 'set' || op === 'update') {
      const nd = cleanData(b.data), old = await getDoc(col, id), merged = op === 'update' ? { ...(old || {}), ...nd } : nd; needWrite(c, col, op, id, merged, old, nd);
      if (col === 'menu' || col === 'config') LIVEC.t = 0;
      if (col === 'status' && old) { if (old.pk && !merged.pk) merged.pk = old.pk; if (old.trk && !merged.trk) merged.trk = old.trk; if (merged.s < 0 && merged.pk && PK_LIVE.includes(merged.pk.st)) { await bsCancel(merged.pk.id); merged.pk = { ...merged.pk, st: 'cancelled', end: Date.now() }; delete merged.pk.al; } }
      /* an order can only move past 'Awaiting payment' after the customer sent a payment proof */
      if (col === 'status' && typeof merged.s === 'number' && merged.s > 0 && !(old && typeof old.s === 'number' && old.s > 0)) { const o = await getDoc('orders', id); if (o && !o.ref && !o.proof) throw E(409, 'no_proof', 'The customer has not sent a payment proof yet.'); }
      await checkUnique(col, id, merged, old);
      /* Order status rules: one step forward at a time, never backward. 0→1 (payment) only by the owner here – staff go through /api/payrev and need approval.
         Cancelling a paid order and refunding need the owner and the owner password. */
      if (col === 'status') {
        const o0 = old && typeof old.s === 'number' ? old.s : 0, n = merged.s, pd = !!(old && old.pd);
        if (!Number.isInteger(n)) throw E(400, 'bad_data', 'Invalid status.');
        const step = msg => { throw E(409, 'bad_step', msg); };
        if (n === o0) { /* same step: notes, courier, airway bill */ }
        else if (o0 === 0 && n === 1) { if (!c.owner()) step('Staff payment decisions need the owner\'s approval – use Confirm payment.'); }
        else if (o0 >= 1 && o0 <= 3 && n === o0 + 1) { /* next step */ }
        else if (n === -1 && o0 === 0) { /* cancel unpaid order: staff with order rights */ }
        else if (n === -1 && o0 >= 1 && o0 <= 3) { if (!c.owner()) step('Only the owner can cancel an order that is already paid.'); if (!c.reauth) throw E(403, 'reauth', 'Please confirm with the owner password.'); }
        else if (n === -2 && (o0 >= 1 || (o0 === -1 && pd))) { if (!c.owner()) step('Only the owner can refund an order.'); if (!c.reauth) throw E(403, 'reauth', 'Please confirm with the owner password.'); if (!/^[0-9a-f]{24}$/.test(merged.rfi || '')) throw E(400, 'no_refund_proof', 'Please upload the refund proof.'); merged.rfAt = Date.now(); merged.note = str(merged.note, 160); }
        else if (n === -2) step('Only a paid order can be refunded.');
        else step(o0 < 0 ? 'This order is closed – its status cannot change any more.' : n < o0 ? 'Status cannot go backward.' : 'Status must move one step at a time – you cannot skip a step.');
        if (pd || n >= 1) merged.pd = true; else delete merged.pd;
        if (n !== -2) { if (old && old.s === -2) { merged.rfi = old.rfi; merged.rfAt = old.rfAt; } else { delete merged.rfi; delete merged.rfAt; } }
        if (n === o0 && old && old.pa) merged.pa = old.pa; else delete merged.pa;
        if (n !== o0) merged.by = c.staff.u;
      }
      /* Once an order is paid (or closed), its items and prices are locked: only the stock-deducted flag and label-print record may change. */
      if (col === 'orders' && old && (await stageOf(id)) !== 0) {
        const changed = Object.keys({ ...old, ...merged }).filter(k => JSON.stringify(old[k]) !== JSON.stringify(merged[k]));
        if (changed.some(k => !['sd', 'lp', 'dp', 'ip', 'dn'].includes(k))) throw E(409, 'locked', 'This order is already paid or closed – it can no longer be edited.');
      }
      /* Top announcement bar (flash sale live / coming up / owner's own message). Every field is checked and rebuilt here. */
      if (col === 'config' && id === 'announce') {
        const hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d, bool = v => v === true, img = v => /^[0-9a-f]{24}$/.test(v || '') ? v : '';
        const one = (x, own) => { x = isObj(x) ? x : {}; const end = Math.floor(+x.end || 0);
          if (own && end && !(end > Date.now() - 400 * 864e5 && end < Date.now() + 400 * 864e5)) throw E(400, 'bad_end', 'Please pick a valid end time.');
          return { on: bool(x.on), msg: str(x.msg, 120), lab: str(x.lab, 24), bg: hex(x.bg, '#b73700'), fg: hex(x.fg, '#ffffff'), tc: hex(x.tc, '#d2262b'), tbg: hex(x.tbg, '#ffffff'), sz: ['s', 'm', 'l'].includes(x.sz) ? x.sz : 'm', im: img(x.im), ...(own ? { end } : {}) }; };
        const b = isObj(merged.b) ? merged.b : {};
        await putDoc('config', 'announce', { on: bool(merged.on), pin: bool(merged.pin), img: bool(merged.img), limg: bool(merged.limg), ltm: bool(merged.ltm), b: { live: one(b.live), soon: one(b.soon), own: one(b.own, true) } });
        return { ok: true };
      }
      /* Notifications the owner sends to every customer (bell icon). */
      if (col === 'news') {
        const title = str(nd.title, 60), body = str(nd.body, 300), kind = NEWS_KINDS.includes(nd.kind) ? nd.kind : null, code = str(nd.code, 16).toUpperCase(), exp = nd.exp == null || nd.exp === '' ? 0 : Math.floor(+nd.exp);
        if (!title) throw E(400, 'bad_title', 'Please write a title.'); if (!kind) throw E(400, 'bad_kind', 'Please choose a type.');
        if (code && !/^[A-Z0-9]{1,16}$/.test(code)) throw E(400, 'bad_code', 'Coupon codes use A–Z and 0–9.');
        if (exp && !(exp > Date.now() - 864e5 && exp < Date.now() + 400 * 864e5)) throw E(400, 'bad_exp', 'Please pick a valid end date.');
        let pid = null; if (nd.pid != null && nd.pid !== '') { const p = await product(nd.pid); if (!p) throw E(400, 'bad_item', 'That product is not available.'); pid = p.id; }
        await putDoc('news', id, { id, title, body, kind, code, pid, exp, at: (old && old.at) || Date.now() }); return { ok: true };
      }
      /* Reviews the owner types in (feedback received outside the website). They always carry own:true and a source, which the shop shows to customers. */
      if (col === 'reviews') {
        if (old) { if (old.own) { merged.own = true; merged.src = old.src; } else { delete merged.own; delete merged.src; } }
        else {
          if (!/^own_[a-z0-9]{4,24}$/.test(id)) throw E(400, 'bad_path', 'Invalid review id.');
          const p = await product(nd.pid), stars = Math.floor(+nd.stars), name = str(nd.name, 40).trim(), text = str(nd.text, 200).trim();
          if (!p) throw E(400, 'bad_item', 'Please choose a product.'); if (!(stars >= 1 && stars <= 5)) throw E(400, 'bad_stars', 'Please choose 1 to 5 stars.');
          if (!name) throw E(400, 'bad_name', 'Please enter the customer name.'); if (!REVIEW_SOURCES.includes(nd.src)) throw E(400, 'bad_src', 'Please choose where this review came from.');
          await putDoc('reviews', id, { id, pid: p.id, pname: p.n, name, stars, text, src: nd.src, own: true, at: Date.now() }); return { ok: true };
        }
      }
      /* "Sold out today": the client sends sod true/false; the server sets the end-of-day time itself (shop time zone), so it resets at midnight. */
      if (col === 'menu') { if (nd.sod === true) merged.sou = dayStart(dayOf(Date.now())) + 86400e3; else if (nd.sod === false) delete merged.sou; else if (old && old.sou) merged.sou = old.sou; else delete merged.sou; delete merged.sod; }
      if (col === 'variants') { /* brownie/cup builder: how many options a customer may pick, and where the group shows (filling inside, topping on top) */
        const mx = Math.floor(+merged.max); if (mx > 0) merged.max = Math.min(mx, 20); else delete merged.max;
        if (!['fill', 'top'].includes(merged.role)) delete merged.role;
      }
      if (col === 'menu') { /* builder screen for this product: build-your-brownie or brownie cup (not for gift boxes) */
        if (['brownie', 'cup'].includes(merged.bld) && !merged.bx) { /* keep */ } else delete merged.bld;
      }
      if (col === 'menu') { /* photos and videos: uploaded files or https links */
        for (const [k, mx] of [['imgs', 5], ['vids', 2]]) if (merged[k] !== undefined) merged[k] = (Array.isArray(merged[k]) ? merged[k] : []).map(x => String(x || '').trim()).filter(x => okMedia(x)).slice(0, mx);
      }
      if (col === 'menu') {
        if (merged.bx === null || merged.bx === false) delete merged.bx;
        else if (merged.bx !== undefined) {
          const n = Math.floor(+(merged.bx || {}).n), ids = Array.isArray((merged.bx || {}).ids) ? [...new Set(merged.bx.ids.map(String))] : null;
          if (!(n >= 2 && n <= 24)) throw E(400, 'bad_box', 'A box holds 2 to 24 pieces.');
          if (!ids || !ids.length || ids.length > 60 || !ids.every(x => ID.test(x)) || ids.includes(String(id))) throw E(400, 'bad_box', 'Please choose which products can go in the box.');
          merged.bx = { n, ids, ...(typeof merged.bx.nt === 'string' ? { nt: str(merged.bx.nt, 120) } : {}) };
        }
        /* quick view detail values of this product: a level (number), chosen notes (ids) or a text, per section id */
        if (merged.dx !== undefined) {
          const out = {}; let n = 0;
          if (isObj(merged.dx)) for (const [k, v] of Object.entries(merged.dx)) { if (!/^[a-z0-9]{1,12}$/.test(k) || ++n > 12) continue;
            if (typeof v === 'number') { const x = Math.round(v); if (x >= 1 && x <= 10) out[k] = x; }
            else if (Array.isArray(v)) { const a = [...new Set(v.map(String).filter(t => /^[a-z0-9]{1,12}$/.test(t) || okMedia(t)))].slice(0, 20); if (a.length) out[k] = a; } // note ids, or pictures (uploaded id / https link)
            else if (typeof v === 'string') { const t = str(v, 300); if (t) out[k] = t; } }
          if (Object.keys(out).length) merged.dx = out; else delete merged.dx;
        }
        if (merged.nq === true) merged.nq = true; else delete merged.nq; // quick view button switched off for this product
        await flashArchive(id, old, merged, c.staff.u);
      }
      /* Gift box look: lid label (shop logo, an uploaded logo, a short text, or logo + text), box colour and pattern, ribbon colour and type, bow on/off.
         Colours empty = default (kraft box, ribbon in the shop theme colour). */
      if (col === 'config' && id === 'boxlid') {
        const hex = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '';
        await putDoc('config', 'boxlid', { mode: ['logo', 'text', 'both'].includes(merged.mode) ? merged.mode : 'logo', img: /^[0-9a-f]{24}$/.test(merged.img || '') ? merged.img : '', text: str(merged.text, 30), tc: hex(merged.tc), bg: hex(merged.bg),
          bc: hex(merged.bc), rc: hex(merged.rc), rt: ['cross', 'single', 'diag', 'double', 'none'].includes(merged.rt) ? merged.rt : 'cross', pt: ['plain', 'stripes', 'dots', 'check'].includes(merged.pt) ? merged.pt : 'plain', bw: merged.bw !== false, an: merged.an !== false });
        return { ok: true };
      }
      /* Landing page carousel: photos and videos (uploaded file ids or https links), YouTube videos (11-character video id), and the auto-swipe settings. */
      if (col === 'config' && id === 'landing') {
        const okU = okMedia;
        if (merged.media !== undefined) {
          if (!Array.isArray(merged.media) || merged.media.length > 12) throw E(400, 'bad_media', 'Up to 12 photos and videos.');
          merged.media = merged.media.map(m => isObj(m) && ((m.k === 'i' || m.k === 'v') && okU(String(m.u || '')) || m.k === 'y' && /^[A-Za-z0-9_-]{11}$/.test(String(m.u || ''))) ? { k: m.k, u: String(m.u), ...(m.k === 'y' && m.v === true ? { v: true } : {}) } : null);
          if (merged.media.includes(null)) throw E(400, 'bad_media', 'A photo or video link is not valid. Links must start with https://');
        }
        /* Text and buttons over the carousel (owner's own words, colours and button actions) */
        if (merged.ov !== undefined) {
          const o = isObj(merged.ov) ? merged.ov : {}, hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d, one = (v, L, d) => L.includes(v) ? v : d;
          /* font name (built-in or the owner's uploaded font), size in px (0 = default), position in % of the carousel */
          const fnt = v => String(v || '').replace(/[^A-Za-z0-9 \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40), num = (v, a, b) => { const n = Math.round(+v); return n >= a && n <= b ? n : 0; }, pct = v => { const n = +v; return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 10) / 10)) : 50; };
          const B = (Array.isArray(o.btns) ? o.btns : []).slice(0, 3).filter(isObj).map(b => { const act = one(b.act, ['menu', 'cat', 'product', 'flash', 'cart', 'url'], 'menu'); let v = str(b.v, 300);
            if (act === 'url' && !(/^https:\/\/[^\s"'<>`\\]{4,300}$/.test(v) && !/^https:\/\/[^/]*@/.test(v))) throw E(400, 'bad_link', 'A button link must start with https://');
            if (act === 'product' && !ID.test(v)) v = ''; return { t: str(b.t, 24), act, v, bg: hex(b.bg, '#ffffff'), fg: hex(b.fg, '#b73700'), st: one(b.st, ['solid', 'outline', 'glass'], 'solid'), rd: one(b.rd, ['pill', 'round', 'square'], 'pill') }; }).filter(b => b.t);
          merged.ov = { on: o.on === true, t: str(o.t, 80), s: str(o.s, 140), pos: one(o.pos, ['top', 'middle', 'bottom'], 'middle'), al: one(o.al, ['left', 'center', 'right'], 'center'), sz: one(o.sz, ['s', 'm', 'l'], 'm'), ft: one(o.ft, ['display', 'body', 'spaced'], 'display'), tc: hex(o.tc, '#ffffff'), sh: one(o.sh, ['none', 'soft', 'dark'], 'soft'), btns: B,
            tf: fnt(o.tf), sf: fnt(o.sf), bf: fnt(o.bf), sc: hex(o.sc, ''), tz: num(o.tz, 10, 96), ssz: num(o.ssz, 10, 48), bsz: num(o.bsz, 10, 28),
            free: o.free === true, tx: pct(o.tx), ty: pct(o.ty), sx: pct(o.sx), sy: pct(o.sy), bx: pct(o.bx), by: pct(o.by) };
        }
        if (merged.car !== undefined) { const c = isObj(merged.car) ? merged.car : {}; merged.car = { on: c.on !== false, sec: Math.min(20, Math.max(2, Math.round(+c.sec || 4))), fx: ['slide', 'fade', 'zoom'].includes(c.fx) ? c.fx : 'slide', vw: c.vw !== false, dots: c.dots !== false, fit: c.fit === 'cover' ? 'cover' : 'contain', ar: ['std', 'square', 'tall', 'story'].includes(c.ar) ? c.ar : 'std' }; }
      }
      /* Delivery methods: on/off for each, same-day cut-off and windows, and the same-day pop-up message. */
      if (col === 'config' && id === 'methods') {
        const p = isObj(merged.pop) ? merged.pop : {}, tm = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : '14:00';
        const d = { dl: merged.dl !== false, sd: merged.sd === true, pu: merged.pu !== false, cut: tm(merged.cut), sdw: str(merged.sdw, 300), sdx: Math.max(10, Math.min(1440, Math.round(+merged.sdx || 60))),
          pop: { on: p.on !== false, when: p.when === 'always' ? 'always' : 'after', title: str(p.title, 60), text: str(p.text, 300), no: str(p.no, 24), yes: str(p.yes, 24), img: okMedia(String(p.img || '')) ? String(p.img) : '', anim: ['bounce', 'wiggle', 'pulse', 'spin', 'float', 'none'].includes(p.anim) ? p.anim : 'bounce' } };
        if (!d.dl && !d.sd && !d.pu) throw E(400, 'no_method', 'Keep at least one delivery or pickup option switched on.');
        await putDoc('config', 'methods', d); return { ok: true };
      }
      /* Couriers: partner courier on/off (Biteship), which couriers, the shop's pickup point, and when the store courier shows. */
      if (col === 'config' && id === 'courier') {
        const la = +merged.lat, ln = +merged.lng, list = String(merged.list || '').toLowerCase().split(/[\s,]+/).filter(x => /^[a-z0-9_-]{2,20}$/.test(x));
        const d = { bs: merged.bs === true, list: [...new Set(list)].slice(0, 20).join(',') || DEF.courier.list, lat: okLL(la, ln) ? la : 0, lng: okLL(la, ln) ? ln : 0, pc: /^\d{5}$/.test(String(merged.pc || '')) ? String(merged.pc) : '',
          store: merged.store === 'fail' ? 'fail' : 'always', sn: str(merged.sn, 40) || 'Store courier', warn: str(merged.warn, 300),
          ttl: Math.max(0, Math.min(1440, Number.isFinite(+merged.ttl) && merged.ttl !== '' && merged.ttl != null ? Math.round(+merged.ttl) : 30)),
          rad: Math.max(0, Math.min(500, Math.round((+merged.rad || 0) * 10) / 10)),
          dd: merged.dd === true, sp: Math.max(0, Math.min(10000000, Math.round(+merged.sp || 0))), spk: Math.max(0, Math.min(1000000, Math.round(+merged.spk || 0))), skm: Math.max(0, Math.min(500, Math.round((+merged.skm || 0) * 10) / 10)),
          rp: (() => { const p = isObj(merged.rp) ? merged.rp : {}; return { on: p.on !== false, title: str(p.title, 60), text: str(p.text, 300), yes: str(p.yes, 24), alt: str(p.alt, 24), wa: waLink(p.wa), cb: str(p.cb, 24), img: okMedia(String(p.img || '')) ? String(p.img) : '', anim: ['bounce', 'wiggle', 'pulse', 'spin', 'float', 'none'].includes(p.anim) ? p.anim : 'bounce' }; })(),
          on: str(merged.on, 60), op: str(merged.op, 20).replace(/[^0-9+]/g, ''), oa: str(merged.oa, 200), onote: str(merged.onote, 100), pkc: { on: !(isObj(merged.pkc) && merged.pkc.on === false), t: /^([01]?\d|2[0-3]):[0-5]\d$/.test((merged.pkc || {}).t || '') ? merged.pkc.t : '19:00' } };
        if ((d.bs || d.dd || d.rad > 0) && !d.lat) throw E(400, 'no_origin', 'Please set the shop pickup point on the map first.');
        await putDoc('config', 'courier', d); return { ok: true };
      }
      /* Free delivery event: like a flash sale for the delivery price (FULL free or a fixed amount off), with start and end. */
      if (col === 'config' && id === 'fdev') {
        const fs = Math.round(+merged.fs) || 0, fe = Math.round(+merged.fe) || 0, d = { fs, fe, full: merged.full !== false, amt: Math.max(0, Math.round(+merged.amt || 0)), min: Math.max(0, Math.round(+merged.min || 0)), mb: merged.mb === 'after' ? 'after' : 'before', t: str(merged.t, 40), cs: [...new Set((Array.isArray(merged.cs) ? merged.cs : []).filter(x => FD_CS.includes(x)))] };
        if (fs || fe) { if (!(fs > 0 && fe > fs)) throw E(400, 'bad_time', 'The end time must be after the start time.'); if (!d.full && !(d.amt > 0)) throw E(400, 'bad_amt', 'Enter the discount amount (Rp).'); }
        else { d.fs = 0; d.fe = 0; }
        await fdArchive(old, d, c.staff.u); await putDoc('config', 'fdev', d); return { ok: true };
      }
      /* Owner alerts (pop-up + sound in the back office): master switches, volume, and per event: on/off + sound (built-in name or an uploaded sound) */
      if (col === 'config' && id === 'alerts') {
        const own = (Array.isArray(merged.own) ? merged.own : []).filter(x => isObj(x) && /^[0-9a-f]{24}$/.test(x.id || '')).slice(0, 10).map(x => ({ id: x.id, n: str(x.n, 40) || 'My sound' }));
        const okS = v => ['beep', 'chime', 'doorbell', 'kaching', 'alarm', 'bell', 'pop'].includes(v) || (/^u:[0-9a-f]{24}$/.test(v || '') && own.some(x => 'u:' + x.id === v)) ? v : 'beep', ev = {};
        for (const k of ['order', 'pay', 'paid', 'cmp', 'cour', 'rev']) { const e = isObj((merged.ev || {})[k]) ? merged.ev[k] : {}; ev[k] = { on: e.on !== false, s: okS(e.s) }; }
        await putDoc('config', 'alerts', { on: merged.on !== false, snd: merged.snd !== false, keep: merged.keep === true, rep: merged.rep === true, vol: Math.max(0, Math.min(100, Math.round(+merged.vol || 0))), ev, own }); return { ok: true };
      }
      /* Backgrounds (Look & messages): shop page, order/checkout pages, product pop-up, pop-up messages – default, a colour, or a picture (upload or https link) */
      if (col === 'config' && id === 'bg') {
        const hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d, out = {};
        for (const k of ['page', 'pg', 'prod', 'pop']) { const b = isObj(merged[k]) ? merged[k] : {}, u = String(b.u || '');
          out[k] = { m: ['color', 'img'].includes(b.m) ? b.m : 'def', c: hex(b.c, '#ffffff'), u: okMedia(u) ? u : '', fit: ['cover', 'contain', 'tile'].includes(b.fit) ? b.fit : 'cover', ov: Math.max(0, Math.min(90, Math.round(+b.ov || 0))), oc: hex(b.oc, '#000000'), fix: b.fix === true };
          if (out[k].m === 'img' && !out[k].u) out[k].m = 'color'; }
        await putDoc('config', 'bg', out); return { ok: true };
      }
      /* Payment countdown look (Look & messages) */
      if (col === 'config' && id === 'cdown') {
        const hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d;
        await putDoc('config', 'cdown', { st: ['pill', 'box', 'plain'].includes(merged.st) ? merged.st : 'pill', an: ['pulse', 'glow', 'bounce', 'none'].includes(merged.an) ? merged.an : 'pulse', sz: ['s', 'm', 'l'].includes(merged.sz) ? merged.sz : 'm',
          ic: str(merged.ic, 4), flip: merged.flip !== false, bg: hex(merged.bg, '#a8231a'), fg: hex(merged.fg, '#ffffff'), low: hex(merged.low, '#e67e22'), crit: hex(merged.crit, '#d2262b'), shake: merged.shake !== false }); return { ok: true };
      }
      /* Quick view details: the quick view button, the detail sections (level bar, note icons, text) and the notes library; icons = emoji, an uploaded picture / GIF, or an https link */
      if (col === 'config' && id === 'pdet') {
        const ic = v => { v = String(v == null ? '' : v).trim(); return okMedia(v) ? v : str(v, 8).replace(/[<>"'`\\&]/g, ''); }, an = v => ['bounce', 'wiggle', 'pulse', 'spin', 'float', 'none'].includes(v) ? v : 'pulse', hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d, sid = v => /^[a-z0-9]{1,12}$/.test(v || '') ? v : '';
        const q = isObj(merged.qv) ? merged.qv : {}, seen = new Set();
        const secs = (Array.isArray(merged.secs) ? merged.secs : []).filter(isObj).slice(0, 12).map(x => ({ id: sid(x.id), t: ['lv', 'nt', 'tx', 'im'].includes(x.t) ? x.t : 'tx', n: str(x.n, 40), ic: ic(x.ic), an: an(x.an), info: str(x.info, 200), on: x.on !== false, fold: x.fold === 'closed' ? 'closed' : 'open',
          cnt: Math.max(3, Math.min(10, Math.round(+x.cnt || 5))), lo: str(x.lo, 20), mid: str(x.mid, 20), hi: str(x.hi, 20), col: hex(x.col, '#8b5a2b') })).filter(x => x.id && x.n && !seen.has(x.id) && seen.add(x.id));
        const nseen = new Set(), notes = (Array.isArray(merged.notes) ? merged.notes : []).filter(isObj).slice(0, 60).map(x => ({ id: sid(x.id), n: str(x.n, 30), ic: ic(x.ic) })).filter(x => x.id && x.n && !nseen.has(x.id) && nseen.add(x.id));
        await putDoc('config', 'pdet', { qv: { on: q.on !== false, ic: ic(q.ic) || '👁️', an: an(q.an), lb: str(q.lb, 16), bg: hex(q.bg, '#a8231a'), fg: hex(q.fg, '#ffffff'), plus: q.plus === true }, secs, notes }); return { ok: true };
      }
      /* Marketing: feed + product pages on/off, brand, Google category, site address, Meta Pixel id, Google tag id, Google Ads conversion (all optional) */
      if (col === 'config' && id === 'mkt') {
        const site = String(merged.site || '').trim().replace(/\/+$/, '');
        await putDoc('config', 'mkt', { on: merged.on !== false, brand: str(merged.brand, 60) || DEF.mkt.brand, gcat: str(merged.gcat, 200) || DEF.mkt.gcat, site: /^https:\/\/[a-z0-9.-]{3,100}$/i.test(site) ? site : '',
          px: /^\d{8,20}$/.test(merged.px || '') ? merged.px : '', gt: /^(G|AW|GT|UA)-[A-Z0-9-]{4,20}$/i.test(merged.gt || '') ? merged.gt.toUpperCase() : '', gc: /^AW-\d{6,14}\/[A-Za-z0-9_-]{6,40}$/.test(merged.gc || '') ? merged.gc : '' }); return { ok: true };
      }
      /* affiliate programme: default commission %, days to wait after delivery, minimum payout, customer discount on affiliate codes, link memory days */
      if (col === 'config' && id === 'aff') { await putDoc('config', 'aff', { on: merged.on !== false, rate: num2(merged.rate, 0, 80), hold: Math.max(0, Math.min(90, Math.floor(+merged.hold || 0))), min: Math.max(0, Math.min(1e8, Math.floor(+merged.min || 0))), disc: num2(merged.disc, 0, 50), days: Math.max(1, Math.min(180, Math.floor(+merged.days || 30))), signup: merged.signup !== false, pday: Math.max(0, Math.min(6, Math.floor(+merged.pday >= 0 ? +merged.pday : 4))), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(merged.email || '').trim()) ? String(merged.email).trim().slice(0, 100) : '', look: affLook(merged.look), sac: sacClean(merged.sac) }); for (const a of (await readAll(await store.list('sec/affu/'))).filter(Boolean)) await affDiscCode(a, await affCfg()); return { ok: true }; }
      /* the badge shown on gift box products in the shop */
      /* customer footer (social links, text) and the review card carousel above it */
      /* FAQ for Google and AI assistants */
      if (col === 'config' && id === 'faq') {
        const L = (Array.isArray(merged.items) ? merged.items : []).map(x => isObj(x) ? { q: str(x.q, 160), a: str(x.a, 700) } : null).filter(x => x && x.q && x.a).slice(0, 20);
        await putDoc('config', 'faq', { on: merged.on === true, items: L }); return { ok: true };
      }
      /* Local / Google SEO: the shop's business details (shown to Google as LocalBusiness data and geo tags on the home page) */
      if (col === 'config' && id === 'loc') {
        const T = ['Bakery', 'FoodEstablishment', 'Restaurant', 'CafeOrCoffeeShop', 'Store', 'LocalBusiness'], la = +merged.lat, ln = +merged.lng, DY = 'Mo|Tu|We|Th|Fr|Sa|Su';
        const hours = String(merged.hours || '').split(/\n/).map(x => x.trim()).filter(x => new RegExp(`^(${DY})(-(${DY}))? ([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d$`).test(x)).slice(0, 7).join('\n');
        await putDoc('config', 'loc', { on: merged.on === true, type: T.includes(merged.type) ? merged.type : 'Bakery', name: str(merged.name, 80), desc: str(merged.desc, 300), street: str(merged.street, 160), city: str(merged.city, 60), region: str(merged.region, 60), pc: /^\d{5}$/.test(String(merged.pc || '')) ? String(merged.pc) : '', phone: str(merged.phone, 20).replace(/[^0-9+]/g, ''), price: ['$', '$$', '$$$', '$$$$'].includes(merged.price) ? merged.price : '', hours,
          lat: okLL(la, ln) ? Math.round(la * 1e6) / 1e6 : 0, lng: okLL(la, ln) ? Math.round(ln * 1e6) / 1e6 : 0, rad: Math.max(0, Math.min(500, Math.round((+merged.rad || 0) * 10) / 10)), areas: str(merged.areas, 300), img: /^https:\/\/[^\s"'<>`\\]{4,400}$/.test(String(merged.img || '')) && !/^https:\/\/[^/]*@/.test(String(merged.img || '')) ? String(merged.img) : '' }); return { ok: true };
      }
      if (col === 'config' && id === 'foot') { await putDoc('config', 'foot', footClean(merged)); return { ok: true }; }
      if (col === 'config' && id === 'gbadge') { await putDoc('config', 'gbadge', { on: merged.on !== false, t: str(merged.t, 16) || 'Gift box', ic: str(merged.ic, 4) || '🎁', img: okBlobId(merged.img), c: /^#[0-9a-fA-F]{6}$/.test(merged.c || '') ? merged.c : '#db2777', a: ['wiggle', 'pulse', 'shine', 'bounce', 'none'].includes(merged.a) ? merged.a : 'wiggle' }); return { ok: true }; }
      /* Blindbox campaign: how it is earned (amount or box size), the prize pool with % weights, and the pop-up look */
      if (col === 'config' && id === 'bb') { await putDoc('config', 'bb', bbClean(merged)); return { ok: true }; }
      if (col === 'config' && id === 'lay') { await putDoc('config', 'lay', { dsk: merged.dsk !== false }); return { ok: true }; }
      if (col === 'config' && id === 'inv') { const hx = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '', med = v => okMedia(String(v || '').trim()) ? String(v).trim() : ''; await putDoc('config', 'inv', { logo: med(merged.logo), qr: med(merged.qr), qrc: str(merged.qrc, 60), name: str(merged.name, 60), addr: str(merged.addr, 200), ct: str(merged.ct, 100), tax: str(merged.tax, 40), ft: str(merged.ft, 200), dft: str(merged.dft, 200), col: hx(merged.col), sz: ['r58', 'r80', 'l10', 'a5', 'a4'].includes(merged.sz) ? merged.sz : 'a5', dnp: merged.dnp === true, dcod: merged.dcod === true, qa: merged.qa === true }); return { ok: true }; }
      if (col === 'config' && id === 'pl') { await putDoc('config', 'pl', plClean(merged)); return { ok: true }; }
      if (col === 'config' && id === 'rrw') { await putDoc('config', 'rrw', bbClean(merged, 'rv')); return { ok: true }; }
      /* DOKU payment: on/off, sandbox or live, which method groups to offer, and the fee the customer pays on the "other methods" group */
      if (col === 'config' && id === 'doku') {
        await putDoc('config', 'doku', { on: merged.on === true, sb: merged.sb !== false, q: merged.q !== false, o: merged.o !== false, fp: Math.min(10, Math.max(0, Math.round((+merged.fp || 0) * 100) / 100)), ff: Math.min(50000, Math.max(0, Math.round(+merged.ff || 0))), np: /^\/[A-Za-z0-9/_.-]{1,120}$/.test(String(merged.np || '').trim().replace(/\/+$/, '')) ? String(merged.np).trim().replace(/\/+$/, '') : '' }); return { ok: true };
      }
      if (col === 'config' && id === 'turnstile') {
        await putDoc('config', 'turnstile', { on: merged.on === true, sk: /^[0-9A-Za-z_-]{10,80}$/.test(merged.sk || '') ? merged.sk : '', place: merged.place !== false, proof: merged.proof !== false, rates: merged.rates === true, login: merged.login === true, doku: merged.doku !== false, cp: merged.cp !== false, aff: merged.aff !== false }); return { ok: true };
      }
      if (col === 'config' && id === 'order') { const ok = a => Array.isArray(a) && a.length <= 2000 && a.every(x => typeof x === 'string' && x.length <= 60); if (!ok(merged.c) || !ok(merged.p) || !ok(merged.v)) throw E(400, 'bad_data', 'Invalid order.'); await putDoc('config', 'order', { c: merged.c, p: merged.p, v: merged.v }); return { ok: true }; }
      if (col === 'config' && id === 'badges') { const L = Array.isArray(merged.list) ? merged.list : null; if (!L || L.length > 12 || !L.every(b => isObj(b) && /^[A-Za-z0-9_-]{1,20}$/.test(b.id || '') && typeof b.n === 'string' && b.n.trim().length >= 1 && b.n.length <= 24 && /^#[0-9a-fA-F]{6}$/.test(b.c || ''))) throw E(400, 'bad_data', 'Invalid badges.'); if (new Set(L.map(b => normName(b.n))).size !== L.length) throw E(409, 'duplicate', 'Two badges have the same name.'); await putDoc('config', 'badges', { list: L.map(b => ({ id: b.id, n: b.n.trim(), c: b.c })) }); return { ok: true }; }
      if (col === 'config' && id === 'fonts') { const L = Array.isArray(merged.list) ? merged.list : null; if (!L || L.length > 20 || !L.every(f => isObj(f) && /^[A-Za-z0-9][A-Za-z0-9 \-]{0,39}$/.test(f.n || '') && /^[0-9a-f]{24}$/.test(f.id || ''))) throw E(400, 'bad_data', 'Invalid font list.'); if (new Set(L.map(f => normName(f.n))).size !== L.length) throw E(409, 'duplicate', 'Two fonts have the same name.'); await putDoc('config', 'fonts', { list: L.map(f => ({ n: f.n, id: f.id })) }); return { ok: true }; }
      /* Complaints: resolving needs a reason and a proof picture (shown to the customer) */
      if (col === 'complaints' && old) {
        const st = ['open', 'contacted', 'resolved'].includes(merged.status) ? merged.status : old.status, note = str(merged.note, 160), rpi = /^[0-9a-f]{24}$/.test(merged.rpi || '') ? merged.rpi : '';
        if (st === 'resolved' && old.status !== 'resolved' && (note.length < 3 || !rpi)) throw E(400, 'need_proof', 'To resolve a complaint, write the reason and upload a proof picture.');
        await putDoc('complaints', id, { ...old, status: st, note, ...(rpi ? { rpi } : {}), by: str(merged.by, 30), upAt: Date.now() }); return { ok: true };
      }
      if (col === 'logs') { await putDoc('logs', id, { at: Date.now(), by: c.staff.u, act: str(merged.act, 40), tgt: str(merged.tgt, 160), det: str(merged.det, 400) }); return { ok: true }; }
      if (col === 'coupons' && !/^[A-Z0-9]{1,16}$/.test(id)) throw E(400, 'bad_path', 'Coupon codes use A–Z and 0–9');
      await putDoc(col, id, merged); return { ok: true };
    }
    throw E(400, 'bad_op', 'Unknown action');
  }

  /* ---------- visitor traffic (privacy friendly: no IP address, no name; visitor ids are one-way hashed and kept for one day) ---------- */
  const tzH = () => { const n = Number(process.env.SHOP_TZ_HOURS); return Number.isFinite(n) && n >= -12 && n <= 14 ? n : 7; };
  const dayOf = ts => new Date(ts + tzH() * 3600e3).toISOString().slice(0, 10), hourOf = ts => new Date(ts + tzH() * 3600e3).getUTCHours();
  const dayStart = d => Date.parse(d + 'T00:00:00Z') - tzH() * 3600e3;
  async function apiHit(c) {
    const ua = (c.req.headers.get('user-agent') || '').toLowerCase();
    if (c.staff || !ua || /bot|crawl|spider|slurp|preview|lighthouse|headless|monitor|curl|wget/.test(ua)) return { ok: true };
    const now = Date.now(), day = dayOf(now), hv = hmac('vis:' + c.vid).slice(0, 14), vk = `vis/${day}/${hv}`, vrec = await store.getJSON(vk);
    if (vrec && now - vrec.t < 30 * 60000) return { ok: true }; // same visitor, same visit
    await rlCount(`hit:${c.ip}`, 60, 'ok');
    const sk = `stats/${day}`, st = (await store.getJSON(sk)) || { v: 0, u: 0, h: {} };
    st.v++; if (!vrec) st.u++; const hr = String(hourOf(now)); st.h = st.h || {}; st.h[hr] = (st.h[hr] || 0) + 1;
    await Promise.all([store.setJSON(vk, { t: now }), store.setJSON(sk, st)]);
    return { ok: true };
  }
  async function apiStats(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    const range = ['today', 'week', 'month'].includes(c.url.searchParams.get('range')) ? c.url.searchParams.get('range') : 'today', now = Date.now(), today = dayOf(now);
    const dow = (new Date(dayStart(today) + tzH() * 3600e3).getUTCDay() + 6) % 7; // Monday = 0
    const first = range === 'today' ? today : range === 'week' ? dayOf(dayStart(today) - dow * 864e5) : today.slice(0, 8) + '01';
    const days = []; for (let d = first; d <= today; d = dayOf(dayStart(d) + 864e5 + 3600e3)) days.push(d);
    const docs = await Promise.all(days.map(d => store.getJSON(`stats/${d}`)));
    const rows = days.map((d, i) => ({ d, v: (docs[i] || {}).v || 0, u: (docs[i] || {}).u || 0 }));
    const hours = range === 'today' ? Array.from({ length: 24 }, (_, h) => ((docs[docs.length - 1] || {}).h || {})[h] || 0) : null;
    const from = dayStart(first), orders = (await listCol('orders')).filter(x => x.data.at >= from).length, visits = rows.reduce((s, r) => s + r.v, 0), uniq = rows.reduce((s, r) => s + r.u, 0);
    return { range, from: first, to: today, tz: tzH(), days: rows, hours, visits, visitors: uniq, orders, conv: uniq ? Math.round(orders / uniq * 1000) / 10 : 0 };
  }

  /* ---------- polling support, uploads, sweeps ---------- */
  async function apiRev(c) {
    const cols = String(c.url.searchParams.get('c') || '').split(',').filter(x => COLLECTIONS.has(x)).slice(0, 20), revs = {};
    if (store.listJSON) { const all = await revAll(); cols.forEach(x => { revs[x] = all[x] || '0'; }); } else await Promise.all(cols.map(async x => { revs[x] = await rev(x); }));
    sweep().catch(() => {}); await Promise.race([pkSweep().catch(e => console.error('pickup sweep', e.message)), new Promise(r => setTimeout(r, 8000))]); return { revs };
  }
  let lastSweep = 0;
  async function sweep() {
    const every = opt.sweepEvery ?? 60000; if (Date.now() - lastSweep < every) return; lastSweep = Date.now();
    const dp = dayOf(Date.now()); if (((await store.getJSON('meta/ratepurge')) || {}).d !== dp) { await store.setJSON('meta/ratepurge', { d: dp }); for (const k of (await store.list('cache/rates/')).slice(0, 300)) { const h = await store.getJSON(k); if (!h || Date.now() - h.t > 864e5) await store.del(k); } }
    if (((await store.getJSON('meta/vispurge')) || {}).d !== dp) { await store.setJSON('meta/vispurge', { d: dp }); for (const k of await store.list('vis/')) if (k.split('/')[1] < dp) await store.del(k); }
    const last = await store.getJSON('meta/sweep'); if (last && Date.now() - last.t < every) return; await store.setJSON('meta/sweep', { t: Date.now() });
    const cfg = await cfgAll(), orders = await listCol('orders'), stat = new Map((await listCol('status')).map(d => [d.id, d.data]));
    for (const { id, data: o } of orders) {
      if (o.ref || o.proof || Date.now() < Math.max(o.at, +o.rjAt || 0) + payMs(o, cfg)) continue; const s = stat.get(id); if (s && typeof s.s === 'number' && s.s !== 0) continue;
      await putDoc('status', id, { s: -1, t: Date.now(), note: `Payment not received within ${payTxt(o, cfg)}`, auto: true }); await releaseCoupon(id);
      await slog('order.cancel', `Order #${id} · ${o.name}`, `Auto-cancelled: no payment within ${payTxt(o, cfg)}`, 'system');
    }
    if (+cfg.fdev.fe > 0 && +cfg.fdev.fe <= Date.now()) { await fdArchive(cfg.fdev, null, 'system'); await putDoc('config', 'fdev', { ...cfg.fdev, fs: 0, fe: 0 }); }
    for (const { id, data: d } of await listCol('menu')) { const f = fsOfDoc(d); if (!f || f.fe > Date.now()) continue; const nd = { ...d }; delete nd.fp; delete nd.fs; delete nd.fe; await flashArchive(id, d, nd, 'system'); await putDoc('menu', id, nd); }
    const keepProof = Date.now() - 120 * 864e5, keepCmp = Date.now() - 180 * 864e5;
    for (const d of (await listCol('proofs')).filter(x => x.data.at < keepProof).slice(0, 100)) await delDoc('proofs', d.id);
    for (const d of (await listCol('cmpimgs')).slice(0, 300)) { const cm = await getDoc('complaints', d.data.no); if (!cm || cm.at < keepCmp) await delDoc('cmpimgs', d.id); }
    const lc = (await getDoc('config', 'logcfg')) || {}, cut = Date.now() - Math.min(90, Math.max(1, +lc.days || 90)) * 864e5, old = (await listCol('logs')).filter(d => d.data.at < cut).slice(0, 200);
    for (const d of old) await store.del(dk('logs', d.id)); if (old.length) await touch('logs');
  }
  const BIN_TYPES = { 'audio/mpeg': 1, 'audio/wav': 1, 'audio/x-wav': 1, 'audio/wave': 1, 'audio/ogg': 1, 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'video/mp4': 1, 'video/webm': 1, 'video/quicktime': 1, 'font/woff2': 1, 'font/woff': 1, 'font/ttf': 1, 'font/otf': 1 };
  const FONT_MAGIC = { 'font/woff2': [0x77, 0x4f, 0x46, 0x32], 'font/woff': [0x77, 0x4f, 0x46, 0x46], 'font/ttf': [0, 1, 0, 0], 'font/otf': [0x4f, 0x54, 0x54, 0x4f] };
  async function apiUpload(c) {
    if (!c.any('p', 'k', 'f', 'cm') && !c.owner()) throw E(403, 'forbidden', 'You do not have access to do that.');
    if (c.req.method === 'DELETE') { const id = String(c.url.searchParams.get('id') || ''); if (!/^[0-9a-f]{24}$/.test(id)) throw E(400, 'bad_id', 'Invalid id'); await store.del('bin/' + id); await store.del('binmeta/' + id); return { ok: true }; }
    let type = (c.req.headers.get('content-type') || '').split(';')[0].trim(); if (!BIN_TYPES[type]) throw E(415, 'bad_type', 'Only JPG, PNG, WebP, GIF, MP4, WebM, font (WOFF2, WOFF, TTF, OTF) or sound (MP3, WAV, OGG) files can be uploaded.');
    if (type.startsWith('font/') && !c.owner()) throw E(403, 'forbidden', 'Only the owner can upload fonts.');
    if (type.startsWith('audio/') && !c.owner()) throw E(403, 'forbidden', 'Only the owner can upload sounds.');
    const buf = await c.req.arrayBuffer(); if (buf.byteLength > (type.startsWith('font/') ? 1.5 : 4.5) * 1048576) throw E(413, 'too_large', `The file is larger than ${type.startsWith('font/') ? '1.5' : '4.5'} MB.`); if (!buf.byteLength) throw E(400, 'empty', 'Empty file');
    if (type.startsWith('audio/')) { if (buf.byteLength > 400 * 1024) throw E(413, 'too_large', 'The sound file is larger than 400 KB.'); const h = new Uint8Array(buf.slice(0, 4)), tx = String.fromCharCode(...h); if (!(tx === 'RIFF' || tx === 'OggS' || tx.startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0))) throw E(415, 'bad_type', 'That file is not an MP3, WAV or OGG sound.'); }
    if (type.startsWith('font/')) { /* the file's own signature decides (a .ttf may really be OpenType, and the other way round) */
      const h = new Uint8Array(buf.slice(0, 4)), sig = String.fromCharCode(...h), kind = h[0] === 0 && h[1] === 1 && h[2] === 0 && h[3] === 0 ? 'font/ttf' : sig === 'true' ? 'font/ttf' : sig === 'OTTO' ? 'font/otf' : sig === 'wOFF' ? 'font/woff' : sig === 'wOF2' ? 'font/woff2' : '';
      if (!kind) throw E(415, 'bad_type', sig === 'ttcf' ? 'Font collections (.ttc) are not supported. Please upload a single .ttf, .otf, .woff or .woff2 font.' : 'That file is not a valid font.'); type = kind; }
    const id = rid(12); try { await store.setBin('bin/' + id, buf, type); } catch (e) { console.error('upload', e.message); if (/mime|415|invalid_mime|not supported|415/i.test(String(e.message))) throw E(415, 'storage_type', 'Your storage does not accept this kind of file yet. In Supabase, open the SQL editor and run supabase/migrations/0002_fonts_sounds.sql, then try again.'); throw e; } await store.setJSON('binmeta/' + id, { type, size: buf.byteLength, by: c.staff.u, at: Date.now() }); return { id, url: '/_blob/' + id };
  }
  async function serveBlob(id) {
    if (!/^[0-9a-f]{24}$/.test(id)) return new Response('Not found', { status: 404 });
    const meta = await store.getJSON('binmeta/' + id), data = meta && await store.getBin('bin/' + id); if (!data) return new Response('Not found', { status: 404 });
    return new Response(data, { status: 200, headers: { 'content-type': meta.type, 'cache-control': 'public, max-age=31536000, immutable', 'netlify-cdn-cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
  }

  /* ---------- Marketing: product feed (Google Merchant Center + Meta catalog), product pages, sitemap, product clicks ---------- */
  const xe = v => String(v == null ? '' : v).replace(/[<>&"']/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m])), slugOf = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  async function mktItems(origin) {
    const [menu, cats, cfg, pd] = [await listCol('menu'), await listCol('cats'), await cfgDoc('mkt', DEF.mkt), await getDoc('config', 'pdet')], now = Date.now(), byId = new Map(menu.map(d => [d.id, d.data])), cname = {};
    for (const d of cats) if (d.data && d.data.name) cname[d.id] = d.data.name;
    const secs = (pd && Array.isArray(pd.secs) ? pd.secs : []).filter(x => x.on !== false), notes = Object.fromEntries((pd && Array.isArray(pd.notes) ? pd.notes : []).map(n => [n.id, n.n])), items = [], skipped = [], seen = new Set();
    const mk = (base, d, id) => {
      d = d || {}; const n = d.n || (base && base.n) || 'Item'; if (d.off || d.del) { skipped.push({ id, n, why: 'hidden' }); return; }
      const imgs = (Array.isArray(d.imgs) ? d.imgs : []).filter(x => okMedia(String(x))).map(x => /^https:/.test(x) ? x : `${origin}/_blob/${x}`), reg = +d.price > 0 ? +d.price : base ? base.p : +d.p || 0, fl = +d.fp > 0 && +d.fs > 0 && +d.fe > 0 && now >= +d.fs && now < +d.fe;
      const extra = []; if (d.dx && typeof d.dx === 'object') for (const x of secs) { const v = d.dx[x.id]; if (v == null) continue; if (x.t === 'lv') extra.push(`${x.n}: ${v}/${x.cnt || 5}`); else if (x.t === 'nt' && Array.isArray(v)) { const L = v.map(k => notes[k]).filter(Boolean); if (L.length) extra.push(`${x.n}: ${L.join(', ')}`); } else if (x.t === 'tx' && typeof v === 'string' && v.trim()) extra.push(`${x.n}: ${v.trim()}`); }
      const o = { id: String(id), n, desc: [d.d || (base && base.d) || n, ...extra].join('. ').slice(0, 4800), cat: d.c || (base && (cname['b_' + String(base.c).replace(/[^A-Za-z0-9]/g, '')] || base.c)) || 'Other', price: reg, sale: fl ? +d.fp : 0, saleFrom: fl ? +d.fs : 0, saleTo: fl ? +d.fe : 0, imgs,
        stock: (+d.sou > now) || (typeof d.stock === 'number' && d.stock <= 0) ? 0 : 1, link: `${origin}/p/${id}-${slugOf(n)}` };
      if (!(o.price > 0)) { skipped.push({ id, n, why: 'no price' }); return; } items.push(o);
    };
    for (const b of CATALOG) { seen.add(String(b.id)); mk(b, byId.get(String(b.id)), b.id); }
    for (const d of menu) if (!seen.has(d.id) && d.data && d.data.custom) mk(null, d.data, d.id);
    return { items, skipped, cfg };
  }
  const siteOf = (cfg, url) => cfg.site || url.origin;
  /* ---------- Home page for search engines and AI assistants: the page itself plus the shop's real details (LocalBusiness, FAQ, menu) written into the HTML ---------- */
  let SITEC = null;
  async function siteFile() {
    if (SITEC) return SITEC;
    const bases = [process.env.LAMBDA_TASK_ROOT, process.cwd(), pth.resolve(pth.dirname(new URL(import.meta.url).pathname), '..', '..')].filter(Boolean);
    for (const b of bases) { try { const html = await fsp.readFile(pth.join(b, 'public/index.html'), 'utf8'); let hd = {}; try { const t = await fsp.readFile(pth.join(b, 'netlify.toml'), 'utf8'), m = /for = "\/\*"\s*\[headers\.values\]([\s\S]*?)(?:\n\[|$)/.exec(t); if (m) for (const l of m[1].split('\n')) { const k = /^\s*([A-Za-z-]+) = "(.*)"\s*$/.exec(l); if (k) hd[k[1].toLowerCase()] = k[2]; } } catch (e) { /* no toml next to the page */ } return (SITEC = { html, hd }); } catch (e) { /* try the next folder */ } }
    return null;
  }
  const HDAYN = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' }, HDAYK = Object.keys(HDAYN);
  const hoursOf = h => String(h || '').split('\n').map(x => /^(\w\w)(?:-(\w\w))? (\d\d:\d\d)-(\d\d:\d\d)$/.exec(x.trim())).filter(Boolean).map(m => { const a = HDAYK.indexOf(m[1]), b = m[2] ? HDAYK.indexOf(m[2]) : a, L = []; if (a < 0 || b < 0) return null; for (let i = a; L.length < 8; i = (i + 1) % 7) { L.push(HDAYN[HDAYK[i]]); if (i === b) break; } return { days: L, o: m[3], c: m[4], txt: `${L.length > 1 ? L[0] + ' to ' + L[L.length - 1] : L[0]} ${m[3]}–${m[4]}` }; }).filter(Boolean);
  async function homeBits(url) {
    const mk0 = await cfgDoc('mkt', DEF.mkt), origin = siteOf(mk0, url), [loc, faq, foot, { items }] = [(await getDoc('config', 'loc')) || {}, (await getDoc('config', 'faq')) || {}, (await getDoc('config', 'foot')) || {}, await mktItems(origin)];
    const brand = loc.on && loc.name ? loc.name : mk0.brand, desc = (loc.on && loc.desc) || `Order fresh ${brand} bakes online for delivery or pickup.`, faqs = faq.on ? (faq.items || []) : [], hrs = hoursOf(loc.hours);
    const same = (Array.isArray(foot.ln) ? foot.ln : []).map(x => x && x.u).filter(u => /^https:\/\//.test(u || '')).slice(0, 10), geo = loc.on && +loc.lat && +loc.lng;
    return { origin, loc, faqs, brand, desc, hrs, same, geo, items, mk0 };
  }
  const homeLd = b => {
    const { origin, loc, faqs, brand, desc, hrs, same, geo } = b, g = [];
    if (loc.on) g.push({ '@context': 'https://schema.org', '@type': loc.type || 'Bakery', name: brand, url: origin + '/', description: desc, ...(loc.img ? { image: loc.img } : {}), ...(loc.phone ? { telephone: loc.phone } : {}), ...(loc.price ? { priceRange: loc.price } : {}),
      address: { '@type': 'PostalAddress', ...(loc.street ? { streetAddress: loc.street } : {}), ...(loc.city ? { addressLocality: loc.city } : {}), ...(loc.region ? { addressRegion: loc.region } : {}), ...(loc.pc ? { postalCode: loc.pc } : {}), addressCountry: 'ID' },
      ...(geo ? { geo: { '@type': 'GeoCoordinates', latitude: +loc.lat, longitude: +loc.lng }, hasMap: `https://www.google.com/maps?q=${loc.lat},${loc.lng}` } : {}),
      ...(hrs.length ? { openingHoursSpecification: hrs.map(h => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.days.map(d => 'https://schema.org/' + d), opens: h.o, closes: h.c })) } : {}),
      ...(() => { const ar = String(loc.areas || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 15).map(n => ({ '@type': 'AdministrativeArea', name: n })); return geo && +loc.rad > 0 ? { areaServed: [{ '@type': 'GeoCircle', geoMidpoint: { '@type': 'GeoCoordinates', latitude: +loc.lat, longitude: +loc.lng }, geoRadius: Math.round(loc.rad * 1000) }, ...ar] } : ar.length ? { areaServed: ar } : {}; })(), ...(same.length ? { sameAs: same } : {}), potentialAction: { '@type': 'OrderAction', target: origin + '/' } });
    g.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: brand, url: origin + '/' });
    if (faqs.length) g.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) });
    return g;
  };
  const homeText = b => {
    const { origin, loc, faqs, brand, desc, hrs, items } = b, price = i => 'Rp ' + Math.round(i.sale && i.sale < i.price ? i.sale : i.price).toLocaleString('id-ID');
    const addr = [loc.street, loc.city, loc.region, loc.pc].filter(Boolean).join(', ');
    return `<noscript><main style="font:16px/1.5 system-ui,sans-serif;max-width:680px;margin:auto;padding:16px"><h1>${xe(brand)}</h1><p>${xe(desc)}</p>${loc.on && (addr || loc.phone || hrs.length || loc.areas) ? `<h2>Visit and delivery</h2><ul>${addr ? `<li>Address: ${xe(addr)}</li>` : ''}${loc.phone ? `<li>Phone / WhatsApp: ${xe(loc.phone)}</li>` : ''}${hrs.map(h => `<li>Open ${xe(h.txt)}</li>`).join('')}${+loc.rad > 0 ? `<li>We deliver within ${xe(loc.rad)} km of the shop</li>` : ''}${loc.areas ? `<li>Areas: ${xe(loc.areas)}</li>` : ''}</ul>` : ''}${items.length ? `<h2>Menu</h2><ul>${items.slice(0, 60).map(i => `<li><a href="${xe(i.link)}">${xe(i.n)}</a> – ${price(i)}${i.stock ? '' : ' (sold out for now)'}</li>`).join('')}</ul>` : ''}${faqs.length ? `<h2>Questions and answers</h2>${faqs.map(x => `<h3>${xe(x.q)}</h3><p>${xe(x.a)}</p>`).join('')}` : ''}<p>Please turn on JavaScript to order online at <a href="${xe(origin)}/">${xe(origin)}</a>.</p></main></noscript>`;
  };
  async function homeRoute(req, url) {
    const site = await siteFile(); if (!site) return new Response(null, { status: 302, headers: { location: '/index.html' } });
    let html = site.html;
    try {
      if (isAdminHost(url.hostname)) throw new Error('staff address: the page as it is');
      const b = await homeBits(url), { origin, loc, desc } = b, t = x => `${x}`, M = (k, n, v) => `<meta ${k}="${xe(n)}" content="${xe(v)}" data-ssr="1">`;
      let head = `<link rel="canonical" href="${xe(origin)}/" data-ssr="1">`;
      if (loc.on || b.faqs.length) {
        html = html.replace(/<meta name="description"[^>]*>/, '').replace(/<meta property="og:description"[^>]*>/, '');
        head += M('name', 'description', desc) + M('property', 'og:description', desc) + M('property', 'og:url', origin + '/') + M('property', 'og:locale', 'id_ID') + (loc.img ? M('property', 'og:image', loc.img) : '');
        if (loc.on) { head += (loc.city || loc.region ? M('name', 'geo.placename', [loc.city, loc.region].filter(Boolean).join(', ')) : '') + M('name', 'geo.region', 'ID') + (b.geo ? M('name', 'geo.position', `${loc.lat};${loc.lng}`) + M('name', 'ICBM', `${loc.lat}, ${loc.lng}`) : ''); }
      }
      head += homeLd(b).map(o => `<script type="application/ld+json" data-ssr="1">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('');
      html = html.replace('</head>', () => head + '</head>').replace('<body>', () => '<body>' + homeText(b));
    } catch (e) { if (!/^staff address/.test(e.message)) console.error('home page', e.message); html = site.html; }
    return new Response(req.method === 'HEAD' ? null : html, { status: 200, headers: { ...site.hd, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, s-maxage=120, stale-while-revalidate=600' } });
  }
  /* llms.txt: a short plain-text summary for AI assistants */
  async function llmsText(url) {
    const b = await homeBits(url), { origin, loc, faqs, brand, desc, hrs, items } = b, addr = [loc.street, loc.city, loc.region, loc.pc].filter(Boolean).join(', ');
    const L = [`# ${brand}`, '', `> ${desc}`, '', '## About'];
    if (addr) L.push(`- Address: ${addr}`); if (loc.phone) L.push(`- Phone / WhatsApp: ${loc.phone}`); for (const h of hrs) L.push(`- Open: ${h.txt}`);
    if (loc.on && +loc.rad > 0) L.push(`- Delivery: within ${loc.rad} km of the shop`); if (loc.on && loc.areas) L.push(`- Delivery areas: ${loc.areas}`);
    L.push('- Ordering: online at ' + origin + '/ for delivery or pickup; payment is confirmed in the shop.', '', '## Pages', `- [Order online](${origin}/)`, `- [Sitemap](${origin}/sitemap.xml)`, `- [Product feed](${origin}/feed.xml)`);
    if (items.length) { L.push('', '## Menu'); for (const i of items.slice(0, 80)) L.push(`- [${i.n.replace(/[\[\]]/g, '')}](${i.link}): Rp ${Math.round(i.sale && i.sale < i.price ? i.sale : i.price).toLocaleString('id-ID')}${i.stock ? '' : ' (sold out for now)'}`); }
    if (faqs.length) { L.push('', '## FAQ'); for (const x of faqs) L.push('', `**${x.q}**`, x.a); }
    return L.join('\n') + '\n';
  }

  const idr = v => (Math.round(+v) || 0).toFixed(2) + ' IDR';
  async function seoRoute(req, url, path) {
    const { items, skipped, cfg } = await mktItems(siteOf((await cfgDoc('mkt', DEF.mkt)), url)), origin = siteOf(cfg, url), xml = 'application/xml; charset=utf-8';
    const hdr = (t, extra = {}) => ({ 'content-type': t, 'cache-control': 'public, max-age=300', ...extra });
    if (path === '/robots.txt') { const dev = isAdminHost(url.hostname) || (/\.netlify\.app$|^localhost$/.test(url.hostname) && !(cfg.site && url.origin === cfg.site)); return new Response(dev ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /admin\nDisallow: /affiliate\nDisallow: /api/\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, { status: 200, headers: hdr('text/plain; charset=utf-8') }); }
    if (!cfg.on) return new Response('Not found', { status: 404 });
    if (path === '/llms.txt') { if (isAdminHost(url.hostname) || (/\.netlify\.app$|^localhost$/.test(url.hostname) && !(cfg.site && url.origin === cfg.site))) return new Response('Not found', { status: 404 }); return new Response(await llmsText(url), { status: 200, headers: hdr('text/plain; charset=utf-8') }); }
    if (path === '/feed.xml') {
      const rows = items.filter(i => i.imgs.length).map(i => `<item><g:id>${xe(i.id)}</g:id><title>${xe(i.n.slice(0, 150))}</title><description>${xe(i.desc)}</description><link>${xe(i.link)}</link><g:image_link>${xe(i.imgs[0])}</g:image_link>${i.imgs.slice(1, 10).map(x => `<g:additional_image_link>${xe(x)}</g:additional_image_link>`).join('')}<g:availability>${i.stock ? 'in stock' : 'out of stock'}</g:availability><g:price>${idr(i.price)}</g:price>${i.sale && i.sale < i.price ? `<g:sale_price>${idr(i.sale)}</g:sale_price><g:sale_price_effective_date>${new Date(i.saleFrom).toISOString()}/${new Date(i.saleTo).toISOString()}</g:sale_price_effective_date>` : ''}<g:brand>${xe(cfg.brand)}</g:brand><g:condition>new</g:condition><g:identifier_exists>no</g:identifier_exists><g:google_product_category>${xe(cfg.gcat)}</g:google_product_category><g:product_type>${xe(i.cat)}</g:product_type></item>`).join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xe(cfg.brand)}</title><link>${xe(origin)}</link><description>${xe(cfg.brand)} products</description>${rows}</channel></rss>`, { status: 200, headers: hdr(xml) });
    }
    if (path === '/sitemap.xml') return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xe(origin)}/</loc></url>${items.map(i => `<url><loc>${xe(i.link)}</loc></url>`).join('')}</urlset>`, { status: 200, headers: hdr(xml) });
    const m = /^\/p\/(\d{1,15})(?:-[a-z0-9-]*)?$/.exec(path), it = m && items.find(i => i.id === m[1]);
    if (!it) return new Response('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><p style="font:18px system-ui;text-align:center;margin:40px">Product not found. <a href="/">Back to the shop</a></p>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (path !== `/p/${it.id}-${slugOf(it.n)}`) return new Response(null, { status: 301, headers: { location: it.link } });
    const price = it.sale && it.sale < it.price ? it.sale : it.price, img = it.imgs[0] || '', ld = { '@context': 'https://schema.org', '@type': 'Product', name: it.n, description: it.desc, sku: it.id, brand: { '@type': 'Brand', name: cfg.brand }, ...(it.imgs.length ? { image: it.imgs } : {}), offers: { '@type': 'Offer', url: it.link, priceCurrency: 'IDR', price: String(Math.round(price)), itemCondition: 'https://schema.org/NewCondition', availability: it.stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } };
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xe(it.n)} – ${xe(cfg.brand)}</title><meta name="description" content="${xe(it.desc.slice(0, 300))}"><link rel="canonical" href="${xe(it.link)}">
<meta property="og:type" content="product"><meta property="og:title" content="${xe(it.n)}"><meta property="og:description" content="${xe(it.desc.slice(0, 300))}"><meta property="og:url" content="${xe(it.link)}">${img ? `<meta property="og:image" content="${xe(img)}">` : ''}<meta property="product:price:amount" content="${Math.round(price)}"><meta property="product:price:currency" content="IDR"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#fffaf0;color:#2b0d09}main{max-width:480px;margin:auto;padding:16px}img{width:100%;border-radius:18px}h1{margin:12px 0 4px}.pr{font-size:22px;font-weight:700;color:#a8231a}a.b{display:block;text-align:center;background:#a8231a;color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:14px;margin:16px 0}</style></head><body><main>${img ? `<img src="${xe(img)}" alt="${xe(it.n)}">` : ''}<h1>${xe(it.n)}</h1><div class="pr">Rp ${Math.round(price).toLocaleString('id-ID')}</div><p>${xe(it.desc)}</p><p>${it.stock ? 'In stock' : 'Sold out for now'}</p><a class="b" href="/#/p/${it.id}">Order ${xe(it.n)}</a><a href="/">${xe(cfg.brand)} – all products</a></main>
<script>if(!/bot|crawl|spider|slurp|facebookexternalhit|facebot|meta-external|preview|lighthouse/i.test(navigator.userAgent))location.replace('/#/p/${it.id}')</script></body></html>`;
    return new Response(html, { status: 200, headers: hdr('text/html; charset=utf-8') });
  }
  /* product clicks (opened / added to cart), counted per day without any visitor data */
  async function apiPview(c) {
    const b = await bodyOf(c.req, 2000), id = String(b.id || ''), t = b.t === 'a' ? 'a' : 'v'; if (!/^\d{1,15}$/.test(id)) throw E(400, 'bad_id', 'Invalid product.');
    const ua = (c.req.headers.get('user-agent') || '').toLowerCase(); if (c.staff || !ua || /bot|crawl|spider|slurp|preview|lighthouse|headless|monitor|curl|wget/.test(ua)) return { ok: true };
    await rlCount(`pv:${c.ip}`, 400, 'ok'); const k = `stats/pv/${dayOf(Date.now())}`, d = (await store.getJSON(k)) || {}; d[id] = d[id] || { v: 0, a: 0 }; d[id][t]++; await store.setJSON(k, d); return { ok: true };
  }
  async function apiPclicks(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    const sp = c.url.searchParams, now = Date.now(), a = Math.max(+sp.get('from') || 0, now - 92 * 864e5), b = Math.min(+sp.get('to') || now, now + 864e5), days = [];
    for (let d = dayOf(a); d <= dayOf(Math.max(a, b - 1)) && days.length < 95; d = dayOf(dayStart(d) + 864e5 + 3600e3)) days.push(d);
    const docs = await Promise.all(days.map(d => store.getJSON(`stats/pv/${d}`))), tot = {};
    for (const d of docs) for (const [id, x] of Object.entries(d || {})) { tot[id] = tot[id] || { v: 0, a: 0 }; tot[id].v += x.v || 0; tot[id].a += x.a || 0; }
    const menu = new Map((await listCol('menu')).map(d => [d.id, d.data])), top = Object.entries(tot).map(([id, x]) => { const base = CATALOG.find(q => String(q.id) === id), d = menu.get(id) || {}; return { id, n: d.n || (base && base.n) || '(removed product)', e: d.e || (base && base.e) || '🍽️', img: (d.imgs || [])[0] || '', v: x.v, a: x.a }; }).sort((p, q) => q.v - p.v || q.a - p.a).slice(0, 15);
    return { top, v: top.reduce((t, x) => t + x.v, 0) };
  }
  /* Meta Conversions API: a Purchase event when a payment is confirmed (same event id as the browser, so Meta counts it once) */
  async function capiPurchase(o) {
    const cf = await cfgDoc('mkt', DEF.mkt), sec = (await store.getJSON('sec/mkt')) || {}, tok = String(sec.token || process.env.META_CAPI_TOKEN || '').trim(); if (!cf.px || !tok || !o) return;
    const h = v => crypto.createHash('sha256').update(String(v || '').trim().toLowerCase()).digest('hex'), ph = nwa(o.phone);
    const ev = { event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: o.no, action_source: 'website', event_source_url: cf.site || undefined, user_data: { ...(o.email ? { em: [h(o.email)] } : {}), ...(ph ? { ph: [h(ph)] } : {}), ...(o.name ? { fn: [h(String(o.name).split(' ')[0])] } : {}), country: [h('id')] }, custom_data: { currency: 'IDR', value: +o.total || 0, content_type: 'product', content_ids: (o.items || []).map(i => String(i.id)), num_items: (o.items || []).reduce((t, i) => t + (+i.q || 0), 0), order_id: o.no } };
    const r = await F(`https://graph.facebook.com/v19.0/${cf.px}/events?access_token=${encodeURIComponent(tok)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: [ev], ...(sec.test ? { test_event_code: sec.test } : {}) }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('capi ' + r.status); return r.json().catch(() => ({}));
  }
  async function apiMkt(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.');
    const sec = (await store.getJSON('sec/mkt')) || {}, b = c.req.method === 'POST' ? await bodyOf(c.req) : {};
    if (b.op === 'key') { const k = String(b.key || '').trim(); if (k && (k.length < 30 || k.length > 600 || /\s/.test(k))) throw E(400, 'bad_key', 'That does not look like a Meta access token. Copy it again from Events Manager.'); if (k) sec.token = k; else delete sec.token; sec.test = /^[A-Za-z0-9_-]{3,30}$/.test(b.test || '') ? b.test : ''; sec.kat = Date.now(); await store.setJSON('sec/mkt', sec); await slog('set.cfg', 'Marketing', k ? 'Meta Conversions API token saved (…' + k.slice(-4) + ')' : 'Meta Conversions API token removed', c.staff.u); }
    if (b.op === 'test') { try { const r = await capiPurchase({ no: 'TEST' + rid(3).toUpperCase(), email: 'test@example.com', phone: '08120000000', name: 'Test', total: 1000, items: [{ id: 1, q: 1 }] }); return r === undefined ? { err: 'Add the Pixel ID and the access token first.' } : { ok: true, r }; } catch (e) { return { err: 'Meta did not accept the test: ' + String(e.message).slice(0, 80) }; } }
    const env = String(process.env.META_CAPI_TOKEN || '').trim(), k = sec.token || env; const cf = await cfgDoc('mkt', DEF.mkt); return { key: !!k, src: sec.token ? 'saved' : env ? 'env' : '', end: k ? k.slice(-4) : '', test: sec.test || '', shop: cf.site || HOSTS.shop[c.host] || '' };
  }
  /* reward vouchers chosen at checkout: several per order only when the owner allows it, each one needing its own requirement, never above the owner's maximum */
  async function rewardsCheck(codes, sub0, ctx, regular) {
    const L = [...new Set((Array.isArray(codes) ? codes : []).map(x => String(x || '').toUpperCase()).filter(Boolean))].slice(0, 12); if (!L.length) return { specs: [] };
    const bb = await cfgDoc('bb', DEF.bb), cap = bb.ur === true ? Math.max(1, +bb.uc || 1) : 1; if (L.length > cap) throw E(400, 'reward', cap === 1 ? 'You can use 1 reward per order.' : `You can use up to ${cap} rewards per order.`);
    const specs = []; let min = 0, box = 0; const per = {};
    for (const code of L) {
      if (code === String(regular || '').toUpperCase()) throw E(400, 'reward', 'That code is already used as a coupon.'); const r = await couponCheck(code, sub0, ctx); if (r.err) throw E(400, 'coupon', r.err); if (!r.d.bb) throw E(400, 'reward', 'Only rewards can be added here.');
      min += +r.d.min || 0; box += +r.d.box || 0; let v = +r.d.v, t = r.d.type === 'pct' ? 'pct' : 'amt';
      if (r.d.type === 'item') { const it = ctx.items.find(i => String(i.id) === String(r.d.pid)); per[r.d.pid] = (per[r.d.pid] || 0) + 1; if (per[r.d.pid] > it.q) throw E(400, 'reward', `Add one more ${r.d.n || 'reward item'} to your cart to use both rewards.`); v = it.u; }
      specs.push({ c: code, t, v, ...(r.d.type === 'gift' ? { g: { n: r.d.n || 'Special', img: r.d.img || '' } } : {}) });
    }
    if (specs.length > 1) { if (min > sub0) throw E(400, 'reward', `To use ${specs.length} rewards you need Rp ${min.toLocaleString('id-ID')} in your cart (each reward needs its own minimum).`); const pcs = ctx.items.reduce((n, i) => n + boxPcs(i) * i.q, 0); if (box > pcs) throw E(400, 'reward', `To use ${specs.length} rewards you need ${box} pieces in gift boxes (each reward needs its own box).`); }
    return { specs };
  }
  /* a customer typing a coupon code: checked one at a time, with the Turnstile check and a try limit so codes cannot be guessed */
  async function apiCoupon(c) {
    const b = await bodyOf(c.req, 2000); await rlCount(`cpn:${c.ip}`, 40, 'Too many coupon tries. Please wait a few minutes.'); await tsCheck(c, b, 'cp');
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30), d = code ? await getDoc('coupons', code) : null; if (!d) return { exists: false };
    const ar = d.aff ? await store.getJSON('sec/affu/' + d.aff) : null, used = ((await store.getJSON('meta/rc/' + code)) || { n: 0 }).n; return { exists: true, id: code, data: { type: d.type, v: ar ? sacOf(ar, await affCfg()).disc : d.v, min: d.min, max: d.max, exp: d.pl ? await plExp(d) : d.exp, hint: d.hint, used, ...(d.bb ? { bb: d.bb, box: d.box || 0, pid: d.pid || 0, n: d.n || '' } : {}) } };
  }
  /* ---------- Blindbox: a chance to win a prize when an order is big enough; the prize is locked to the order and the WhatsApp number ---------- */
  const okBlobId = v => /^[0-9a-f]{24}$/.test(String(v || '')) ? v : '', num2 = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round((+v || 0) * 100) / 100));
  function bbClean(m, kind) {
    const pp = isObj(m.pop) ? m.pop : {}, ln = String(pp.ln || '').trim();
    return { ...(kind === 'rv' ? { days: Math.max(1, Math.min(60, Math.floor(+m.days || 7))), n: Math.max(1, Math.min(5, Math.floor(+m.n || 1))), min: Math.max(1, Math.min(5, Math.floor(+m.min || 5))) } : { uc: Math.max(1, Math.min(10, Math.floor(+m.uc || 1))), ur: m.ur === true }), on: m.on === true, name: str(m.name, 30) || (kind === 'rv' ? 'Review Box' : 'Blindbox'), fs: Math.max(0, Math.floor(+m.fs || 0)), fe: Math.max(0, Math.floor(+m.fe || 0)), amt: Math.max(0, Math.min(1e9, Math.floor(+m.amt || 0))), box: Math.max(0, Math.min(24, Math.floor(+m.box || 0))), cap: Math.max(0, Math.min(50, Math.floor(+m.cap || 0))), rep: m.rep !== false, ar: m.ar === true, mx: Math.max(1, Math.min(50, Math.floor(+m.mx || 10))), ch: m.ch === true, msg: str(m.msg, 140),
      rw: (Array.isArray(m.rw) ? m.rw : []).slice(0, 30).filter(isObj).map(r => ({ id: /^[a-z0-9]{3,12}$/.test(r.id || '') ? r.id : rid(3), t: ['prod', 'coupon', 'special', 'none'].includes(r.t) ? r.t : 'none', n: str(r.n, 40), w: num2(r.w, 0, 100), pid: Math.max(0, Math.floor(+r.pid || 0)), c: { type: isObj(r.c) && r.c.type === 'amt' ? 'amt' : 'pct', v: num2(isObj(r.c) ? r.c.v : 0, 0, 1e9), min: Math.max(0, Math.floor(+(isObj(r.c) ? r.c.min : 0) || 0)), box: Math.max(0, Math.min(24, Math.floor(+(isObj(r.c) ? r.c.box : 0) || 0))) }, d: Math.max(1, Math.min(365, Math.floor(+r.d || 7))), max: Math.max(0, Math.min(100000, Math.floor(+r.max || 0))), img: okMedia(String(r.img || '').trim()) ? String(r.img).trim() : '' })),
      pop: { tt: str(pp.tt, 60), st: str(pp.st, 80), wt: str(pp.wt, 60), lt: str(pp.lt, 60), lm: str(pp.lm, 120), bi: okBlobId(pp.bi), oi: okBlobId(pp.oi), li: okBlobId(pp.li), ln: /^https:\/\/[^\s"'<>]{4,190}$/.test(ln) ? ln : '', lb: str(pp.lb, 30), col: /^#[0-9a-fA-F]{6}$/.test(pp.col || '') ? pp.col : '' } };
  }
  const pubBb = d => ({ days: d.days, n: d.n, min: d.min, uc: d.uc || 1, ur: d.ur === true, on: d.on === true, name: d.name, fs: d.fs, fe: d.fe, amt: d.amt, box: d.box, rep: d.rep !== false, ar: d.ar === true, mx: d.mx || 10, ch: !!d.ch, msg: d.msg, pop: d.pop || {}, rw: (d.rw || []).map(r => ({ id: r.id, t: r.t, n: r.n, img: r.img, pid: r.pid, c: r.c, d: r.d, ...(d.ch ? { w: r.w } : {}) })) });
  const bbLive = (bb, t) => bb.on === true && !(bb.fs && t < bb.fs) && !(bb.fe && t >= bb.fe), boxPcs = i => (i.bx || []).reduce((n, x) => n + x.q, 0);
  /* how many Blindboxes an order earns: gift boxes (repeating per N pieces) plus the minimum purchase; with the gift box rule on, the money rule counts regular items only */
  function bbCount(bb, items, td) {
    let n = 0; const lines = items.filter(i => i.bx), money = l => l.reduce((t, i) => t + i.u * i.q, 0);
    if (bb.box > 0) n += bb.rep === false ? (lines.some(i => boxPcs(i) >= bb.box) ? 1 : 0) : lines.reduce((t, i) => t + Math.floor(boxPcs(i) / bb.box) * i.q, 0);
    if (bb.amt > 0) { const all = money(items), b0 = bb.box > 0 ? money(items.filter(i => !i.bx)) : all, base = all > 0 ? b0 - Math.round(td * b0 / all) : 0; if (base >= bb.amt) n += bb.ar === true ? Math.floor(base / bb.amt) : 1; }
    return Math.min(n, bb.mx > 0 ? bb.mx : 50);
  }
  /* two campaigns share one engine: the Blindbox (earned with an order) and the Review Box (earned by rating every item 5 stars) */
  const CPN = { bb: { cfg: 'bb', n: o => +o.bbn || (o.bbq ? 1 : 0), o: 'bbo', pre: '', wins: 'meta/bbwins', cap: 'bbcap', code: 'BB', lbl: 'Blindbox' }, rv: { cfg: 'rrw', n: o => +o.rvn || 0, o: 'rvo', pre: 'rv-', wins: 'meta/rvwins', cap: 'rvcap', code: 'RV', lbl: 'Review Box' } };
  const bbN = (o, K = CPN.bb) => K.n(o);
  const bbRecs = async (no, n, K = CPN.bb) => { const L = []; for (let i = 0; i < n; i++) { const r = (await store.getJSON(`sec/bbw/${K.pre}${no}-${i}`)) || (i === 0 && !K.pre ? await store.getJSON('sec/bbw/' + no) : null); if (!r) break; L.push({ ...r, i }); } return L; };
  /* what the customer may do with their boxes and rewards right now */
  async function bbState(o, recs, K = CPN.bb) {
    const st = await stageOf(o.no), pay = st < 0 ? 'void' : st >= 1 ? 'ready' : (o.ref || o.proof) ? 'wait' : 'unpaid', wa = nwa(o.phone), out = { no: o.no, cp: K === CPN.rv ? 'rv' : 'bb', n: bbN(o, K), opened: recs.length, pay, wm: '••••' + wa.slice(-3), wl: wa.slice(-3), boxes: [] };
    for (const rec of recs) {
      const used = rec.code ? ((await store.getJSON('meta/rc/' + rec.code)) || { n: 0 }).n : 0, left = rec.k === 'none' ? 0 : rec.exp - Date.now(), r = { k: rec.k, n: rec.n, img: rec.img, pid: rec.pid, exp: rec.exp, at: rec.at, use: rec.use || null, used: used > 0, expired: rec.k !== 'none' && left <= 0 };
      if (pay === 'ready' && rec.code && !r.used && !r.expired) r.code = rec.code; out.boxes.push({ i: rec.i, r });
    }
    return out;
  }
  /* ---------- POS: staff make an order themselves (walk-in sale) with a manual discount; a saved sale can be edited ---------- */
  async function apiPos(c) {
    if (!c.staff || !(c.owner() || c.can('o'))) throw E(403, 'forbidden', 'You do not have access to do that.');
    const b = await bodyOf(c.req, 120000), cfg = await cfgAll(), edit = b.no ? String(b.no) : '', old = edit ? (/^D[0-9A-F]{10}$/.test(edit) ? await getDoc('orders', edit) : null) : null;
    if (edit && !(old && old.pos)) throw E(404, 'not_found', 'This POS sale was not found.'); const st0 = old ? (await getDoc('status', edit)) || { s: 0 } : null, s0 = st0 && typeof st0.s === 'number' ? st0.s : 0; if (old && s0 < 0) throw E(409, 'closed', 'A cancelled or refunded sale cannot be edited.');
    const name = str(b.name, 60).trim() || 'Walk-in', phone = str(b.phone, 20), mode = b.mode === 'Delivery' ? 'Delivery' : 'Pickup', addr = mode === 'Delivery' ? str(b.addr, 200) : '';
    if (mode === 'Delivery' && !addr) throw E(400, 'bad_addr', 'Please enter a delivery address.'); if (phone && (nwa(phone).length < 8 || nwa(phone).length > 15)) throw E(400, 'bad_phone', 'Please check the WhatsApp number or leave it empty.');
    const items = await buildItems(b.items, true), dsc = isObj(b.disc) ? b.disc : {}, dt = dsc.t === 'amt' ? 'amt' : 'pct', dv = Math.max(0, Math.round((+dsc.v || 0) * 100) / 100); if (dt === 'pct' && dv > 100) throw E(400, 'disc', 'A discount cannot be more than 100%.');
    const mem = b.member === true, cfg2 = { ...cfg, tiers: { ...cfg.tiers, none: { qty: 0, amt: 0, pct: 0 } } };
    const k = calc(items, { mode: 'Pickup', tier: mem ? 'regular' : 'none', cpns: dv > 0 ? [{ type: dt, v: dv }] : [] }, cfg2), f = isObj(b.fees) ? b.fees : {}, FEE = cfg.fees, svc = f.svc === true ? k.svc : 0, pack = f.pack === true ? k.pack : 0, tax = f.tax === true ? Math.round((k.net + svc + pack) * (FEE.tax || 0) / 100) : 0, ship = mode === 'Delivery' ? Math.max(0, Math.min(1e7, Math.round(+b.ship || 0))) : 0, total = k.net + svc + pack + tax + ship;
    const method = str(b.method, 30).trim() || 'Cash', wantPaid = b.paid !== false, paid = old && s0 >= 1 ? true : wantPaid, recv = Math.max(0, Math.min(1e10, Math.round(+b.recv || 0))), no = old ? old.no : 'D' + rid(5).toUpperCase(), at = old ? old.at : Date.now(), now = Date.now(), sl = isObj(b.slot) ? { d: str(b.slot.d, 20), w: str(b.slot.w, 20) } : null;
    const raw = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map(r => ({ id: Math.floor(+r.id) || 0, q: Math.floor(+r.q) || 0, t: Array.isArray(r.t) ? r.t.map(String).slice(0, 20) : [], ...(Array.isArray(r.b) && r.b.length ? { b: r.b.map(String).slice(0, 60) } : {}) }));
    const prevEd = old && Array.isArray(old.pos.ed) ? old.pos.ed.slice(-9) : [], ed = old ? [...prevEd, { by: c.staff.u, at: now, from: old.total, to: total }] : [];
    const pos = { by: old ? old.pos.by : c.staff.u, raw, ...(mem ? { mem: true } : {}), ...(dv > 0 ? { d: { t: dt, v: dv, why: str(dsc.why, 60) } } : {}), ...(paid && method.toLowerCase() === 'cash' && recv > 0 ? { recv, chg: Math.max(0, recv - total) } : {}), ...(str(b.note, 200) ? { nt: str(b.note, 200) } : {}), ...(ed.length ? { ed } : {}) };
    const order = { ...(old || {}), no, uid: '', name, phone, email: '', mode, addr, method, coupon: '', items: items.map(({ id, n, e, t, q, u, bx, ob }) => ({ id, n, e, t, q, u, ...(ob ? { ob } : {}), ...(bx ? { bx } : {}) })), sub: k.sub, tdisc: k.td, disc: k.cd, svc, pack, tax, ship, kg: k.kg, total, tier: 'regular', b2: '', pos,
      ...(sl && (sl.d || sl.w) ? { slot: sl } : {}), ...(b.dn === true ? { dn: true } : { dn: undefined }), ref: paid ? 'POS ' + method : 'POS pay later', proof: paid, ...(paid ? { paidAt: old && old.paidAt ? old.paidAt : now } : {}), at };
    if (!(sl && (sl.d || sl.w))) delete order.slot; if (order.dn === undefined) delete order.dn; if (!paid) delete order.paidAt;
    await putDoc('orders', no, order);
    if (!old) await putDoc('status', no, { s: paid ? (b.done === true ? 4 : 1) : 0, t: at, ...(paid ? { pd: true } : {}), by: c.staff.u });
    else if (s0 === 0 && paid) await putDoc('status', no, { s: b.done === true ? 4 : 1, t: now, pd: true, by: c.staff.u });
    else if (s0 >= 1 && s0 < 4 && b.done === true) await putDoc('status', no, { ...st0, s: 4, t: now, by: c.staff.u });
    const dtxt = dv > 0 ? ' · discount ' + (dt === 'pct' ? dv + '%' : 'Rp ' + dv.toLocaleString('id-ID')) : '';
    await slog('order.pos', `Order #${no} · ${name}`, old ? `POS sale edited: Rp ${(+old.total || 0).toLocaleString('id-ID')} → Rp ${total.toLocaleString('id-ID')} (${items.reduce((n, i) => n + i.q, 0)} items)${dtxt}` : `POS sale Rp ${total.toLocaleString('id-ID')} (${method}${paid ? '' : ', unpaid'})${dtxt}`, c.staff.u);
    const stNow = (await getDoc('status', no)) || { s: 0 };
    return { order, s: typeof stNow.s === 'number' ? stNow.s : 0, edited: !!old };
  }
  /* ---------- Prelaunch: people register before the shop opens, win a gift from a prize pool, and the reward starts its countdown when the shop launches ---------- */
  function plClean(m) {
    const b = bbClean({ ...m, name: str(m.name, 30) || 'Prelaunch gift' }), f = isObj(m.full) ? m.full : {}, car = isObj(m.car) ? m.car : {}, ci = isObj(m.circ) ? m.circ : {}, gm = isObj(m.gm) ? m.gm : {}, ln = String(f.ln || '').trim(), hx = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '';
    return { on: m.on === true, launch: Math.max(0, Math.floor(+m.launch || 0)), limit: Math.max(1, Math.min(1e6, Math.floor(+m.limit || 1000))), name: b.name, ttl: str(m.ttl, 80), sub: str(m.sub, 200), btn: str(m.btn, 30), cdt: str(m.cdt, 60), ldt: str(m.ldt, 80), ch: m.ch === true, rw: b.rw, pop: b.pop, col: hx(m.col), bg: hx(m.bg), tx: hx(m.tx),
      full: { tt: str(f.tt, 80), msg: str(f.msg, 240), ic: str(f.ic, 8), an: ['bounce', 'pulse', 'wiggle', 'float'].includes(f.an) ? f.an : 'bounce', img: okMedia(String(f.img || '').trim()) ? String(f.img).trim() : '', ln: /^https:\/\/[^\s"'<>]{4,190}$/.test(ln) ? ln : '', lb: str(f.lb, 30) },
      bgi: okMedia(String(m.bgi || '').trim()) ? String(m.bgi).trim() : '', bfx: ['pulse', 'wiggle', 'bounce', 'shine', 'glow', 'none'].includes(m.bfx) ? m.bfx : 'pulse',
      circ: { on: ci.on !== false, img: okMedia(String(ci.img || '').trim()) ? String(ci.img).trim() : '', bgc: hx(ci.bgc), bgi: okMedia(String(ci.bgi || '').trim()) ? String(ci.bgi).trim() : '', c1: hx(ci.c1), c2: hx(ci.c2), cap: str(ci.cap, 60), ls: ci.ls !== false, lh: ci.lh === true, lg: ci.lg !== false, lm: str(ci.lm, 120), la: ['wave', 'bounce', 'pulse', 'glow', 'shimmer', 'none'].includes(ci.la) ? ci.la : 'wave', lb: str(ci.lb, 30), lbh: str(ci.lbh, 30) },
      gm: gmNorm(gm),
      car: { on: car.on !== false, ids: (Array.isArray(car.ids) ? car.ids : []).map(x => Math.floor(+x)).filter(x => x > 0).slice(0, 40), sp: Math.max(5, Math.min(300, Math.floor(+car.sp || 30))), rs: Math.max(0.5, Math.min(30, Math.round((+car.rs || 1.5) * 10) / 10)) } };
  }
  const pubPl = d => ({ ...d, rw: (d.rw || []).map(r => ({ id: r.id, t: r.t, n: r.n, img: r.img, pid: r.pid, c: r.c, d: r.d, ...(d.ch ? { w: r.w } : {}) })) });
  const plExp = async d => { const L = (await cfgDoc('pl', DEF.pl)).launch; return (L || d.at || 0) + (d.dd || 7) * 864e5; };
  async function plState(rec, cfg) {
    const used = rec.code ? ((await store.getJSON('meta/rc/' + rec.code)) || { n: 0 }).n : 0, exp = (cfg.launch || rec.at) + (rec.dd || 7) * 864e5, none = rec.k === 'none', expired = !none && Date.now() > exp;
    return { no: 'PL', cp: 'pl', n: 1, opened: 1, last: 0, pay: 'ready', pre: !!(cfg.launch && Date.now() < cfg.launch), dd: rec.dd || 7, launch: cfg.launch, wm: '••••' + rec.wa.slice(-3), wl: rec.wa.slice(-3), boxes: [{ i: 0, r: { k: rec.k, n: rec.n, img: rec.img || '', pid: rec.pid || 0, exp, at: rec.at, use: rec.use || null, used: used > 0, expired, ...(rec.code && !used && !expired ? { code: rec.code } : {}) } }] };
  }
  async function apiPl(c) {
    const b = c.req.method === 'POST' ? await bodyOf(c.req, 3000) : {}, op = String(b.op || 'state'), cfg = await cfgDoc('pl', DEF.pl), cnt = ((await store.getJSON('sec/plcount')) || { n: 0 }).n;
    const base = { now: Date.now(), count: cnt, limit: cfg.limit, full: cnt >= cfg.limit };
    if (op === 'state') return base;
    if (op === 'log') {
      if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); const L = []; for (const r of await readAll((await store.list('sec/plr/')).slice(-3000))) if (r) L.push({ wa: r.wa, name: r.name, email: r.email || '', at: r.at, k: r.k, n: r.n, code: r.code || '', used: r.code ? ((await store.getJSON('meta/rc/' + r.code)) || { n: 0 }).n > 0 : false });
      return { ...base, log: L.sort((x, y) => y.at - x.at), won: (await store.getJSON('meta/plwins')) || {} };
    }
    if (op === 'mine') { const u = c.vid ? await store.getJSON('sec/plu/' + c.vid) : null, rec = u ? await store.getJSON('sec/plr/' + u.wa) : null; return { ...base, state: rec && rec.uid === c.vid ? await plState(rec, cfg) : null }; }
    if (op === 'gmtop') { const L = ((await store.getJSON('sec/plgm')) || { list: [] }).list.slice(0, 5); return { top: L.map(x => ({ name: x.name, icon: x.icon, s: x.s, l: x.l, at: x.at })), thr: L.length >= 5 ? L[4].s : 0 }; }
    if (op === 'gmlog') { if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); return { list: ((await store.getJSON('sec/plgm')) || { list: [] }).list.map(x => ({ id: x.id, name: x.name, icon: x.icon, s: x.s, l: x.l, at: x.at })) }; }
    if (op === 'gmdel') { if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); const d = (await store.getJSON('sec/plgm')) || { list: [] }, x = d.list.find(r => r.id === String(b.id || '')); d.list = d.list.filter(r => r.id !== String(b.id || '')); await store.setJSON('sec/plgm', d); if (x) await slog('pl.gm', `Minigame · ${x.name}`, `Removed the score ${x.s} from the board`, c.staff.u); return { ok: true }; }
    if (op === 'gmstart') { await rlCount(`plgms:${c.ip}`, 120, 'Too many tries. Please wait a few minutes.'); const l = Math.floor(+b.level); if (!(l >= 1 && l <= 5)) throw E(400, 'level', 'Unknown level.'); return { tok: signTok({ k: 'gm', l, t: Date.now(), n: rid(6), v: c.vid || '' }, 1800) }; }
    if (op === 'gmsubmit') {
      await rlCount(`plgmu:${c.ip}`, 30, 'Too many tries. Please wait a few minutes.'); const t = verTok(b.tok); if (!t || t.k !== 'gm') throw E(400, 'tok', 'This round has expired. Please play again.');
      const g = gmNorm(cfg.gm), pl = gmMake(g, t.l), sc = Math.floor(+b.score); if (await store.getJSON('sec/plgmn/' + t.n)) throw E(409, 'used', 'This score was already saved.');
      if (Date.now() - t.t < g.dur * 800) throw E(400, 'fast', 'That round was too short to count.'); if (!(sc >= 0 && sc <= pl.max + pl.cmax)) throw E(400, 'score', 'That score is not possible.');
      const name = String(b.name || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16), icon = GM_ICONS.includes(b.icon) ? b.icon : GM_ICONS[0];
      if (name.length < 2) throw E(400, 'name', 'Please enter a name (2 to 16 letters).'); if (gmBad(name)) throw E(400, 'badname', 'Please choose a friendlier name.');
      await store.setJSON('sec/plgmn/' + t.n, { at: Date.now() }); const d = (await store.getJSON('sec/plgm')) || { list: [] }, mine = c.vid ? d.list.find(r => r.vid === c.vid) : null;
      if (mine && mine.s >= sc) return { ok: true, kept: true, top: d.list.slice(0, 5).map(x => ({ name: x.name, icon: x.icon, s: x.s, l: x.l, at: x.at })) };
      d.list = d.list.filter(r => !(c.vid && r.vid === c.vid)); d.list.push({ id: rid(6), vid: c.vid || '', name, icon, s: sc, l: t.l, at: Date.now() }); d.list.sort((x, y) => y.s - x.s || x.at - y.at); d.list = d.list.slice(0, 30); await store.setJSON('sec/plgm', d);
      await slog('pl.gm', `Minigame · ${name}`, `Score ${sc} on level ${t.l}`, 'customer'); return { ok: true, rank: d.list.findIndex(r => r.name === name && r.s === sc) + 1, top: d.list.slice(0, 5).map(x => ({ name: x.name, icon: x.icon, s: x.s, l: x.l, at: x.at })) };
    }
    if (op !== 'reg') throw E(400, 'bad_op', 'Unknown action.');
    await rlCount(`plreg:${c.ip}`, 12, 'Too many tries. Please wait a few minutes.');
    if (!cfg.on) throw E(409, 'pl_off', 'Registration is not open.'); if (cfg.launch && Date.now() >= cfg.launch) throw E(409, 'pl_closed', 'We have launched! Registration is closed.');
    await tsCheck(c, b, 'place');
    const name = str(b.name, 60).trim(), wa = nwa(b.phone), email = String(b.email || '').trim().slice(0, 100);
    if (name.length < 2) throw E(400, 'name', 'Please enter your name.'); if (wa.length < 9 || wa.length > 15) throw E(400, 'phone', 'Please enter a valid WhatsApp number.'); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw E(400, 'email', 'Please check your email address.');
    const ex = await store.getJSON('sec/plr/' + wa);
    if (ex) { if (ex.uid === c.vid) { return { ...base, already: true, state: await plState(ex, cfg) }; } throw E(409, 'pl_exists', 'This WhatsApp number is already registered. Open the shop on the phone you registered with to see your gift.'); }
    if (cnt >= cfg.limit) throw E(409, 'pl_full', 'Registration is full.');
    const wins = (await store.getJSON('meta/plwins')) || {}, pool = (cfg.rw || []).filter(r => r.w > 0 && !(r.max > 0 && (wins[r.id] || 0) >= r.max)), total = pool.reduce((n, r) => n + r.w, 0);
    let x = crypto.randomInt(1_000_000) / 1_000_000 * Math.max(100, total), pick = null; for (const r of pool) { if (x < r.w) { pick = r; break; } x -= r.w; }
    const at = Date.now(), rec = { wa, name, email, uid: c.vid, at, k: 'none', n: '', img: '', dd: 7 };
    if (pick && pick.t !== 'none') {
      const p = pick.t === 'prod' ? await product(pick.pid) : null;
      if (!(pick.t === 'prod' && !p)) {
        const code = 'PL' + rid(5).toUpperCase(), use = { type: pick.t === 'prod' ? 'item' : pick.t === 'special' ? 'gift' : pick.c.type, v: pick.t === 'prod' || pick.t === 'special' ? 0 : pick.c.v, min: pick.c.min, box: pick.c.box, pid: pick.t === 'prod' ? p.id : 0 }, nm = pick.n || (p && p.n) || (pick.t === 'special' ? 'Special' : 'Reward');
        await putDoc('coupons', code, { type: use.type, v: use.v, min: use.min, box: use.box, pid: use.pid, max: 1, exp: 0, pl: true, dd: pick.d, at, bb: 'PL', lock: wa, n: nm, ...(pick.t === 'special' ? { img: pick.img || '' } : {}), hint: false });
        Object.assign(rec, { k: pick.t, n: nm, img: pick.img || '', pid: use.pid, code, use, dd: pick.d, rid: pick.id }); wins[pick.id] = (wins[pick.id] || 0) + 1; await store.setJSON('meta/plwins', wins);
      }
    }
    await store.setJSON('sec/plr/' + wa, rec); if (c.vid) await store.setJSON('sec/plu/' + c.vid, { wa }); await store.setJSON('sec/plcount', { n: cnt + 1 });
    await slog('pl.reg', `Prelaunch · ${name}`, rec.k === 'none' ? 'Registered: no reward this time' : `Registered and won: ${rec.n}`, 'customer');
    return { ...base, count: cnt + 1, full: cnt + 1 >= cfg.limit, state: await plState(rec, cfg) };
  }
  async function apiBb(c) {
    const b = await bodyOf(c.req, 4000), op = String(b.op || ''), K = b.cp === 'rv' ? CPN.rv : CPN.bb; await rlCount(`bb:${c.ip}`, 240, 'Too many tries. Please wait a few minutes.');
    if (op === 'log') {
      if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); const ks = (await store.list('sec/bbw/')).filter(k => K === CPN.rv ? k.startsWith('sec/bbw/rv-') : !k.startsWith('sec/bbw/rv-')).slice(-300), L = [];
      for (const k of ks) { const r = await store.getJSON(k); if (r) { const st = await stageOf(r.no); L.push({ no: r.no, i: r.i || 0, name: r.name, wa: r.wa, k: r.k, n: r.n, at: r.at, exp: r.exp, code: r.code || '', pay: st < 0 ? 'void' : st >= 1 ? 'paid' : 'wait', used: r.code ? ((await store.getJSON('meta/rc/' + r.code)) || { n: 0 }).n > 0 : false }); } }
      return { log: L.sort((a, d) => d.at - a.at), won: (await store.getJSON(K.wins)) || {} };
    }
    if (op === 'mine') {
      const L = []; for (const no of (Array.isArray(b.nos) ? b.nos : []).slice(0, 20)) { if (!/^D[0-9A-F]{10}$/.test(String(no))) continue; const o = await getDoc('orders', no); if (!o || o.uid !== c.vid) continue; for (const Q of [CPN.bb, CPN.rv]) { const recs = await bbRecs(no, bbN(o, Q), Q); if (recs.length) L.push(await bbState(o, recs, Q)); } }
      return { list: L };
    }
    /* does a WhatsApp number have rewards that this phone does not hold? (only a count is returned, never names or codes) */
    if (op === 'wa') {
      await rlCount(`bbwa:${c.ip}`, 30, 'Please wait a few minutes.'); const wa = nwa(b.phone); if (wa.length < 8 || wa.length > 15) return { other: 0 };
      const idx = (await store.getJSON('sec/bbwa/' + wa)) || { l: [] }; let other = 0;
      for (const e of idx.l.slice(-40)) { const r = await store.getJSON(`sec/bbw/${e.cp === 'rv' ? 'rv-' : ''}${e.no}-${e.i}`); if (!r || r.k === 'none' || r.uid === c.vid || r.exp <= Date.now() || (await stageOf(r.no)) < 0) continue; if (((await store.getJSON('meta/rc/' + r.code)) || { n: 0 }).n > 0) continue; other++; }
      { const pr = await store.getJSON('sec/plr/' + wa); if (pr && pr.uid !== c.vid && pr.k !== 'none' && pr.code && ((await store.getJSON('meta/rc/' + pr.code)) || { n: 0 }).n === 0 && (await plState(pr, await cfgDoc('pl', DEF.pl))).boxes[0].r.expired === false) other++; }
      return { other };
    }
    const o = await ownOrder(c, b.no), recs0 = await bbRecs(o.no, bbN(o, K), K);
    if (op === 'state' || (op === 'open' && recs0.length >= bbN(o, K) && bbN(o, K) > 0)) return await bbState(o, recs0, K);
    if (op !== 'open') throw E(400, 'bad_op', 'Unknown action.');
    const bb = await cfgDoc(K.cfg, DEF[K.cfg]), st = await stageOf(o.no);
    if (!bbN(o, K)) throw E(409, 'bb_na', `This order does not include a ${K.lbl}.`); if (st < 0) throw E(409, 'bb_void', 'This order was cancelled.'); if (K === CPN.bb && st === 0 && !o.ref && !o.proof) throw E(409, 'bb_pay', `Please pay for this order first, then open your ${K.lbl}.`);
    const wa = nwa(o.phone), ck = `sec/${K.cap}/${wa}-${dayOf(Date.now())}`, cap = (await store.getJSON(ck)) || { n: 0 }; if (bb.cap > 0 && cap.n >= bb.cap) throw E(429, 'bb_cap', `You can open ${bb.cap} ${K.lbl}${bb.cap > 1 ? 'es' : ''} per day. Please try again tomorrow – it will still be here.`);
    const wins = (await store.getJSON(K.wins)) || {}, pool = (bb.rw || []).filter(r => r.w > 0 && !(r.max > 0 && (wins[r.id] || 0) >= r.max)), total = pool.reduce((n, r) => n + r.w, 0);
    let x = crypto.randomInt(1_000_000) / 1_000_000 * Math.max(100, total), pick = null; for (const r of pool) { if (x < r.w) { pick = r; break; } x -= r.w; }
    const idx = recs0.length, at = Date.now(), rec = { no: o.no, i: idx, name: o.name, wa, uid: o.uid, at, k: 'none', n: '', img: '' };
    if (pick && pick.t !== 'none') {
      const p = pick.t === 'prod' ? await product(pick.pid) : null; if (pick.t === 'prod' && !p) { rec.k = 'none'; } else {
        const code = K.code + rid(5).toUpperCase(), exp = at + pick.d * 864e5, use = { type: pick.t === 'prod' ? 'item' : pick.t === 'special' ? 'gift' : pick.c.type, v: pick.t === 'prod' || pick.t === 'special' ? 0 : pick.c.v, min: pick.c.min, box: pick.c.box, pid: pick.t === 'prod' ? p.id : 0 };
        await putDoc('coupons', code, { type: use.type, v: use.v, min: use.min, box: use.box, pid: use.pid, max: 1, exp, bb: o.no, lock: wa, n: pick.n || (p && p.n) || (pick.t === 'special' ? 'Special' : 'Reward'), ...(pick.t === 'special' ? { img: pick.img || '' } : {}), hint: false });
        Object.assign(rec, { k: pick.t, n: pick.n || (p && p.n) || (pick.t === 'special' ? 'Special' : 'Reward'), img: pick.img || '', pid: use.pid, code, exp, use, rid: pick.id }); wins[pick.id] = (wins[pick.id] || 0) + 1; await store.setJSON(K.wins, wins);
        const wk = 'sec/bbwa/' + wa, wi = (await store.getJSON(wk)) || { l: [] }; wi.l = [...wi.l.slice(-39), { no: o.no, i: idx, cp: K === CPN.rv ? 'rv' : 'bb' }]; await store.setJSON(wk, wi);
      }
    }
    await store.setJSON(`sec/bbw/${K.pre}${o.no}-${idx}`, rec); cap.n++; await store.setJSON(ck, cap); await putDoc('orders', o.no, { ...o, [K.o]: idx + 1 });
    await slog(K === CPN.rv ? 'bb.review' : 'bb.draw', `Order #${o.no} · ${o.name}`, (bbN(o, K) > 1 ? `Box ${idx + 1} of ${bbN(o, K)}: ` : '') + (rec.k === 'none' ? `Opened the ${K.lbl}: no reward this time` : `Opened the ${K.lbl} and won: ${rec.n}`), 'customer');
    return { ...(await bbState({ ...o, [K.o]: idx + 1 }, [...recs0, rec], K)), last: idx };
  }
  /* ---------- DOKU Checkout: pay by QRIS / Virtual Account / e-wallet / card, confirmed automatically by DOKU's signed notification ---------- */
  const DK_Q = ['QRIS', 'VIRTUAL_ACCOUNT_BCA', 'VIRTUAL_ACCOUNT_BANK_MANDIRI', 'VIRTUAL_ACCOUNT_BANK_SYARIAH_MANDIRI', 'VIRTUAL_ACCOUNT_DOKU', 'VIRTUAL_ACCOUNT_BRI', 'VIRTUAL_ACCOUNT_BNI', 'VIRTUAL_ACCOUNT_BANK_PERMATA', 'VIRTUAL_ACCOUNT_BANK_CIMB', 'VIRTUAL_ACCOUNT_BANK_DANAMON', 'VIRTUAL_ACCOUNT_BNC', 'VIRTUAL_ACCOUNT_BTN'],
    DK_O = ['CREDIT_CARD', 'EMONEY_SHOPEEPAY', 'EMONEY_OVO', 'EMONEY_DANA', 'ONLINE_TO_OFFLINE_ALFA', 'DIRECT_DEBIT_BRI', 'PEER_TO_PEER_AKULAKU', 'PEER_TO_PEER_KREDIVO', 'PEER_TO_PEER_INDODANA'];
  const dkCreds = async () => { const s0 = (await store.getJSON('sec/doku')) || {}; return { id: String(s0.id || process.env.DOKU_CLIENT_ID || '').trim(), key: String(s0.key || process.env.DOKU_SECRET_KEY || '').trim(), src: s0.key ? 'saved' : process.env.DOKU_SECRET_KEY ? 'env' : '' }; };
  const dkFee = (kind, total, cf) => kind === 'o' ? Math.round(total * (+cf.fp || 0) / 100) + (+cf.ff || 0) : 0;
  const dkSig = (key, id, rid0, ts, target, raw) => 'HMACSHA256=' + crypto.createHmac('sha256', key).update(`Client-Id:${id}\nRequest-Id:${rid0}\nRequest-Timestamp:${ts}\nRequest-Target:${target}${raw == null ? '' : '\nDigest:' + crypto.createHash('sha256').update(raw).digest('base64')}`).digest('base64');
  async function dkCall(cf, cr, method, target, body) {
    const raw = body == null ? null : JSON.stringify(body), rq = crypto.randomUUID(), ts = new Date().toISOString().slice(0, 19) + 'Z', base = cf.sb !== false ? 'https://api-sandbox.doku.com' : 'https://api.doku.com';
    const r = await F(base + target, { method, headers: { 'Client-Id': cr.id, 'Request-Id': rq, 'Request-Timestamp': ts, Signature: dkSig(cr.key, cr.id, rq, ts, target, raw), ...(raw ? { 'content-type': 'application/json' } : {}) }, ...(raw ? { body: raw } : {}), signal: AbortSignal.timeout(12000) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }
  /* an order paid through DOKU: same result as the owner confirming a payment proof */
  async function dkConfirm(no, inv, body, src) {
    const o = await getDoc('orders', no); if (!o) return;
    const st = (await getDoc('status', no)) || { s: 0 }, ch = String(((body || {}).channel || {}).id || ((body || {}).service || {}).id || 'DOKU').slice(0, 40), amt = +((body || {}).order || {}).amount || inv.amt, tgt = `Order #${no} · ${o.name}`;
    if (typeof st.s === 'number' && st.s !== 0) { if (st.s < 0) await slog('order.payment', tgt, `DOKU payment of Rp ${amt.toLocaleString('id-ID')} arrived after the order was cancelled (${ch}). Refund the customer in the DOKU dashboard.`, 'DOKU'); return; }
    await putDoc('orders', no, { ...o, method: 'DOKU', ref: 'DOKU ' + ch, proof: true, paidAt: Date.now(), dk: { inv: inv.inv, ch, amt, fee: inv.fee || 0 } });
    await putDoc('status', no, { s: 1, t: Date.now(), pd: true, by: 'DOKU' }); capiPurchase(o).catch(e => console.error('meta capi', e.message));
    await slog('order.payment', tgt, `Paid through DOKU (${ch}) Rp ${amt.toLocaleString('id-ID')}${inv.fee ? ' incl. Rp ' + inv.fee.toLocaleString('id-ID') + ' payment fee' : ''} – confirmed automatically (${src})`, 'DOKU');
  }
  /* customer: start a DOKU payment for their unpaid order, or check whether it was paid. Owner: save keys, test the connection. */
  async function apiDoku(c) {
    const b = c.req.method === 'POST' ? await bodyOf(c.req) : {}, cf = await cfgDoc('doku', DEF.doku), op = String(b.op || '');
    if (op === 'key' || op === 'test' || c.req.method === 'GET') {
      if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); const sec = (await store.getJSON('sec/doku')) || {};
      if (op === 'key') { const id0 = String(b.id || '').trim(), k = String(b.key || '').trim(); if ((id0 && !/^[A-Za-z0-9_-]{8,60}$/.test(id0)) || (k && (k.length < 20 || k.length > 200 || /\s/.test(k)))) throw E(400, 'bad_key', 'That does not look like a DOKU Client ID / Secret Key. Copy them again from DOKU Back Office.'); if (id0) sec.id = id0; if (k) sec.key = k; if (b.clear === true) { delete sec.id; delete sec.key; } sec.kat = Date.now(); await store.setJSON('sec/doku', sec); await slog('set.cfg', 'DOKU', b.clear === true ? 'DOKU keys removed' : 'DOKU keys saved'); }
      if (op === 'test') { const cr = await dkCreds(); if (!cr.id || !cr.key) return { err: 'Save the Client ID and the Secret Key first.' }; try { const r = await dkCall(cf, cr, 'GET', '/orders/v1/status/BSTEST' + rid(3)); return r.status === 401 || r.status === 403 ? { err: 'DOKU refused the keys (HTTP ' + r.status + '). Check the Client ID, the Secret Key and the Sandbox / Live switch: sandbox keys only work in Sandbox.' } : { ok: true, http: r.status }; } catch (e) { return { err: 'Could not reach DOKU.' }; } }
      const cr = await dkCreds(); return { id: cr.id, key: !!cr.key, end: cr.key ? cr.key.slice(-4) : '', src: cr.src, shop: (await cfgDoc('mkt', DEF.mkt)).site || HOSTS.shop[c.host] || '' };
    }
    if (!cf.on) throw E(404, 'doku_off', 'DOKU payment is not available right now. Please pay by manual transfer.');
    const o = await ownOrder(c, b.no), cr = await dkCreds(); if (!cr.id || !cr.key) throw E(503, 'doku_setup', 'DOKU payment is not available right now. Please pay by manual transfer.');
    const stage = await stageOf(o.no); await rlCount(`doku${op === 'check' ? 'c' : ''}:${o.no}`, op === 'check' ? 150 : 20, 'Too many tries on this order. Please wait a little.');
    if (op === 'check') {
      if (stage !== 0) return { paid: stage >= 1 }; const L = (await store.getJSON('sec/dokuord/' + o.no)) || { l: [] }; if (!L.l.length) return { paid: false };
      for (const inv of L.l.slice(-3)) { try { const r = await dkCall(cf, cr, 'GET', '/orders/v1/status/' + encodeURIComponent(inv.inv)), t = r.j && r.j.transaction; if (r.status === 200 && t && t.status === 'SUCCESS' && +((r.j.order || {}).amount) === inv.amt) { await dkConfirm(o.no, inv, r.j, 'status check'); return { paid: true }; } } catch (e) { console.error('doku check', e.message); } }
      return { paid: false };
    }
    await tsCheck(c, b, 'doku'); const kind = b.kind === 'o' ? 'o' : 'q';
    if (stage !== 0 || o.ref || o.proof) throw E(409, 'locked', 'This order is already paid or waiting for the owner.');
    if ((kind === 'q' && cf.q === false) || (kind === 'o' && cf.o === false)) throw E(400, 'doku_kind', 'That payment option is not available.');
    const fee = dkFee(kind, +o.total || 0, cf), amt = Math.round(+o.total || 0) + fee, cfg = await cfgAll(), left = Math.ceil((Math.max(o.at, +o.rjAt || 0) + payMs(o, cfg) - Date.now()) / 6e4), due = Math.max(5, Math.min(left, 1440)), L = (await store.getJSON('sec/dokuord/' + o.no)) || { l: [] };
    const old = L.l.find(x => x.kind === kind && x.amt === amt && x.url && x.until > Date.now() + 60e3); if (old) return { url: old.url, fee };
    const inv = `${o.no}-${rid(3)}`, body = { order: { amount: amt, invoice_number: inv, currency: 'IDR', callback_url: `${c.url.origin}/#/order/${o.no}`, auto_redirect: true, language: 'EN' }, payment: { payment_due_date: due, payment_method_types: kind === 'o' ? DK_O : DK_Q }, customer: { name: str(o.name, 60), ...(o.email ? { email: str(o.email, 80) } : {}), ...(nwa(o.phone) ? { phone: nwa(o.phone) } : {}) } };
    let r; try { r = await dkCall(cf, cr, 'POST', '/checkout/v1/payment', body); if (r.status >= 400 && r.status < 500 && kind === 'q') { body.payment.payment_method_types = ['QRIS']; r = await dkCall(cf, cr, 'POST', '/checkout/v1/payment', body); } } catch (e) { console.error('doku', e.message); throw E(502, 'doku_down', 'DOKU is not answering right now. Please pay by manual transfer.'); }
    const url = r.j && r.j.response && r.j.response.payment && r.j.response.payment.url;
    if (r.status !== 200 || !/^https:\/\//.test(url || '')) { console.error('doku refused', r.status, JSON.stringify(r.j).slice(0, 300)); await slog('order.doku', `Order #${o.no}`, 'DOKU did not create the payment page (HTTP ' + r.status + '): ' + str(JSON.stringify(r.j.message || r.j.error || ''), 120), 'DOKU'); throw E(502, 'doku_failed', 'DOKU payment could not start. Please pay by manual transfer.'); }
    const rec = { inv, no: o.no, kind, amt, fee, url, until: Date.now() + due * 6e4 }; L.l = [...L.l.slice(-4), rec]; await store.setJSON('sec/dokuord/' + o.no, L); await store.setJSON('sec/dokuinv/' + inv, { no: o.no, kind, amt, fee, inv }); return { url, fee };
  }
  /* DOKU's payment notification: verified with the Secret Key signature, then the order is confirmed */
  async function apiDokuHook(c) {
    if (c.req.method !== 'POST') throw E(405, 'method', 'POST only.'); const raw = await c.req.text(); if (raw.length > 200000) throw E(413, 'too_large', 'Too large.');
    const cr = await dkCreds(), h = n => c.req.headers.get(n) || ''; if (!cr.id || !cr.key || h('client-id') !== cr.id) throw E(403, 'forbidden', 'Unknown client.');
    /* DOKU signs the path of the URL it called (not the domain), so a notification passed on from a fixed address (for example a Supabase function) is checked against that path too */
    const np = String(((await getDoc('config', 'doku')) || {}).np || ''), paths = [new URL(c.req.url).pathname.replace(/\/+$/, ''), ...(np ? [np] : [])]; if (!paths.some(t => safeEq(dkSig(cr.key, cr.id, h('request-id'), h('request-timestamp'), t, raw), h('signature')))) { await slog('order.doku', 'DOKU notification', 'A DOKU notification with a wrong signature was refused.', 'DOKU'); throw E(403, 'forbidden', 'Bad signature.'); }
    let j; try { j = JSON.parse(raw); } catch { throw E(400, 'bad_json', 'Invalid body.'); }
    const t = j.transaction || {}, invn = String((j.order || {}).invoice_number || ''), rec = /^[A-Za-z0-9_-]{4,64}$/.test(invn) ? await store.getJSON('sec/dokuinv/' + invn) : null;
    if (!rec || t.status !== 'SUCCESS') return { ok: true };
    if (+((j.order || {}).amount) !== rec.amt) { await slog('order.doku', `Order #${rec.no}`, `DOKU reported Rp ${(+j.order.amount || 0).toLocaleString('id-ID')} but Rp ${rec.amt.toLocaleString('id-ID')} was expected. NOT confirmed – please check in DOKU Back Office.`, 'DOKU'); return { ok: true }; }
    await dkConfirm(rec.no, rec, j, 'notification'); return { ok: true };
  }
  /* ---------- Affiliates: referral links and codes, commission on what the customer paid for the products, payouts confirmed by the owner ---------- */
  const okCode = v => /^[A-Z0-9]{3,12}$/.test(String(v || '')), affFirst = n => String(n || '').trim().split(/\s+/)[0].slice(0, 20);
  const AFF_SRC = ['instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'telegram', 'google', 'x', 'direct', 'other'], affSrc = v => AFF_SRC.includes(String(v)) ? String(v) : 'direct';
  const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const affCfg = () => cfgDoc('aff', DEF.aff), affOn = r => r && (r.st === 'active' || r.st === 'paused');
  const rpf = n => 'Rp ' + Math.round(+n || 0).toLocaleString('id-ID');
  async function affNote(u, k, t, b, to) { const id = Date.now().toString(36) + rid(3); await store.setJSON('sec/affan/' + id, { id, at: Date.now(), to: to || u, k, t: str(t, 80), b: str(b, 400), by: to ? 'owner' : 'system' }); }
  /* an order belongs to an affiliate when it carries their link code or discount code, the affiliate is active, and it is not their own purchase */
  async function affAttach(ref, o, via, src) {
    const cfg = await affCfg(); if (!cfg.on) return ''; const code = String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); if (!okCode(code)) return '';
    const ix = await store.getJSON('sec/affcode/' + code), a = ix ? await store.getJSON('sec/affu/' + ix.u) : null; if (!a || a.st !== 'active') return '';
    if (nwa(a.wa) === nwa(o.phone) || String(a.email || '').toLowerCase() === String(o.email || '').toLowerCase()) return '';
    const base = Math.max(0, o.k.sub - o.k.td - o.k.cd), sc = sacOf(a, cfg), sp = via === 'coupon' ? sc.pts : 0, rate = sc.rate - sp; if (base <= 0 || rate <= 0) return a.u;
    const amt = Math.round(base * rate / 100); await store.setJSON(`sec/affc/${a.u}/${o.no}`, { no: o.no, u: a.u, base, rate, amt, st: 'pending', at: Date.now(), ...(sp ? { sac: sp } : {}), name: affFirst(o.name), n: o.items.reduce((t, i) => t + i.q, 0), via: via === 'coupon' ? 'coupon' : 'link', src: via === 'coupon' ? 'direct' : affSrc(src) });
    await slog('aff.order', `Order #${o.no}`, `Credited to affiliate ${a.name} (${code}): ${rate}% of ${rpf(base)}`, 'system');
    await affNote(a.u, 'order', `New order #${o.no}`, `${affFirst(o.name)} ordered. Your commission: ${rpf(base)} × ${rate}% = ${rpf(amt)} (pending until ${cfg.hold} days after delivery).`); return a.u;
  }
  async function affRebase(u, no, base) {
    const k = `sec/affc/${u}/${no}`, r = await store.getJSON(k); if (!r || r.st !== 'pending') return; r.base = Math.max(0, Math.round(base)); r.amt = Math.round(r.base * r.rate / 100); await store.setJSON(k, r);
  }
  /* pending -> approved after delivery + hold days; cancelled, refunded or complained orders void the commission (unless it was already paid) */
  /* read many blobs at once: each read is a network round trip, so reading them one by one made the affiliate pages slow */
  const readAll = keys => Promise.all(keys.map(k => store.getJSON(k)));
  async function affRefresh(u) {
    const cfg = await affCfg(), L = [], keys = await store.list(`sec/affc/${u}/`), recs = await readAll(keys), open = recs.map((r, i) => r && (r.st === 'pending' || r.st === 'approved') ? i : -1).filter(i => i >= 0), info = new Map(await Promise.all(open.map(async i => [i, await Promise.all([getDoc('status', recs[i].no), getDoc('complaints', recs[i].no)])])));
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], r = recs[i]; if (!r) continue;
      if (info.has(i)) {
        const [st0, cm] = info.get(i), st = st0 || { s: 0 }, s = typeof st.s === 'number' ? st.s : 0; let ch = false;
        if (s >= 1 && !r.pd) { r.pd = true; ch = true; }
        if (s < 0) { r.st = 'void'; r.why = s === -2 ? 'Order refunded' : 'Order cancelled'; ch = true; }
        else if (cm) { r.st = 'void'; r.why = 'Complaint on the order'; ch = true; }
        else if (r.st === 'pending' && s === 4 && Date.now() >= (st.t || r.at) + cfg.hold * 864e5) { r.st = 'approved'; r.okAt = Date.now(); ch = true; }
        if (ch) { await store.setJSON(k, r); await affNote(u, 'order', r.st === 'void' ? `Order #${r.no}: no commission` : `Commission approved`, r.st === 'void' ? `${r.why}. The commission of ${rpf(r.amt)} was cancelled.` : `Order #${r.no}: ${rpf(r.amt)} is ready to withdraw.`); }
      }
      L.push(r);
    }
    return L.sort((a, b) => b.at - a.at);
  }
  const sumBy = (L, st) => L.filter(r => r.st === st).reduce((t, r) => t + r.amt, 0);
  const inRange = (t, f, to) => t >= f && t < to;
  /* link clicks of one affiliate between two times: views, unique visitors (a short hash per visitor), views by source, and per day */
  async function affClicks(u, from, to) {
    const out = { views: 0, uniq: new Set(), src: {}, byDay: {} }, d0 = dayOf(from), d1 = dayOf(to - 1);
    const ks = (await store.list(`sec/affk/${u}/`)).filter(k => { const d = k.split('/').pop(); return d >= d0 && d <= d1; });
    for (const [i, x] of (await readAll(ks)).entries()) { const d = ks[i].split('/').pop(); if (!x) continue; out.views += x.c || 0; out.byDay[d] = x.c || 0; for (const h of x.v || []) out.uniq.add(h); for (const [s, n] of Object.entries(x.s || {})) out.src[s] = (out.src[s] || 0) + n; }
    return out;
  }
  async function affStats(u, L, from, to) {
    if (from <= 0) from = Math.min(to - 30 * 864e5, ...L.map(r => r.at)); if (to - from > 400 * 864e5) from = to - 400 * 864e5;
    const ck = await affClicks(u, from, to), days = [], seen = new Set(); for (let t = from; t < to + 864e5 && days.length < 402; t += 864e5) { const d = dayOf(Math.min(t, to - 1)); if (!seen.has(d)) { seen.add(d); days.push(d); } } const by = {};
    const R = L.filter(r => inRange(r.at, from, to)), live = R.filter(r => r.st !== 'void');
    for (const r of R) { const d = dayOf(r.at); (by[d] = by[d] || { o: 0, s: 0, c: 0 }); by[d].o++; if (r.st !== 'void') { by[d].s += r.base; by[d].c += r.amt; } }
    const series = days.map(d => ({ d, k: ck.byDay[d] || 0, o: (by[d] || {}).o || 0, s: (by[d] || {}).s || 0, c: (by[d] || {}).c || 0 }));
    const src = {}; for (const [k, v] of Object.entries(ck.src)) src[k] = { v, o: 0, s: 0 }; for (const r of live) { const k = r.src || 'direct'; (src[k] = src[k] || { v: 0, o: 0, s: 0 }); src[k].o++; src[k].s += r.base; }
    return { series, clicks: ck.views, uniq: ck.uniq.size, orders: R.length, paidOrders: live.filter(r => r.pd || r.st === 'approved' || r.st === 'paid').length, coupon: R.filter(r => r.via === 'coupon').length, conv: ck.views ? Math.round(R.length / ck.views * 1000) / 10 : 0, src,
      sales: live.reduce((t, r) => t + r.base, 0), total: live.reduce((t, r) => t + r.amt, 0), review: sumBy(R, 'pending'), ready: R.filter(r => r.st === 'approved' && !r.pid).reduce((t, r) => t + r.amt, 0), inpay: R.filter(r => r.st === 'approved' && r.pid).reduce((t, r) => t + r.amt, 0), paid: sumBy(R, 'paid'), void: sumBy(R, 'void') };
  }
  /* a WhatsApp number (0812…) or a wa.me / WhatsApp link, as a safe https link */
  const waLink = u => { u = String(u || '').trim(); if (/^[0-9+\s().-]{6,22}$/.test(u)) return 'https://wa.me/' + nwa(u); return /^https:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s"'<>`\\]{1,180}$/.test(u) ? u : ''; };
  const FOOT_K = ['whatsapp', 'instagram', 'tiktok', 'facebook', 'youtube', 'x', 'telegram', 'threads', 'linkedin', 'pinterest', 'line', 'tokopedia', 'shopee', 'email', 'phone', 'website', 'maps', 'custom'];
  function footClean(m) {
    m = isObj(m) ? m : {}; const hx = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '', med = v => okMedia(String(v || '').trim()) ? String(v).trim() : '', rc = isObj(m.rc) ? m.rc : {};
    const link = (k, u) => { u = String(u || '').trim(); if (k === 'whatsapp') return waLink(u); if (k === 'email') return /^[^@\s"'<>]+@[^@\s"'<>]+\.[^@\s"'<>]+$/.test(u) ? 'mailto:' + u : /^mailto:[^\s"'<>]{4,120}$/.test(u) ? u : ''; if (k === 'phone') { const d = u.replace(/[^0-9+]/g, ''); return /^\+?[0-9]{6,18}$/.test(d) ? 'tel:' + d : /^tel:\+?[0-9]{6,18}$/.test(u) ? u : ''; } return /^https:\/\/[^\s"'<>`\\()]{4,300}$/.test(u) && !/^https:\/\/[^/]*@/.test(u) ? u : ''; };
    return { on: m.on === true, t: str(m.t, 60), tx: str(m.tx, 300), cp: str(m.cp, 100), bg: hx(m.bg), fc: hx(m.fc), logo: med(m.logo),
      ln: (Array.isArray(m.ln) ? m.ln : []).slice(0, 14).filter(isObj).map(x => { const k = FOOT_K.includes(x.k) ? x.k : 'custom'; return { k, u: link(k, x.u), l: str(x.l, 30), img: med(x.img) }; }).filter(x => x.u),
      rc: { on: rc.on === true, t: str(rc.t, 60), sp: Math.max(5, Math.min(300, Math.floor(+rc.sp || 30))), rs: Math.max(0.5, Math.min(30, Math.round((+rc.rs || 1.5) * 10) / 10)),
        cards: (Array.isArray(rc.cards) ? rc.cards : []).slice(0, 20).filter(isObj).map(c => ({ id: /^[a-z0-9]{3,12}$/.test(c.id || '') ? c.id : rid(3), img: med(c.img), n: str(c.n, 40), t: str(c.t, 220), st: Math.max(0, Math.min(5, Math.floor(+c.st || 0))), pid: Math.max(0, Math.floor(+c.pid || 0)) })).filter(c => c.img || c.t || c.n) } };
  }
  /* Sacrifice mode: an affiliate gives up some of their commission points to raise their customers' discount (1 point = 1 point). Only orders that use their code earn the lower rate; link orders keep the full rate. */
  const sacClean = x => { x = isObj(x) ? x : {}; const hx = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '', med = v => okMedia(String(v || '').trim()) ? String(v).trim() : ''; return { on: x.on !== false, max: Math.max(0, Math.min(100, Math.round((+x.max >= 0 ? +x.max : 50) * 10) / 10)), ot: str(x.ot, 120), nt: str(x.nt, 120), oc: hx(x.oc), nc: hx(x.nc), oi: med(x.oi), ni: med(x.ni) }; };
  const sacOf = (a, cfg) => { const sc = sacClean(cfg.sac), rate = a.rate != null ? a.rate : cfg.rate, base = a.disc != null ? a.disc : cfg.disc, pm = a.sm != null ? a.sm : sc.max, max = sc.on ? Math.max(0, Math.min(Math.floor(rate * pm / 100 * 2) / 2, Math.floor(Math.max(0, 50 - base) * 2) / 2)) : 0, live = !(+a.sacEnd > 0 && +a.sacEnd <= Date.now()), pts = live ? Math.max(0, Math.min(max, Math.round((+a.sac || 0) * 2) / 2)) : 0; return { on: sc.on, rate, base, max, pts, disc: base + pts, crate: rate - pts, pct: pm, end: pts > 0 && +a.sacEnd > 0 ? +a.sacEnd : 0 }; };
  async function affDiscCode(a, cfg) {
    const d = sacOf(a, cfg).disc;
    if (a.st === 'active' && d > 0 && cfg.on) await putDoc('coupons', a.code, { type: 'pct', v: d, aff: a.u, hint: false, n: 'Affiliate ' + a.name }); else { const cd = await getDoc('coupons', a.code); if (cd && cd.aff === a.u) await delDoc('coupons', a.code); }
  }
  const payInfo = cfg => { const t = new Date(Date.now() + tzH() * 3600e3), dn = t.getUTCDay(), p = Math.min(6, Math.max(0, +cfg.pday)); return { day: p, name: DAYN[p], today: dn === p, inDays: (p - dn + 7) % 7 }; };
  const affLook = (x) => { x = x && typeof x === 'object' ? x : {}; const col = v => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '', id = v => /^[0-9a-f]{24}$/.test(String(v || '')) ? String(v) : '', fn = v => String(v || '').replace(/[^A-Za-z0-9 \-]/g, '').slice(0, 40), tx = (v, n) => String(v || '').replace(/[<>]/g, '').slice(0, n), m = x.mq && typeof x.mq === 'object' ? x.mq : {};
    const sty = v => { v = v && typeof v === 'object' ? v : {}; const t = ['solid', 'grad', 'img'].includes(v.t) ? v.t : ''; return t ? { t, c1: col(v.c1), c2: col(v.c2), a: Math.max(0, Math.min(360, Math.floor(+v.a >= 0 ? +v.a : 135))), img: id(v.img), url: /^https:\/\/[^\s"'()<>\\]{3,300}$/.test(String(v.url || '').trim()) ? String(v.url).trim() : '', tx: col(v.tx) } : {}; };
    return { logo: id(x.logo), name: tx(x.name, 40), tag: tx(x.tag, 60), nf: fn(x.nf), nc: col(x.nc), bf: fn(x.bf), h1: col(x.h1), h2: col(x.h2), hi: id(x.hi), hc: col(x.hc), bg: col(x.bg), bi: id(x.bi), tc: col(x.tc), ac: col(x.ac), pg: sty(x.pg), hd: sty(x.hd), bx: sty(x.bx), mq: { on: m.on === true, text: tx(m.text, 200), img: id(m.img), bg: col(m.bg), tc: col(m.tc), sp: Math.max(5, Math.min(120, Math.floor(+m.sp || 25))), f: fn(m.f) } }; };
  /* what is live right now (flash sales, free delivery event, Blindbox) as notices for affiliates; worked out on the fly, kept for a minute */
  let LIVEC = { t: 0, v: [] };
  async function liveNews() {
    if (Date.now() - LIVEC.t < 60e3) return LIVEC.v; const t = Date.now(), L = [], cfg = await cfgAll();
    for (const { id, data: d } of await listCol('menu')) { const f = fsOfDoc(d); if (!f || t < f.fs || t >= f.fe || d.off || d.del) continue; const base = CATALOG.find(x => String(x.id) === String(id)), reg = +d.price > 0 ? +d.price : base ? base.p : +d.p || 0; L.push({ id: `live:fs:${id}:${f.fs}`, at: f.fs, k: 'flash', t: `🔥 Flash sale is LIVE: ${str(d.n || (base && base.n) || 'Item', 60)}`, b: `Now ${rpf(f.fp)}${reg > f.fp ? ` (was ${rpf(reg)})` : ''}. Share your link while it lasts!`, by: 'system', personal: false, exp: f.fe }); }
    const fd = cfg.fdev; if (fdLive(fd)) L.push({ id: `live:fd:${fd.fs}`, at: +fd.fs, k: 'flash', t: `🚚 ${str(fd.t, 40) || 'Free delivery'} is LIVE`, b: (fd.full !== false ? 'Delivery is FREE' + ((fd.cs || []).length ? '.' : ' with every courier.') : `${rpf(+fd.amt || 0)} off the delivery price.`) + ((fd.cs || []).length ? ' Only on: ' + fd.cs.map(x => ({ st: 'store courier', sd: 'same-day', in: 'instant', car: 'instant car' })[x]).join(', ') + '.' : ''), by: 'system', personal: false, exp: +fd.fe });
    const bb = await cfgDoc('bb', DEF.bb); if (bbLive(bb, t) && (bb.amt > 0 || bb.box > 0)) L.push({ id: `live:bb:${bb.fs || 0}`, at: bb.fs || t - 3600e3, k: 'flash', t: `🎁 ${str(bb.name, 30) || 'Blindbox'} is LIVE`, b: 'Customers get a chance to win a prize with every big enough order.', by: 'system', personal: false, ...(bb.fe ? { exp: bb.fe } : {}) });
    LIVEC = { t: Date.now(), v: L }; return L;
  }
  async function affNews(a) {
    const ks = (await store.list('sec/affan/')).slice(-150), L = [...await liveNews()]; for (const x of await readAll(ks)) { if (x && (x.to === 'all' || x.to === a.u)) L.push({ id: x.id, at: x.at, k: x.k, t: x.t, b: x.b, by: x.by, personal: x.to !== 'all' }); }
    return L.sort((p, q) => q.at - p.at).slice(0, 40);
  }
  async function apiAff(c) {
    const b = c.req.method === 'POST' ? await bodyOf(c.req, 6000) : {}, op = String(b.op || ''), cfg = await affCfg();
    if (op === 'click') {
      const code = String(b.ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12), ua = (c.req.headers.get('user-agent') || '').toLowerCase(); if (!cfg.on || !okCode(code) || !ua || /bot|crawl|spider|slurp|preview|lighthouse|headless|monitor|curl|wget/.test(ua)) return { ok: true };
      await rlCount(`affk:${c.ip}`, 60, 'ok'); const ix = await store.getJSON('sec/affcode/' + code); if (!ix) return { ok: true }; const a = await store.getJSON('sec/affu/' + ix.u); if (!a || a.st !== 'active') return { ok: true };
      const k = `sec/affk/${a.u}/${dayOf(Date.now())}`, d = (await store.getJSON(k)) || { c: 0, s: {}, v: [] }, h = hmac('affv:' + c.vid).slice(0, 8), s = affSrc(b.src); d.c++; d.s = d.s || {}; d.s[s] = (d.s[s] || 0) + 1; d.v = d.v || []; if (!d.v.includes(h) && d.v.length < 600) d.v.push(h); await store.setJSON(k, d); return { ok: true };
    }
    if (op === 'info') return { on: cfg.on, signup: cfg.signup, rate: cfg.rate, hold: cfg.hold, min: cfg.min, disc: cfg.disc, days: cfg.days, email: cfg.email || '', look: affLook(cfg.look), pay: payInfo(cfg) };
    if (op === 'signup') {
      if (!cfg.on || !cfg.signup) throw E(403, 'closed', 'We are not taking new affiliates right now.'); await tsCheck(c, b, 'aff'); await rlCount(`affs:${c.ip}`, 6, 'Too many sign-ups from this connection. Please try later.');
      const u = String(b.u || '').trim().toLowerCase(), name = str(b.name, 60), email = str(b.email, 100).toLowerCase(), wa = nwa(b.wa); if (!okUser(u)) throw E(400, 'bad_user', 'Username: 3–20 letters, numbers, . or _'); if (!okPw(b.p)) throw E(400, 'bad_pw', 'Password needs at least 10 characters.');
      if (name.length < 2) throw E(400, 'bad_name', 'Please enter your name.'); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw E(400, 'bad_email', 'Please enter a valid email address.'); if (wa.length < 8 || wa.length > 15) throw E(400, 'bad_phone', 'Please enter a valid WhatsApp number.');
      if (await store.getJSON('sec/affu/' + u) || await store.getJSON('sec/staff/' + u)) throw E(409, 'exists', 'That username is taken.');
      let code = String(b.code || u).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); if (code.length < 3) code = (code + 'AFF').slice(0, 12);
      if (await store.getJSON('sec/affcode/' + code) || await getDoc('coupons', code)) { if (b.code) throw E(409, 'code_taken', 'That code is taken. Please choose another one.'); code = (code.slice(0, 8) + rid(2).toUpperCase()).slice(0, 12); }
      await store.setJSON('sec/affu/' + u, { u, name, email, wa, code, st: 'pending', rate: null, disc: null, pay: { ok: false }, ...(await mkCred(b.p)), at: Date.now() }); await store.setJSON('sec/affcode/' + code, { u });
      await slog('aff.new', 'Affiliate application', `${name} (${u}) applied to be an affiliate`, 'system'); return { ok: true, pending: true };
    }
    if (op === 'forgot') {
      await tsCheck(c, b, 'aff'); const u = String(b.u || '').trim().toLowerCase(), key = `affg:${c.ip}`; await rlCheck(key, 8); await rlFail(key); const rec = okUser(u) ? await store.getJSON('sec/affu/' + u) : null;
      if (rec && affOn(rec)) { await store.setJSON('sec/affrs/' + u, { u, at: Date.now() }); await slog('aff.set', `Affiliate ${rec.name}`, 'Asked to reset their password (waiting for their email)', 'system'); }
      return { ok: true, email: cfg.email || '' };
    }
    if (op === 'reset') {
      const key = `affr:${c.ip}`; await rlCheck(key, 10); const t = verTok(b.t), rec = t && t.k === 'affr' ? await store.getJSON('sec/affu/' + t.u) : null;
      if (!rec || (t.v || 0) !== (rec.pwv || 0)) { await rlFail(key); throw E(400, 'bad_link', 'This reset link is not valid any more. Please ask us for a new one.'); }
      if (!okPw(b.p)) throw E(400, 'bad_pw', 'Password needs at least 10 characters.'); const { mustPw, ...rest } = rec;
      await store.setJSON('sec/affu/' + rec.u, { ...rest, ...(await mkCred(b.p)), pwv: (rec.pwv || 0) + 1 }); await store.del('sec/affrs/' + rec.u); await slog('aff.set', `Affiliate ${rec.name}`, 'Chose a new password with a reset link', 'system'); return { ok: true };
    }
    if (op === 'login') {
      await tsCheck(c, b, 'aff'); const u = String(b.u || '').trim().toLowerCase(), key = `affl:${c.ip}:${u}`; await rlCheck(key, 6); const rec = okUser(u) ? await store.getJSON('sec/affu/' + u) : null;
      if (!(await checkPw(rec, b.p))) { await rlFail(key); await new Promise(r => setTimeout(r, 400)); throw E(401, 'bad_login', 'Wrong username or password.'); }
      if (rec.st === 'pending') throw E(403, 'pending', 'Your application is waiting for approval. We will contact you.'); if (rec.st === 'rejected') throw E(403, 'rejected', 'Your application was not approved' + (rec.why ? ': ' + rec.why : '.')); if (!affOn(rec)) throw E(403, 'inactive', 'This affiliate account is switched off. Please contact us.');
      await rlReset(key); c.cookie('aff', signTok({ k: 'aff', u, v: rec.pwv || 0 }, 7 * 86400), 7 * 86400); return { ok: true };
    }
    if (op === 'logout') { c.clear('aff'); return { ok: true }; }
    const a = c.aff; if (!a) throw E(401, 'login', 'Please log in.');
    if (op === 'profile') {
      const pay = isObj(b.pay) ? b.pay : null, upd = { ...a };
      if (b.name !== undefined) upd.name = str(b.name, 60) || a.name; if (b.wa !== undefined) { const w = nwa(b.wa); if (w.length < 8 || w.length > 15) throw E(400, 'bad_phone', 'Please enter a valid WhatsApp number.'); upd.wa = w; }
      if (pay) { const np = { t: pay.t === 'ewallet' ? 'ewallet' : 'bank', bank: str(pay.bank, 40), acc: String(pay.acc || '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 30), nm: str(pay.nm, 60) }; if (!np.bank || np.acc.length < 5 || !np.nm) throw E(400, 'bad_pay', 'Please fill in the bank or e-wallet name, the account number and the account holder name.'); const same = a.pay && a.pay.bank === np.bank && a.pay.acc === np.acc && a.pay.nm === np.nm && a.pay.t === np.t; upd.pay = same ? a.pay : { ...np, ok: false, at: Date.now() }; }
      await store.setJSON('sec/affu/' + a.u, upd); await slog('aff.pay', `Affiliate ${a.name}`, 'Updated their profile / payout details' + (pay && !(a.pay && upd.pay.ok) ? ' – needs your confirmation' : ''), 'system'); return { ok: true };
    }
    if (op === 'pw') { if (!(await checkPw(a, b.p0))) throw E(401, 'bad_login', 'Your current password is not right.'); if (!okPw(b.p1)) throw E(400, 'bad_pw', 'Password needs at least 10 characters.'); const nv = (a.pwv || 0) + 1, { mustPw, ...rest } = a; await store.setJSON('sec/affu/' + a.u, { ...rest, ...(await mkCred(b.p1)), pwv: nv }); c.cookie('aff', signTok({ k: 'aff', u: a.u, v: nv }, 7 * 86400), 7 * 86400); return { ok: true }; }
    if (op === 'seen') { await store.setJSON('sec/affu/' + a.u, { ...a, seenAt: Date.now() }); return { ok: true }; }
    if (op === 'bell') { const news = await affNews(a); return { news, unread: news.filter(n => n.at > (a.seenAt || 0)).length, seen: a.seenAt || 0 }; }
    const L = await affRefresh(a.u);
    if (op === 'payout') {
      if (a.mustPw) throw E(409, 'must_pw', 'Please set a new password first.'); if (a.st !== 'active') throw E(409, 'paused', 'Your account is paused, so payouts are paused too. Please contact us.');
      if (!a.pay || !a.pay.ok) throw E(409, 'pay_unconfirmed', 'Your payout details must be confirmed by the shop first. Please save them and wait for confirmation.');
      const ps = (await store.list('sec/affp/')), open = []; for (const k of ps) { const p = await store.getJSON(k); if (p && p.u === a.u && p.st === 'requested') open.push(p); } if (open.length) throw E(409, 'open', 'You already have a payout request waiting.');
      const ready = L.filter(r => r.st === 'approved' && !r.pid), amt = ready.reduce((t, r) => t + r.amt, 0); if (amt < cfg.min || amt <= 0) throw E(409, 'min', `The minimum payout is ${rpf(cfg.min)}. You have ${rpf(amt)} ready.`);
      const id = Date.now().toString(36) + rid(3); for (const r of ready) await store.setJSON(`sec/affc/${a.u}/${r.no}`, { ...r, pid: id });
      await store.setJSON('sec/affp/' + id, { id, u: a.u, name: a.name, amt, nos: ready.map(r => r.no), st: 'requested', at: Date.now(), pay: { t: a.pay.t, bank: a.pay.bank, acc: a.pay.acc, nm: a.pay.nm } }); await slog('aff.payout', `Affiliate ${a.name}`, `Requested a payout of ${rpf(amt)}`, 'system'); return { ok: true, amt };
    }
    if (op === 'sac') {
      const cfg2 = await affCfg(), sc = sacOf(a, cfg2); if (!sc.on) throw E(403, 'sac_off', 'Sacrifice mode is switched off right now.');
      const v = Math.round(+b.pts * 2) / 2; if (!(v >= 0) || !isFinite(v)) throw E(400, 'bad_pts', 'Please enter a number of points.'); if (v > sc.max) throw E(400, 'sac_max', `You can give up at most ${sc.max} point${sc.max === 1 ? '' : 's'} of your ${sc.rate}% commission.`);
      const DUR = [0, 30, 60, 120, 1440, 4320, 10080, 43200], dm = DUR.includes(+b.dur) ? +b.dur : 0, upd = { ...a, sac: v, sacEnd: v > 0 && dm > 0 ? Date.now() + dm * 60e3 : 0 }; await store.setJSON('sec/affu/' + a.u, upd); await affDiscCode(upd, cfg2); const n = sacOf(upd, cfg2);
      await slog('aff.set', `Affiliate ${a.name}`, v > 0 ? `Sacrifice mode: gives ${v} points${upd.sacEnd ? ' until ' + new Date(upd.sacEnd).toISOString() : ' (no end)'}; customers get ${n.disc}%, commission on code orders ${n.crate}%` : 'Sacrifice mode switched off', 'system'); return { ok: true, sac: n };
    }
    if (op === 'dash' || !op) {
      if (+a.sacEnd > 0 && +a.sacEnd <= Date.now() && +a.sac > 0) { const cfg3 = await affCfg(), ex = { ...a, sac: 0, sacEnd: 0 }; await store.setJSON('sec/affu/' + a.u, ex); await affDiscCode(ex, cfg3); await affNote(a.u, 'info', 'Sacrifice mode ended', 'Your sacrifice time is over. Your customers\' discount and your commission are back to normal.'); Object.assign(a, ex); }
      const [from, to] = b.range ? affRangeOf(b) : [Date.now() - Math.min(90, Math.max(7, Math.floor(+b.days || 30))) * 864e5, Date.now() + 1], stats = await affStats(a.u, L, from, to), pays = [], news = await affNews(a);
      for (const p of await readAll(await store.list('sec/affp/'))) { if (p && p.u === a.u) pays.push({ id: p.id, amt: p.amt, st: p.st, at: p.at, paidAt: p.paidAt || 0, ref: p.ref || '', n: p.nos.length, note: p.st === 'rejected' ? p.note || '' : '' }); }
      const top = {}; for (const r of L.filter(r => inRange(r.at, from, to)).slice(0, 100)) if (r.st !== 'void') { const o = await getDoc('orders', r.no); for (const i of (o && o.items) || []) { const t = top[i.n] || (top[i.n] = { n: i.n, e: i.e || '', q: 0 }); t.q += i.q; } }
      return { me: { u: a.u, name: a.name, email: a.email, wa: a.wa, code: a.code, st: a.st, mustPw: !!a.mustPw, seen: a.seenAt || 0, rate: a.rate != null ? a.rate : cfg.rate, disc: a.disc != null ? a.disc : cfg.disc, sac: sacOf(a, cfg), pay: a.pay ? { t: a.pay.t, bank: a.pay.bank, acc: a.pay.acc ? '••••' + a.pay.acc.slice(-4) : '', nm: a.pay.nm, ok: !!a.pay.ok } : null },
        cfg: { hold: cfg.hold, min: cfg.min, days: cfg.days, on: cfg.on, email: cfg.email || '', pay: payInfo(cfg), sac: sacClean(cfg.sac) }, stats: { ...stats, range: [from, to] }, money: { pending: sumBy(L, 'pending'), approved: sumBy(L, 'approved'), ready: L.filter(r => r.st === 'approved' && !r.pid).reduce((t, r) => t + r.amt, 0), inpay: L.filter(r => r.st === 'approved' && r.pid).reduce((t, r) => t + r.amt, 0), paid: sumBy(L, 'paid'), void: sumBy(L, 'void') },
        orders: L.filter(r => inRange(r.at, from, to)).slice(0, 400).map(r => ({ no: r.no, at: r.at, name: r.name, n: r.n, base: r.base, rate: r.rate, sac: r.sac || 0, amt: r.amt, st: r.pid && r.st === 'approved' ? 'inpay' : r.st, why: r.why || '', okAt: r.okAt || 0, via: r.via || 'link', pd: !!r.pd || r.st === 'approved' || r.st === 'paid' })), payouts: pays.sort((x, y) => y.at - x.at), top: Object.values(top).sort((x, y) => y.q - x.q).slice(0, 8), news, unread: news.filter(n => n.at > (a.seenAt || 0)).length };
    }
    throw E(400, 'bad_op', 'Unknown action.');
  }
  /* owner: the dashboard over all affiliates, for a chosen period */
  function affRangeOf(b) {
    const now = Date.now(), t = new Date(now + tzH() * 3600e3), d0 = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - tzH() * 3600e3, r = String(b.range || '30');
    if (r === 'today') return [d0, now + 1]; if (r === '7') return [d0 - 6 * 864e5, now + 1]; if (r === '30') return [d0 - 29 * 864e5, now + 1];
    if (r === 'month') return [Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - tzH() * 3600e3, now + 1]; if (r === 'custom') { const f = Math.max(0, +b.from || 0), e = Math.min(now + 864e5, +b.to || now); return [f, Math.max(f + 1, e)]; } return [0, now + 1];
  }
  async function apiAffo(c) {
    if (!c.owner()) throw E(403, 'forbidden', 'Owner only.'); const b = c.req.method === 'POST' ? await bodyOf(c.req, 6000) : {}, op = String(b.op || 'overview'), cfg = await affCfg();
    const all = async () => (await readAll(await store.list('sec/affu/'))).filter(Boolean);
    if (op === 'overview' || op === 'list') {
      const [from, to] = affRangeOf(b), tot = { views: 0, uniq: new Set(), orders: 0, coupon: 0, sales: 0, pending: 0, ready: 0, inpay: 0, paid: 0, void: 0 }, srcs = {}, ords = [], out = [];
      for (const { a, L, ck } of await Promise.all((await all()).map(async a => { const [L, ck] = await Promise.all([affRefresh(a.u), affClicks(a.u, from, to)]); return { a, L, ck }; }))) {
        const R = L.filter(r => inRange(r.at, from, to)), live = R.filter(r => r.st !== 'void');
        const s = { views: ck.views, uniq: ck.uniq.size, orders: R.length, coupon: R.filter(r => r.via === 'coupon').length, sales: live.reduce((t, r) => t + r.base, 0), pending: sumBy(R, 'pending'), ready: R.filter(r => r.st === 'approved' && !r.pid).reduce((t, r) => t + r.amt, 0), inpay: R.filter(r => r.st === 'approved' && r.pid).reduce((t, r) => t + r.amt, 0), paid: sumBy(R, 'paid'), void: sumBy(R, 'void') };
        const ready = L.filter(r => r.st === 'approved' && !r.pid).reduce((t, r) => t + r.amt, 0), inpayAll = L.filter(r => r.st === 'approved' && r.pid).reduce((t, r) => t + r.amt, 0);
        for (const k of ['views', 'orders', 'coupon', 'sales', 'pending', 'ready', 'inpay', 'paid', 'void']) tot[k] += s[k]; for (const h of ck.uniq) tot.uniq.add(h);
        for (const [k, n] of Object.entries(ck.src)) { (srcs[k] = srcs[k] || { v: 0, o: 0, s: 0 }).v += n; } for (const r of live) { const k = r.src || 'direct'; (srcs[k] = srcs[k] || { v: 0, o: 0, s: 0 }); srcs[k].o++; srcs[k].s += r.base; }
        for (const r of R) ords.push({ no: r.no, u: a.u, an: a.name, at: r.at, base: r.base, rate: r.rate, amt: r.amt, st: r.pid && r.st === 'approved' ? 'inpay' : r.st, why: r.why || '', via: r.via || 'link', name: r.name });
        out.push({ u: a.u, name: a.name, email: a.email, wa: a.wa, code: a.code, st: a.st, rate: a.rate, disc: a.disc, sm: a.sm == null ? null : a.sm, sac: sacOf(a, cfg).pts, at: a.at, why: a.why || '', payOk: !!(a.pay && a.pay.ok), payHas: !!(a.pay && a.pay.acc), pay: a.pay && a.pay.acc ? { bank: a.pay.bank, last: a.pay.acc.slice(-4) } : null, readyAll: ready, inpayAll, ...s });
      }
      const pays = (await readAll(await store.list('sec/affp/'))).filter(Boolean);
      const anns = []; for (const x of await readAll((await store.list('sec/affan/')).slice(-120))) { if (x && x.by === 'owner') anns.push(x); }
      const resets = []; for (const r of await readAll(await store.list('sec/affrs/'))) { const x = r && out.find(o => o.u === r.u); if (x) resets.push({ u: x.u, name: x.name, email: x.email, at: r.at }); }
      const pi = payInfo(cfg), elig = out.filter(a => a.st === 'active' && a.readyAll >= cfg.min && a.readyAll > 0);
      return { range: [from, to], resets: resets.sort((x, y) => y.at - x.at), tiles: { ...tot, uniq: tot.uniq.size }, src: srcs, list: out.sort((x, y) => y.sales - x.sales || y.views - x.views), orders: ords.sort((x, y) => y.at - x.at).slice(0, 400), payouts: pays.sort((x, y) => y.at - x.at).slice(0, 80), news: anns.sort((x, y) => y.at - x.at).slice(0, 30), cfg, payday: { ...pi, ready: elig.length, amt: elig.reduce((t, a) => t + a.readyAll, 0), waiting: pays.filter(p => p.st === 'requested').length } };
    }
    if (op === 'get') {
      const a = await store.getJSON('sec/affu/' + String(b.u || '')); if (!a) throw E(404, 'not_found', 'Affiliate not found.'); const L = await affRefresh(a.u), st = await affStats(a.u, L, Date.now() - 30 * 864e5, Date.now() + 1), pays = []; for (const p of await readAll(await store.list('sec/affp/'))) { if (p && p.u === a.u) pays.push(p); }
      return { a: { u: a.u, name: a.name, email: a.email, wa: a.wa, code: a.code, st: a.st, rate: a.rate, disc: a.disc, sm: a.sm == null ? null : a.sm, sac: sacOf(a, cfg), at: a.at, pay: a.pay || null, note: a.note || '', why: a.why || '' }, stats: st, orders: L.slice(0, 200), payouts: pays.sort((x, y) => y.at - x.at), money: { pending: sumBy(L, 'pending'), approved: sumBy(L, 'approved'), paid: sumBy(L, 'paid'), void: sumBy(L, 'void') } };
    }
    if (op === 'annSend') {
      const t = str(b.t, 80), body = str(b.b, 400); if (t.length < 2 || body.length < 2) throw E(400, 'bad_text', 'Please write a title and a message.'); const to = b.to === 'all' ? 'all' : String(b.to || ''); if (to !== 'all' && !(await store.getJSON('sec/affu/' + to))) throw E(404, 'not_found', 'Affiliate not found.');
      const id = Date.now().toString(36) + rid(3); await store.setJSON('sec/affan/' + id, { id, at: Date.now(), to, k: ['flash', 'coupon', 'feature', 'info'].includes(b.k) ? b.k : 'info', t, b: body, by: 'owner' }); await slog('aff.news', 'Affiliate announcement', `Sent to ${to === 'all' ? 'all affiliates' : to}: ${t}`, c.staff.u); return { ok: true };
    }
    if (op === 'annDel') { const x = await store.getJSON('sec/affan/' + String(b.id || '')); if (x && x.by === 'owner') await store.del('sec/affan/' + x.id); return { ok: true }; }
    const a = await store.getJSON('sec/affu/' + String(b.u || ''));
    if (op === 'set') {
      if (!a) throw E(404, 'not_found', 'Affiliate not found.'); const upd = { ...a };
      if (['pending', 'active', 'paused', 'suspended', 'rejected'].includes(b.st)) upd.st = b.st; if (upd.st === 'rejected') upd.why = str(b.why, 160); else if (upd.st !== a.st) delete upd.why; if (b.rate === null || b.rate === '') upd.rate = null; else if (b.rate !== undefined) upd.rate = num2(b.rate, 0, 80); if (b.disc === null || b.disc === '') upd.disc = null; else if (b.disc !== undefined) upd.disc = num2(b.disc, 0, 50); if (b.note !== undefined) upd.note = str(b.note, 200); if (b.sm === null || b.sm === '') upd.sm = null; else if (b.sm !== undefined) upd.sm = num2(b.sm, 0, 100);
      await store.setJSON('sec/affu/' + a.u, upd); await affDiscCode(upd, cfg); await slog('aff.set', `Affiliate ${a.name}`, `Status ${upd.st}${upd.why ? ' (' + upd.why + ')' : ''}, rate ${upd.rate == null ? 'default' : upd.rate + '%'}, customer discount ${upd.disc == null ? 'default' : upd.disc + '%'}`, c.staff.u);
      if (upd.st !== a.st) { const m = { active: ['Your account is active', 'Welcome! Share your link and code to start earning.'], paused: ['Your account is paused', 'New orders are not credited while it is paused. Please contact us if you have questions.'], suspended: ['Your account is switched off', 'Please contact us if you have questions.'] }[upd.st]; if (m) await affNote(a.u, 'info', m[0], m[1]); }
      return { ok: true };
    }
    if (op === 'resetpw') {
      if (!a) throw E(404, 'not_found', 'Affiliate not found.'); const al = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let pw = ''; for (let i = 0; i < 12; i++) pw += al[crypto.randomInt(al.length)];
      await store.setJSON('sec/affu/' + a.u, { ...a, ...(await mkCred(pw)), pwv: (a.pwv || 0) + 1, mustPw: true }); await slog('aff.set', `Affiliate ${a.name}`, 'Password reset by the owner (a temporary password was created)', c.staff.u); return { ok: true, pw };
    }
    if (op === 'resetlink') {
      if (!a) throw E(404, 'not_found', 'Affiliate not found.'); await store.del('sec/affrs/' + a.u); await slog('aff.set', `Affiliate ${a.name}`, 'Password reset link created by the owner (valid 24 hours)', c.staff.u);
      return { ok: true, t: signTok({ k: 'affr', u: a.u, v: a.pwv || 0 }, 24 * 3600), email: a.email, name: a.name };
    }
    if (op === 'resetdone') { if (a) await store.del('sec/affrs/' + a.u); return { ok: true }; }
    if (op === 'confirm') { if (!a || !a.pay || !a.pay.acc) throw E(409, 'no_pay', 'This affiliate has not entered payout details yet.'); await store.setJSON('sec/affu/' + a.u, { ...a, pay: { ...a.pay, ok: b.ok !== false, okAt: Date.now(), by: c.staff.u } }); await slog('aff.pay', `Affiliate ${a.name}`, `Payout details ${b.ok === false ? 'un-confirmed' : 'confirmed'}: ${a.pay.bank} ${a.pay.acc} (${a.pay.nm})`, c.staff.u); if (b.ok !== false) await affNote(a.u, 'payout', 'Payout details confirmed', 'You can now request a payout when you reach the minimum.'); return { ok: true }; }
    if (op === 'void' || op === 'approve') {
      if (!a) throw E(404, 'not_found', 'Affiliate not found.'); const k = `sec/affc/${a.u}/${String(b.no || '')}`, r = await store.getJSON(k); if (!r) throw E(404, 'not_found', 'Order not found.'); if (r.st === 'paid') throw E(409, 'paid', 'That commission was already paid.');
      if (op === 'void') { await store.setJSON(k, { ...r, st: 'void', why: 'Voided by the shop' + (b.why ? ': ' + str(b.why, 100) : ''), pid: undefined }); await affNote(a.u, 'order', `Order #${r.no}: no commission`, `The shop cancelled this commission${b.why ? ': ' + str(b.why, 100) : '.'}`); }
      else { if (r.st !== 'pending') throw E(409, 'state', 'Only a pending commission can be approved early.'); await store.setJSON(k, { ...r, st: 'approved', okAt: Date.now() }); await affNote(a.u, 'order', 'Commission approved', `Order #${r.no}: ${rpf(r.amt)} is ready to withdraw.`); }
      await slog('aff.set', `Affiliate ${a.name}`, `${op === 'void' ? 'Voided' : 'Approved'} the commission of order #${r.no}`, c.staff.u); return { ok: true };
    }
    if (op === 'pay') {
      const p = await store.getJSON('sec/affp/' + String(b.id || '')); if (!p || p.st !== 'requested') throw E(404, 'not_found', 'That payout request is not waiting.');
      if (b.act === 'reject') { for (const no of p.nos) { const k = `sec/affc/${p.u}/${no}`, r = await store.getJSON(k); if (r && r.pid === p.id) { delete r.pid; await store.setJSON(k, r); } } await store.setJSON('sec/affp/' + p.id, { ...p, st: 'rejected', note: str(b.note, 120), at2: Date.now() }); await slog('aff.payout', `Affiliate ${p.name}`, 'Payout request rejected' + (b.note ? ': ' + str(b.note, 120) : ''), c.staff.u); await affNote(p.u, 'payout', 'Payout request not paid', `Your request of ${rpf(p.amt)} was not paid${b.note ? ': ' + str(b.note, 120) : '.'} The money is back in your balance.`); return { ok: true }; }
      if (b.act !== 'paid') throw E(400, 'bad_act', 'Unknown action.');
      const L = await affRefresh(p.u), mine = L.filter(r => r.pid === p.id && r.st === 'approved'), amt = mine.reduce((t, r) => t + r.amt, 0);
      if (amt <= 0) { await store.setJSON('sec/affp/' + p.id, { ...p, st: 'rejected', note: 'Nothing left to pay (commissions were cancelled).', at2: Date.now() }); throw E(409, 'empty', 'Nothing left to pay: the commissions were cancelled.'); }
      for (const r of mine) await store.setJSON(`sec/affc/${p.u}/${r.no}`, { ...r, st: 'paid', paidAt: Date.now() });
      await store.setJSON('sec/affp/' + p.id, { ...p, st: 'paid', amt, nos: mine.map(r => r.no), ref: str(b.ref, 60), img: okBlobId(b.img), paidAt: Date.now(), by: c.staff.u }); await slog('aff.payout', `Affiliate ${p.name}`, `Payout of ${rpf(amt)} marked paid${b.ref ? ' – ref ' + str(b.ref, 60) : ''}`, c.staff.u);
      await affNote(p.u, 'payout', 'Payout sent 💸', `We sent ${rpf(amt)} to your ${p.pay.bank} account${b.ref ? ' (ref ' + str(b.ref, 60) + ')' : ''}.`); return { ok: true, amt };
    }
    throw E(400, 'bad_op', 'Unknown action.');
  }
  /* ---------- router ---------- */
  async function handle(req) {
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '');
    try {
      if (path.startsWith('/_blob/')) return await serveBlob(path.slice(7));
      if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/feed.xml' || path === '/sitemap.xml' || path === '/robots.txt' || path === '/llms.txt' || path.startsWith('/p/'))) return await seoRoute(req, url, path);
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '') return await homeRoute(req, url);
      if (!path.startsWith('/api/')) return new Response('Not found', { status: 404 });
      if (req.method !== 'GET' && req.method !== 'HEAD') { const o = req.headers.get('origin'); if (o && new URL(o).host !== url.host) throw E(403, 'origin', 'Cross-site requests are not allowed.'); }
      const c = await ctxOf(req), r = path.slice(5); let data;
      if (!c.adminHost && OWNER_ONLY.has(r)) throw E(404, 'not_found', 'Not found');
      if (r === 'me') data = await apiMe(c); else if (r === 'rev') data = await apiRev(c); else if (r === 'db') data = await apiDb(c);
      else if (r === 'hit') data = await apiHit(c); else if (r === 'stats') data = await apiStats(c);
      else if (r === 'order') data = await apiOrder(c); else if (r === 'edit') data = await apiEdit(c); else if (r === 'cancel') data = await apiCancel(c); else if (r === 'pay') data = await apiPay(c);
      else if (r === 'claim') data = await apiClaim(c); else if (r === 'complaint') data = await apiComplaint(c); else if (r === 'review') data = await apiReview(c); else if (r === 'payrev') data = await apiPayRev(c);
      else if (r === 'setup') data = await apiSetup(c); else if (r === 'login') data = await apiLogin(c); else if (r === 'logout') data = await apiLogout(c); else if (r === 'reauth') data = await apiReauth(c);
      else if (r === 'staff') data = await apiStaff(c); else if (r.startsWith('b2b/')) data = await apiB2b(c, r.slice(4)); else if (r === 'upload') data = await apiUpload(c);
      else if (r === 'rates') data = await apiRates(c); else if (r === 'geo') data = await apiGeo(c);
      else if (r === 'courier') data = await apiCourier(c); else if (r === 'bshook') data = await apiBsHook(c); else if (r === 'pickup') data = await apiPickup(c); else if (r === 'radius') data = await apiRadius(c); else if (r === 'turnstile') data = await apiTurnstile(c); else if (r === 'mkt') data = await apiMkt(c); else if (r === 'doku') data = await apiDoku(c); else if (r === 'coupon') data = await apiCoupon(c); else if (r === 'aff') data = await apiAff(c); else if (r === 'affo') data = await apiAffo(c); else if (r === 'bb') data = await apiBb(c); else if (r === 'pl') data = await apiPl(c); else if (r === 'pos') data = await apiPos(c); else if (r === 'dokuhook') data = await apiDokuHook(c); else if (r === 'pview') data = await apiPview(c); else if (r === 'pclicks') data = await apiPclicks(c);
      else throw E(404, 'not_found', 'Not found');
      return reply(data, 200, c.out);
    } catch (e) {
      if (!(e instanceof HttpError)) { console.error(e); e = E(500, 'server_error', 'Something went wrong on the server.'); }
      return reply({ error: e.message, code: e.code }, e.status, []);
    }
  }
  function reply(data, status, cookies) { const h = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' }); cookies.forEach(x => h.append('set-cookie', x)); return new Response(JSON.stringify(data), { status, headers: h }); }
  return { handle, calc, _internals: { listCol, getDoc, putDoc, store, resetSweep: () => { lastSweep = 0; } } };
}
