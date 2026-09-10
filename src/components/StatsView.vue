<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  formatMoney,
  formatSignedMoney,
  monthBounds,
  monthLabel,
  shiftMonth,
  summarize,
  type Category,
  type Transaction,
} from '../domain'

/** transactions 是当前月，trendTransactions 是包含当前月在内的近六个月数据。 */
const props = defineProps<{
  month: Date
  transactions: Transaction[]
  trendTransactions: Transaction[]
  categories: Category[]
}>()

/** 导航、编辑和设置都由持有数据库状态的 App.vue 执行。 */
defineEmits<{
  previousMonth: []
  nextMonth: []
  edit: [transaction: Transaction]
  settings: []
}>()

// 分类筛选只属于当前统计页；换月时清空，避免沿用上月选择。
const selectedCategoryId = ref<string | null>(null)
watch(() => props.month.getTime(), () => { selectedCategoryId.value = null })

const summary = computed(() => summarize(props.transactions))
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))

// 只统计支出分类；停用或已删除显示名的历史分类仍保留其金额行。
const categoryRows = computed(() => {
  const amounts = new Map<string, number>()
  // 先按分类累计当前月支出，收入不参与支出占比图。
  for (const item of props.transactions) {
    if (item.type === 'expense') amounts.set(item.categoryId, (amounts.get(item.categoryId) ?? 0) + item.amountCents)
  }
  // 空支出时列表本身为空；这里用 1 仅避免百分比计算出现除零。
  const total = summary.value.expense || 1
  // 映射为渲染行并按金额降序，使最大支出始终排在最前。
  return [...amounts.entries()]
    .map(([id, amount]) => ({
      id,
      amount,
      percent: Math.round((amount / total) * 100),
      category: categoriesById.value.get(id),
    }))
    .sort((a, b) => b.amount - a.amount)
})

// 分类明细按发生时间倒序，点击后仍编辑原始账目。
const selectedTransactions = computed(() => props.transactions
  .filter((item) => item.categoryId === selectedCategoryId.value)
  .sort((a, b) => b.occurredAt - a.occurredAt))

// 生成包含当前月在内的六个月支出序列。
const trend = computed(() => {
  // 依次生成前五个月到当前月的月初日期，保证标签和查询边界一致。
  const months = Array.from({ length: 6 }, (_, index) => shiftMonth(props.month, index - 5))
  return months.map((month) => {
    const [start, end] = monthBounds(month)
    // trendTransactions 范围更宽，在内存中按每月半开区间筛选支出。
    const amount = props.trendTransactions.reduce(
      (sum, item) => sum + (item.type === 'expense' && item.occurredAt >= start && item.occurredAt < end ? item.amountCents : 0),
      0,
    )
    return { label: `${month.getMonth() + 1}月`, amount }
  })
})

// 将金额按当前最大值缩放到固定 SVG 坐标系；至少以 1 为分母避免除零。
const trendPoints = computed(() => {
  const max = Math.max(...trend.value.map((item) => item.amount), 1)
  return trend.value.map((item, index) => ({
    ...item,
    x: 14 + index * 54.4,
    y: 82 - (item.amount / max) * 62,
  }))
})

// SVG polyline 接受空格分隔的 `x,y` 坐标字符串。
const polyline = computed(() => trendPoints.value.map((point) => `${point.x},${point.y}`).join(' '))
</script>

<template>
  <main class="page stats-page">
    <header class="top-bar">
      <button class="icon-button" aria-label="上一个月" @click="$emit('previousMonth')">‹</button>
      <h1>{{ monthLabel(month) }}</h1>
      <button class="icon-button" aria-label="下一个月" @click="$emit('nextMonth')">›</button>
      <button class="icon-button settings-button" aria-label="设置" @click="$emit('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" />
          <circle cx="9" cy="6" r="2.5" />
          <circle cx="16" cy="12" r="2.5" />
          <circle cx="11" cy="18" r="2.5" />
        </svg>
      </button>
    </header>

    <section class="stats-summary" aria-label="本月统计">
      <span><small>收入</small><b class="income">{{ formatMoney(summary.income) }}</b></span>
      <span><small>支出</small><b class="expense">{{ formatMoney(summary.expense) }}</b></span>
      <span><small>结余</small><b>{{ formatMoney(summary.balance) }}</b></span>
    </section>

    <!-- 分类条既是图表也是筛选按钮，便于键盘和读屏操作。 -->
    <section class="stats-section">
      <div class="section-heading">
        <h2>支出分类</h2>
        <small>点击查看明细</small>
      </div>
      <div v-if="categoryRows.length" class="category-bars">
        <button
          v-for="row in categoryRows"
          :key="row.id"
          :class="['category-bar-row', { selected: selectedCategoryId === row.id }]"
          :aria-pressed="selectedCategoryId === row.id"
          @click="selectedCategoryId = selectedCategoryId === row.id ? null : row.id"
        >
          <span class="bar-label"><b>{{ row.category?.icon }} {{ row.category?.name ?? '已停用分类' }}</b><small>{{ row.percent }}%</small></span>
          <span class="bar-track"><i :style="{ width: `${row.percent}%` }"></i></span>
          <strong>{{ formatMoney(row.amount) }}</strong>
        </button>
      </div>
      <p v-else class="empty-copy">本月还没有支出数据</p>
    </section>

    <section v-if="selectedCategoryId" class="stats-section filtered-list">
      <div class="section-heading">
        <h2>{{ categoriesById.get(selectedCategoryId)?.name }}明细</h2>
        <small>{{ selectedTransactions.length }} 笔</small>
      </div>
      <button v-for="item in selectedTransactions" :key="item.id" class="compact-transaction" @click="$emit('edit', item)">
        <span>{{ new Date(item.occurredAt).getMonth() + 1 }}月{{ new Date(item.occurredAt).getDate() }}日</span>
        <b>{{ item.note || categoriesById.get(item.categoryId)?.name }}</b>
        <strong :class="item.type">{{ formatSignedMoney(item) }}</strong>
      </button>
    </section>

    <!-- 固定 viewBox 使六个点在不同屏宽上保持相同相对位置。 -->
    <section class="stats-section">
      <div class="section-heading">
        <h2>近 6 个月支出</h2>
      </div>
      <div class="trend-chart">
        <svg viewBox="0 0 300 96" role="img" aria-label="近六个月支出趋势">
          <line x1="12" y1="82" x2="288" y2="82" />
          <polyline v-if="trend.some((item) => item.amount)" :points="polyline" />
          <circle v-for="point in trendPoints" :key="point.label" :cx="point.x" :cy="point.y" r="4">
            <title>{{ point.label }} {{ formatMoney(point.amount) }}</title>
          </circle>
        </svg>
        <div class="trend-labels">
          <span v-for="item in trend" :key="item.label">{{ item.label }}</span>
        </div>
      </div>
    </section>
  </main>
</template>
