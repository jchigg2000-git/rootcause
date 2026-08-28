/**
 * Server environment, read from the Node process.
 *
 * Replaces `import { env } from "cloudflare:workers"`, which only resolves
 * inside workerd. Same shape, so call sites did not have to change.
 *
 * The database handles are filled in by `instrumentation.ts` at process start.
 * Until then they are undefined, and `gate()` already answers a missing
 * AUTH_DB with a 500 rather than an unguarded crash.
 */

import type { Database } from "./db.ts";

export type ServerEnv = {
  AUTH_DB?: Database;
  APP_DB?: Database;
  /** LLM telemetry store (db/observability.db) — metrics only, prunable. */
  OBS_DB?: Database;
  HF_TOKEN?: string;
  HF_MODEL?: string;
  HF_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  COOKIE_SECURE?: string;
  ENVIRONMENT?: string;
  /** Directory holding auth.db, app.db and skeleton.key. Must be a mounted
   *  volume in any deployment, or the owner's key is regenerated every deploy. */
  DB_DIR?: string;
};

export const env: ServerEnv = {
  get HF_TOKEN() {
    return process.env.HF_TOKEN;
  },
  get HF_MODEL() {
    return process.env.HF_MODEL;
  },
  get HF_BASE_URL() {
    return process.env.HF_BASE_URL;
  },
  get ANTHROPIC_API_KEY() {
    return process.env.ANTHROPIC_API_KEY;
  },
  get COOKIE_SECURE() {
    return process.env.COOKIE_SECURE;
  },
  get ENVIRONMENT() {
    return process.env.ENVIRONMENT;
  },
  get DB_DIR() {
    return process.env.DB_DIR;
  },
};
