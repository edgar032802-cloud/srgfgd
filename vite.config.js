import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  // The dev port is assigned by whoever launches us (PORT), not fixed here.
  // Nothing in the app depends on a specific origin: API calls are relative and
  // proxied, and the Toss return URLs are built from window.location.origin.
  const port = Number(process.env.PORT) || Number(env.PORT) || 5173

  // The API is a separate process on its own port. It deliberately does NOT use
  // PORT — that name collided with the dev server's and made the site flaky.
  const apiPort = env.API_PORT || "8787"

  return {
    plugins: [react()],
    server: {
      port,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
  }
})
