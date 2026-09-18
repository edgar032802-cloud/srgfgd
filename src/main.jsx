import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { watchBuild } from './lib/build.js'

// 배포 전에 열어 둔 탭이 옛 화면 코드를 계속 돌리지 않도록 (src/lib/build.js)
watchBuild()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
