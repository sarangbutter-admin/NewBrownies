// Local development / test storage (files). Not used in production.
import fs from 'node:fs'; import path from 'node:path';
export function fsStore(root) {
  const f = k => { if (!/^[A-Za-z0-9\/_.\-]+$/.test(k) || k.includes('..')) throw new Error('bad key ' + k); return path.join(root, k); };
  const readJ = async k => { try { return JSON.parse(await fs.promises.readFile(f(k) + '.json', 'utf8')); } catch { return null; } };
  return {
    getJSON: readJ,
    setJSON: async (k, v) => { const p = f(k) + '.json'; await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, JSON.stringify(v)); },
    del: async k => { for (const x of ['.json', '.bin']) try { await fs.promises.unlink(f(k) + x); } catch {} },
    list: async prefix => { const dir = f(prefix.replace(/\/$/, '')); let out = []; try { for (const n of await fs.promises.readdir(dir)) if (n.endsWith('.json')) out.push(prefix + n.slice(0, -5)); } catch {} return out; },
    listJSON: async prefix => { const out = []; for (const k of await (async () => { const dir = f(prefix.replace(/\/$/, '')); try { return (await fs.promises.readdir(dir)).filter(n => n.endsWith('.json')).map(n => prefix + n.slice(0, -5)); } catch { return []; } })()) out.push({ key: k, value: await readJ(k) }); return out; },
    getBin: async k => { try { const b = await fs.promises.readFile(f(k) + '.bin'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch { return null; } },
    setBin: async (k, buf) => { const p = f(k) + '.bin'; await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, Buffer.from(buf)); }
  };
}
