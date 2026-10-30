import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readAndroidVersion } from './scripts/version.mjs'

// 与 APK 构建共用版本解析和校验，界面不再单独维护版本字符串。
const { versionName } = readAndroidVersion(readFileSync(new URL('./android/app/build.gradle', import.meta.url), 'utf8'))

// Web 与 Capacitor 共同使用这份构建结果；无需为这个单页应用生成模块预加载。
export default defineConfig({
  plugins: [vue()],
  // 构建时写入只读版本，浏览器与离线 WebView 均可直接展示。
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(versionName) },
  build: { modulePreload: false },
})
