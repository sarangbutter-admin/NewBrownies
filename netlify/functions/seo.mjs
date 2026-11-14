import { getApp } from './app.mjs';
export default async (req) => getApp().handle(req);
// Public marketing pages: product feed (Google/Meta), sitemap, robots.txt and one crawlable page per product. Built live from the menu.
export const config = { path: ['/', '/feed.xml', '/sitemap.xml', '/robots.txt', '/llms.txt', '/p/*'], rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
