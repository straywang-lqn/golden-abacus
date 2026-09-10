import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// 浏览器与 Capacitor 共用同一个 Vue 入口；平台差异由 App.vue 内部处理。
createApp(App).mount('#app')
