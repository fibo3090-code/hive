import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  document.body.textContent = 'Failed to find #root — check index.html shell.';
} else {
  createRoot(rootElement).render(<App />);
}
