// One shared server instance, used by the API function and the image function.
import { makeApp } from './core.mjs';
import { blobStore } from './store-blobs.mjs';
import { supabaseStore } from './store-supabase.mjs';
let app;
// Supabase is used when both variables are set; otherwise Netlify Blobs (nothing else to configure).
const pick = () => (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? supabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY })
  : blobStore());
export const getApp = () => (app = app || makeApp(pick()));
