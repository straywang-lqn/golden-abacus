import type { CapacitorConfig } from '@capacitor/cli'

// appId 决定 Android 升级身份，webDir 指向 Vite 的生成目录；常规升级不可更改。
const config: CapacitorConfig = {
  appId: 'com.goldenabacus.app',
  appName: '金算盘',
  webDir: 'dist',
  // Debug 安装包也不能记录包含 API Key 的桥接参数。
  loggingBehavior: 'none',
}

export default config
