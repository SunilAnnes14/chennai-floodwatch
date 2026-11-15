import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Any request to /api is forwarded to the Python backend on port 8000
    // (set API_URL to use a different backend address)
    proxy: { "/api": process.env.API_URL || "http://localhost:8000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
  },
});
