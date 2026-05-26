import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { componentTagger } from "lovable-tagger";
import { readFileSync } from "node:fs";

// Read once at config-load so the Settings → About page can show the
// real version + build date instead of hardcoded strings that drift.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")) as { version?: string };
const BUILD_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const APP_VERSION = pkg.version ?? "0.0.0";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Only inject env vars prefixed `VITE_` into the browser bundle so a
  // stray `OPENAI_API_KEY` in the shell never ends up shipped to clients.
  envPrefix: ["VITE_"],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Page-level chunks come from React.lazy(); these manualChunks group
    // the heavy shared runtime deps into their own files so every lazy
    // page that uses them hits the same cache entry instead of bundling
    // a copy of each. Cuts the per-page download substantially after the
    // first visit. Drop the warning ceiling since the new chunks are
    // intentionally larger than the default 500 KB threshold.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
          'vendor-router': ['react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-flow': ['@xyflow/react'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
}));
