<script setup lang="ts">
import { ref } from 'vue'
import { formatMoney, formatDateInput, type Category, type TransactionFilter } from '../domain'
import type { AiAnswer, AiCommand } from '../ai'
import { useSheetFocus } from '../useSheetFocus'
/** 助手只展示结果，不拥有网络或数据库操作。 */
defineProps<{ input: string; busy: boolean; error: string; command: AiCommand | null; answer: AiAnswer | null; categories: Category[]; ready: boolean }>()
/** 草稿与查询交给顶层，关闭后不保留会话。 */
const emit = defineEmits<{ close: []; configure: []; send: []; 'update:input': [text: string]; entry: []; details: [filter: TransactionFilter] }>()
/** 共享焦点循环同时覆盖多行输入。 */
const panel = ref<HTMLElement>()
useSheetFocus(panel, () => emit('close'))
</script>
<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section ref="panel" class="sheet" role="dialog" aria-modal="true" aria-label="AI 助手">
      <header class="sheet-header"><button class="text-button" @click="emit('close')">返回</button><h1>AI 助手</h1><button class="text-button" :disabled="busy" @click="emit('configure')">配置</button></header>
      <div class="settings-content ai-content">
        <p class="ai-notice">发送文字、分类和日期上下文给所配置的 AI 服务。账目和预算留在本机；关闭后清空本次会话。</p>
        <p v-if="!ready" class="field-help">请先配置并启用 AI 助手。</p>
        <form class="ai-config" @submit.prevent="emit('send')">
          <label for="ai-input">记一笔，或问问账本</label>
          <textarea id="ai-input" data-initial-focus :value="input" maxlength="1000" rows="3" placeholder="例如：昨天午饭35元 / 本月餐饮花了多少？" :disabled="busy" @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)" />
          <button class="primary-button" :disabled="busy || !ready || !input.trim()">{{ busy ? '正在理解…' : '发送' }}</button>
        </form>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <section v-if="command" class="ai-result" aria-live="polite">
          <template v-if="command.kind === 'entry'">
            <h2>待确认账目</h2><strong>{{ command.draft.type === 'expense' ? '支出' : '收入' }} {{ formatMoney(command.draft.amountCents) }}</strong>
            <p>{{ categories.find(c => command?.kind === 'entry' && c.id === command.draft.categoryId)?.name || '请在表单选择分类' }}</p>
            <p>{{ formatDateInput(command.draft.occurredAt) }} {{ command.draft.note }}</p>
            <button class="primary-button" @click="emit('entry')">检查并保存</button>
          </template>
          <p v-else-if="command.kind === 'clarify'">{{ command.message }}，请在上方补充完整描述后发送。</p>
          <template v-else-if="answer"><h2>本机查询结果</h2><p v-for="(line, index) in answer.lines" :key="index">{{ line }}</p><button v-for="detail in answer.details" :key="detail.label" class="secondary-button" @click="emit('details', detail.filter)">{{ detail.label }}</button></template>
        </section>
      </div>
    </section>
  </div>
</template>
