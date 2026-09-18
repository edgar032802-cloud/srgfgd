import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "")

  // The dev port is assigned by whoever launches us (PORT), not fixed here.
  // Nothing in the app depends on a specific origin: API calls are relative and
  // proxied, and the Toss return URLs are built from window.location.origin.
  const port = Number(process.env.PORT) || Number(env.PORT) || 5173

  // The API is a separate process on its own port. It deliberately does NOT use
  // PORT — that name collided with the dev server's and made the site flaky.
  const apiPort = env.API_PORT || "8787"

  // 빌드마다 새 이름. 화면 코드에 박히고(__BUILD_ID__) dist/build.json 으로도 나가서,
  // 서버가 "지금 배포된 화면"의 이름을 응답마다 알려 준다. 배포 전에 열어 둔 탭은
  // 옛 화면 코드를 계속 돌리는데, 이름이 다르면 스스로 한 번 새로 불러온다
  // (src/lib/build.js). 개발 서버에서는 "dev" 라 이 확인을 하지 않는다.
  const buildId =
    command === "build" ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : "dev"

  return {
    plugins: [
      react(),
      {
        name: "freesia-build-id",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "build.json", source: JSON.stringify({ id: buildId }) })
        },
      },
    ],
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    server: {
      port,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
  }
})
