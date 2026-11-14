import { getApp } from './app.mjs';
export default async (req) => getApp().handle(req);
// Uploaded photos/videos are served here. Answers are cached for a year by the browser and by Netlify's CDN,
// so each picture is read from the database only once. The limit protects against floods of requests.
export const config = { path: ['/_blob/*'], rateLimit: { windowLimit: 400, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
