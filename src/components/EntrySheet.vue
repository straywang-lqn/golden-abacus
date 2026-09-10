<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  dateInputToTimestamp,
  formatDateInput,
  toCents,
  type Category,
  type EntryDraft,
  type Transaction,
  type TransactionType,
} from '../domain'

/** 新建时 editing 为 null；编辑时表单从该记录复制初值。 */
const props = defineProps<{
  categories: Category[]
  editing: Transaction | null
  saving: boolean
  saveError: string
}>()

/** 父组件拥有持久化状态，本组件只提交校验后的草稿或记录 id。 */
const emit = defineEmits<{
  close: []
  save: [draft: EntryDraft]
  delete: [id: string]
}>()

// 抽屉每次通过 v-if 重新创建，因此这些值只需从 props 初始化一次。
const type = ref<TransactionType>(props.editing?.type ?? 'expense')
const amount = ref(props.editing ? (props.editing.amountCents / 100).toFixed(2) : '')
const categoryId = ref(props.editing?.categoryId ?? '')
const note = ref(props.editing?.note ?? '')
const date = ref(formatDateInput(props.editing?.occurredAt ?? Date.now()))

// error 是本地校验错误，saveError 是父组件返回的持久化错误。
const error = ref('')
const confirmDelete = ref(false)
const amountInput = ref<HTMLInputElement>()

// 编辑旧账目时保留其已停用分类，避免仅打开表单就迫使用户改分类。
const availableCategories = computed(() => props.categories
  .filter((category) => category.type === type.value && (category.active || category.id === props.editing?.categoryId))
  .sort((a, b) => a.order - b.order))

// 切换收支类型后清除不再属于可选集合的分类。
watch(type, () => {
  if (!availableCategories.value.some((category) => category.id === categoryId.value)) categoryId.value = ''
})

// 等抽屉输入框挂载后聚焦，移动端可直接开始输入金额。
onMounted(() => nextTick(() => amountInput.value?.focus()))

/** 校验金额和分类，再把元字符串转换成整数分草稿。 */
function submit() {
  // 每次提交先清掉上一轮校验错误，避免用户修正后仍看到旧提示。
  error.value = ''
  const amountCents = toCents(amount.value)
  if (!amountCents) {
    error.value = '请输入大于 0 且最多两位小数的金额'
    return
  }
  // 以当前类型的可选分类复核，防止切换收支后提交失效分类。
  if (!availableCategories.value.some((category) => category.id === categoryId.value)) {
    error.value = '请选择分类'
    return
  }
  // 只提交领域层需要的普通草稿，记录 id 和审计时间由父组件统一生成。
  emit('save', {
    type: type.value,
    amountCents,
    categoryId: categoryId.value,
    note: note.value.trim(),
    occurredAt: dateInputToTimestamp(date.value, props.editing?.occurredAt),
  })
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="$emit('close')">
    <section class="sheet entry-sheet" role="dialog" aria-modal="true" :aria-label="editing ? '编辑记录' : '记一笔'">
      <header class="sheet-header">
        <button class="text-button" @click="$emit('close')">取消</button>
        <h1>{{ editing ? '编辑记录' : '记一笔' }}</h1>
        <span></span>
      </header>

      <!-- 使用原生 form、日期输入和 submit 行为，键盘操作与按钮点击走同一校验。 -->
      <form class="entry-form" @submit.prevent="submit">
        <div class="segmented-control" aria-label="记录类型">
          <button type="button" :class="{ active: type === 'expense' }" :aria-pressed="type === 'expense'" @click="type = 'expense'">支出</button>
          <button type="button" :class="{ active: type === 'income' }" :aria-pressed="type === 'income'" @click="type = 'income'">收入</button>
        </div>

        <label class="amount-field">
          <span>¥</span>
          <input
            ref="amountInput"
            v-model="amount"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            aria-label="金额"
          >
        </label>

        <fieldset class="category-picker">
          <legend>选择分类</legend>
          <button
            v-for="category in availableCategories"
            :key="category.id"
            type="button"
            :class="{ selected: categoryId === category.id }"
            :aria-pressed="categoryId === category.id"
            @click="categoryId = category.id"
          >
            <span aria-hidden="true">{{ category.icon }}</span>
            <small>{{ category.name }}</small>
          </button>
        </fieldset>

        <label class="form-row">
          <span>备注 <small>可选</small></span>
          <input v-model="note" maxlength="40" placeholder="例如：午餐">
        </label>
        <label class="form-row">
          <span>日期</span>
          <input v-model="date" type="date" required>
        </label>

        <p v-if="error || saveError" class="form-error" role="alert">{{ error || saveError }}</p>

        <!-- 删除采用抽屉内二次确认，避免误触立即破坏数据。 -->
        <div v-if="editing" class="delete-area">
          <button v-if="!confirmDelete" type="button" class="danger-text" @click="confirmDelete = true">删除这笔记录</button>
          <div v-else class="inline-confirm" role="alert">
            <span>删除后无法恢复</span>
            <button type="button" @click="confirmDelete = false">取消</button>
            <button type="button" class="danger-button" @click="$emit('delete', editing.id)">确认删除</button>
          </div>
        </div>

        <button class="primary-button save-button" :disabled="saving" type="submit">
          {{ saving ? '正在保存…' : '保存这笔记录' }}
        </button>
      </form>
    </section>
  </div>
</template>
