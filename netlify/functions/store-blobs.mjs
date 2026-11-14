// Production storage: Netlify Blobs (no external database or credentials needed).
import { getStore } from '@netlify/blobs';
export function blobStore(name = 'sarang') {
  const s = getStore({ name, consistency: 'strong' });
  return {
    getJSON: k => s.get(k, { type: 'json' }),
    setJSON: (k, v) => s.setJSON(k, v),
    del: k => s.delete(k),
    list: async prefix => (await s.list({ prefix })).blobs.map(b => b.key),
    getBin: k => s.get(k, { type: 'arrayBuffer' }),
    setBin: (k, buf) => s.set(k, buf)
  };
}
