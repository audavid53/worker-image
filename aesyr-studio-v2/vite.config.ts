import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devApi } from "./server/dev-api";

export default defineConfig(({ mode }) => {
  // Load all variables (no VITE_ prefix filter) for the server side only; none reach the client.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      devApi({
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        OPENAI_MODEL: env.OPENAI_MODEL,
        GOOGLE_API_KEY: env.GOOGLE_API_KEY,
        GOOGLE_IMAGE_MODEL: env.GOOGLE_IMAGE_MODEL,
        TRIPO_API_KEY: env.TRIPO_API_KEY,
        RUNPOD_API_KEY: env.RUNPOD_API_KEY,
        RUNPOD_BLENDER_ENDPOINT_ID: env.RUNPOD_BLENDER_ENDPOINT_ID,
        RUNPOD_UNIMATE_ENDPOINT_ID: env.RUNPOD_UNIMATE_ENDPOINT_ID,
        BLENDER_PATH: env.BLENDER_PATH,
        DEV_CREDITS: env.DEV_CREDITS,
      }),
    ],
    server: { port: 5180, strictPort: true, watch: { ignored: ["**/.local-media/**"] } },
  };
});
