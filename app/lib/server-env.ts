/**
 * Server environment, read from the Node process.
 *
 * The database handles are filled in by `instrumentation.ts` at process start.
 * Until then they are undefined, and every route that needs one answers a
 * missing handle with a 500 rather than an unguarded crash.
 */

import type { Database } from "./db.ts";

export type ServerEnv = {
  APP_DB?: Database;
  /** LLM telemetry store (db/observability.db) — metrics only, prunable. */
  OBS_DB?: Database;
  HF_TOKEN?: string;
  HF_MODEL?: string;
  HF_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ENVIRONMENT?: string;
  /** Directory holding the SQLite files. Must be a persistent path in any
   *  deployment, or every restart starts with an empty database. */
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
  get ENVIRONMENT() {
    return process.env.ENVIRONMENT;
  },
  get DB_DIR() {
    return process.env.DB_DIR;
  },
};
