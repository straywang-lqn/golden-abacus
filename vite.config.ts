import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Web 与 Capacitor 共同使用这份构建结果；无需为这个单页应用生成模块预加载。
export default defineConfig({
  plugins: [vue()],
  build: { modulePreload: false },
})
