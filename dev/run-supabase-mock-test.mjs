import { startMock } from './mock-supabase.mjs';
const srv = await startMock(54399); process.env.TEST_SUPABASE_URL = 'http://localhost:54399';
try { await import('./test-api.mjs'); } finally { srv.close(); setTimeout(() => process.exit(0), 100); }
