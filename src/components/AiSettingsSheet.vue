<script setup lang="ts">
import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { requestAi, type AiConfig } from '../aiClient'
import { useSheetFocus } from '../useSheetFocus'
/** 配置草稿独立于已保存设置，取消不改变设备配置。 */
const props = defineProps<{ config: AiConfig; saving: boolean; error: string }>()
/** 持久化仍由顶层处理。 */
const emit = defineEmits<{ close: []; save: [config: AiConfig]; clear: [] }>()
/** 普通副本避免改动父组件；Key 不进入模板文本。 */
const draft = ref({ ...props.config })
/** 测试只发送固定非账本内容，关闭时终止等待。 */
const testing = ref(false)
const feedback = ref('')
const panel = ref<HTMLElement>()
const controller = new AbortController()
useSheetFocus(panel, close)
/** 关闭允许取消测试，不能中断正在提交的配置保存。 */
function close() { if (!props.saving) { controller.abort(); emit('close') } }
/** 测试不能自动启用或保存配置。 */
async function testConnection() {
  if (testing.value) return
  testing.value = true
  feedback.value = ''
  try {
    const text = await requestAi({ ...draft.value, enabled: true }, [{ role: 'user', content: '只返回 JSON 对象 {"ok":true}' }], controller.signal)
    if (JSON.parse(text).ok !== true) throw new Error('模型未按要求返回 JSON，请检查模型配置')
    feedback.value = '连接成功，支持 JSON 输出'
  } catch (error) { feedback.value = error instanceof Error ? error.message : '连接失败' }
  finally { testing.value = false }
}
</script>
<template>
  <div class="sheet-backdrop" @click.self="close">
    <section ref="panel" class="sheet" role="dialog" aria-modal="true" aria-label="AI 配置">
      <header class="sheet-header"><button class="text-button" :disabled="saving" @click="close">取消</button><h1>AI 配置</h1><button class="text-button" :disabled="saving || testing" @click="emit('save', { ...draft })">保存</button></header>
      <form class="settings-content ai-config" @submit.prevent="!testing && !saving && emit('save', { ...draft })">
        <label class="ai-toggle"><span>启用 AI 助手</span><input v-model="draft.enabled" type="checkbox"></label>
        <label>API 基础地址<input v-model="draft.baseUrl" type="url" @input="draft.apiKey = ''" placeholder="https://服务地址/v1" autocomplete="off" required></label>
        <p class="field-help">填写兼容 Chat Completions 的 HTTPS 基础地址，应用追加 /chat/completions。</p>
        <label>模型名<input v-model="draft.model" maxlength="200" autocomplete="off" required></label>
        <label>API Key<input v-model="draft.apiKey" type="password" autocomplete="off" required></label>
        <p class="field-help">{{ Capacitor.isNativePlatform() ? 'Key 使用 Android 系统密钥加密保存在此设备。' : '浏览器只在本次页面运行保留 Key，刷新后需要重新填写。' }} 更换服务地址时请重新填写对应 Key。</p>
        <p class="ai-notice">只有主动发送时联网。发送输入文字、分类列表和日期上下文；历史账目、预算及查询结果留在本机。服务可能收费，并按其政策处理提交内容。</p>
        <button type="button" class="secondary-button" :disabled="testing || saving" @click="testConnection">{{ testing ? '测试中…' : '测试连接（不发送账本）' }}</button>
        <p v-if="feedback" role="status">{{ feedback }}</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button type="button" class="danger-text" :disabled="saving || testing" @click="emit('clear')">清除 AI 配置与 Key</button>
      </form>
    </section>
  </div>
</template>
