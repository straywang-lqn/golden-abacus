<script setup lang="ts">
import { computed, ref } from 'vue'
import DatePickerSheet from './DatePickerSheet.vue'
import { filterTransactions, formatDateInput, formatMoney, formatSignedMoney, groupTransactionsByDay, summarize, toCents, type Category, type Transaction, type TransactionType } from '../domain'
import { useSheetFocus } from '../useSheetFocus'

/** 搜索接收按需载入的全部历史，条件变化只在本机筛选。 */
const props = defineProps<{ transactions: Transaction[]; categories: Category[]; loading: boolean; loadError: string }>()
/** 编辑与失败重试仍由根组件读写数据库。 */
const emit = defineEmits<{ close: []; edit: [item: Transaction]; retry: [] }>()

// 空条件表示全部历史；日期草稿仅在共享选择器确认后提交。
const query = ref('')
const type = ref<TransactionType | 'all'>('all')
const categoryId = ref('')
const minAmount = ref('')
const maxAmount = ref('')
const startDate = ref('')
const endDate = ref('')
const dateTarget = ref<'start' | 'end'>('start')
const datePickerOpen = ref(false)
const panel = ref<HTMLElement>()
useSheetFocus(panel, () => emit('close'))

// 金额条件接受零，空值不设边界；无效输入立即显示错误而不扩大搜索。
const minCents = computed(() => minAmount.value.trim() ? toCents(minAmount.value, true) : null)
const maxCents = computed(() => maxAmount.value.trim() ? toCents(maxAmount.value, true) : null)
const filterError = computed(() => {
  if ((minAmount.value.trim() && minCents.value === null) || (maxAmount.value.trim() && maxCents.value === null)) return '金额请输入非负数，最多两位小数'
  if (minCents.value !== null && maxCents.value !== null && minCents.value > maxCents.value) return '最低金额不能大于最高金额'
  if (startDate.value && endDate.value && startDate.value > endDate.value) return '开始日期不能晚于结束日期'
  return ''
})
// 结果、合计和分组始终使用同一组条件，避免筛选后仍显示全量金额。
const matches = computed(() => filterError.value ? [] : filterTransactions(props.transactions, props.categories, {
  query: query.value, type: type.value, categoryId: categoryId.value,
  minCents: minCents.value, maxCents: maxCents.value, startDate: startDate.value, endDate: endDate.value,
}))
const summary = computed(() => summarize(matches.value))
const groups = computed(() => groupTransactionsByDay(matches.value))
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const availableCategories = computed(() => props.categories.filter((category) => type.value === 'all' || category.type === type.value))
const pickerValue = computed(() => (dateTarget.value === 'start' ? startDate.value : endDate.value) || formatDateInput(Date.now()))

/** 类型改变时清掉冲突分类，避免界面留下看不见的限制。 */
function changeType() {
  if (!availableCategories.value.some((category) => category.id === categoryId.value)) categoryId.value = ''
}

/** 重置全部条件，不重新读取数据库。 */
function reset() {
  query.value = categoryId.value = minAmount.value = maxAmount.value = startDate.value = endDate.value = ''
  type.value = 'all'
}

/** 两个日期入口复用一个选择器，并保留各自已确认的值。 */
function openDate(target: 'start' | 'end') {
  dateTarget.value = target
  datePickerOpen.value = true
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section ref="panel" class="sheet search-sheet" role="dialog" aria-modal="true" aria-label="搜索账目">
      <header class="sheet-header">
        <button class="text-button" @click="emit('close')">返回</button>
        <h1>搜索账目</h1>
        <button class="text-button" @click="reset">重置</button>
      </header>
      <div class="settings-content">
        <form class="search-filters" aria-label="搜索条件" @submit.prevent>
          <label class="search-query"><span>关键词</span><input v-model="query" data-initial-focus type="search" placeholder="搜索备注或分类，包含全部月份" aria-label="搜索备注或分类"></label>
          <div class="filter-grid">
            <label>收支类型<select v-model="type" aria-label="筛选收支类型" @change="changeType"><option value="all">全部收支</option><option value="expense">支出</option><option value="income">收入</option></select></label>
            <label>分类<select v-model="categoryId" aria-label="筛选分类"><option value="">全部分类</option><option v-for="category in availableCategories" :key="category.id" :value="category.id">{{ category.icon }} {{ category.name }}{{ category.active ? '' : '（停用）' }}</option></select></label>
            <label>最低金额<input v-model="minAmount" inputmode="decimal" placeholder="不限" aria-label="最低金额"></label>
            <label>最高金额<input v-model="maxAmount" inputmode="decimal" placeholder="不限" aria-label="最高金额"></label>
          </div>
          <div class="search-date-row">
            <span>开始日期</span><button type="button" class="text-button" aria-haspopup="dialog" @click="openDate('start')">{{ startDate || '不限' }}</button><button v-if="startDate" type="button" class="text-button" aria-label="清除开始日期" @click="startDate = ''">清除</button>
          </div>
          <div class="search-date-row">
            <span>结束日期</span><button type="button" class="text-button" aria-haspopup="dialog" @click="openDate('end')">{{ endDate || '不限' }}</button><button v-if="endDate" type="button" class="text-button" aria-label="清除结束日期" @click="endDate = ''">清除</button>
          </div>
          <p v-if="filterError" class="form-error" role="alert">{{ filterError }}</p>
        </form>
        <p v-if="loading" class="empty-copy" role="status">正在读取历史账目…</p>
        <div v-else-if="loadError" role="alert"><p class="form-error">{{ loadError }}</p><button class="secondary-button" @click="emit('retry')">重新读取</button></div>
        <template v-else-if="!filterError">
          <div class="search-summary" aria-live="polite"><b>找到 {{ matches.length }} 笔</b><span>支出 {{ formatMoney(summary.expense) }}</span><span>收入 {{ formatMoney(summary.income) }}</span></div>
          <section v-for="group in groups" :key="group.key" class="transaction-group">
            <h2>{{ group.key.replaceAll('-', ' / ') }}</h2>
            <button v-for="item in group.items" :key="item.id" class="transaction-row" @click="emit('edit', item)">
              <span class="category-icon" aria-hidden="true">{{ categoriesById.get(item.categoryId)?.icon ?? '•' }}</span>
              <span class="transaction-copy"><b>{{ item.note || categoriesById.get(item.categoryId)?.name }}</b><small v-if="item.note">{{ categoriesById.get(item.categoryId)?.name }}</small></span>
              <span :class="['transaction-amount', item.type]">{{ formatSignedMoney(item) }}</span>
            </button>
          </section>
          <p v-if="!matches.length" class="empty-copy">没有符合条件的账目，试试减少筛选条件。</p>
        </template>
      </div>
      <DatePickerSheet v-model:show="datePickerOpen" :value="pickerValue" mode="date" @confirm="dateTarget === 'start' ? startDate = $event : endDate = $event" />
    </section>
  </div>
</template>
