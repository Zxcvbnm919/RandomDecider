import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.desktop) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // 离线缓存失败不影响在线使用
    })
  })
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
