import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Build-time constants injected via `vite.config.ts → define`. Settings →
// About reads these so the version/build-date track the real build rather
// than drift to stale hardcoded strings.
declare global {
  const __APP_VERSION__: string;
  const __BUILD_DATE__: string;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  document.body.textContent = 'Failed to find #root — check index.html shell.';
} else {
  createRoot(rootElement).render(<App />);
}
