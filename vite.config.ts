import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:7777", changeOrigin: false },
      "/ws": { target: "ws://localhost:7777", ws: true },
    },
  },
});
