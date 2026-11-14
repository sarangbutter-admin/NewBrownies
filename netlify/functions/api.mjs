import { getApp } from './app.mjs';
export default async (req) => getApp().handle(req);
// Cost protection: one visitor (IP address) can make at most 120 API calls per minute; extra calls get HTTP 429
// and never reach the database. A normal customer makes about 4 calls per minute. (Netlify applies this rule itself.)
export const config = { path: ['/api/*'], rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
