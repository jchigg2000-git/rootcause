import { DiagnosticApp } from "./diagnostic-app";
import { env } from "./lib/server-env.ts";
import { SETTINGS_DEFAULTS, getSettings } from "./lib/settings.ts";

/**
 * The photo cap is read here rather than fetched by the client.
 *
 * `maxPhotos` is a server setting the intake form has to obey — the diagnose
 * route refuses a request that exceeds it — and until this was passed down the
 * form capped at the hard-coded transport maximum and advertised that number,
 * so lowering the setting produced a picker that accepted four photos and a
 * diagnosis that then failed with a 400. This page is a server component, so it
 * can read the value directly and the form is never briefly wrong while a fetch
 * is in flight.
 */
export default async function Home() {
  const settings = env.APP_DB ? await getSettings(env.APP_DB) : SETTINGS_DEFAULTS;
  return <DiagnosticApp maxPhotos={settings.maxPhotos} />;
}
