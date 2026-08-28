import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  // Port 5211 is this app's reserved port. strictPort means a busy port is a
  // startup failure, never a silent reassignment.
  // Keep this in sync with the dev/start scripts in package.json.
  server: {
    port: 5211,
    strictPort: true,
  },
  ssr: {
    // better-sqlite3 is a native addon. It must be externalized rather than
    // bundled into the server build, or Vite tries to inline a compiled
    // .node binary and the build fails.
    external: ["better-sqlite3"],
  },
  plugins: [vinext()],
});
