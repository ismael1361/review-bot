import { defineConfig, loadEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { loadConfig } from "./src/config";

export function createViteConfig(env: NodeJS.ProcessEnv): UserConfig {
  const config = loadConfig(env);

  return {
    root: "src/web",
    plugins: [react(), tailwindcss()],
    build: { outDir: "../../dist/web", emptyOutDir: true },
    server: {
      port: 5173,
      proxy: {
        "^/api(?:/|$)": `http://127.0.0.1:${config.PORT}`,
        "^/healthz(?:/|$)": `http://127.0.0.1:${config.PORT}`,
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  return createViteConfig({ ...fileEnv, ...process.env });
});
