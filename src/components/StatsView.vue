<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MonthNavigation from './MonthNavigation.vue'
import {
  categoryBreakdown,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  monthLabel,
  monthlyTrend,
  summarize,
  type Category,
  type Transaction,
  type TransactionType,
} from '../domain'

/** transactions 是当前月，trendTransactions 是包含当前月在内的近六个月数据。 */
const props = defineProps<{
  month: Date
  transactions: Transaction[]
  trendTransactions: Transaction[]
  categories: Category[]
}>()

/** 导航、编辑和设置都由持有数据库状态的 App.vue 执行。 */
const emit = defineEmits<{
  selectMonth: [month: Date]
  edit: [transaction: Transaction]
  settings: []
}>()

// 收支切换同时作用于分类和趋势，月度总览始终保留全部收支。
const selectedType = ref<TransactionType>('expense')
// 页面文案共用当前收支名称，避免切换后标题与数据不一致。
const typeLabel = computed(() => selectedType.value === 'expense' ? '支出' : '收入')
// 分类筛选只属于当前统计页；换月或切换收支时清空。
const selectedCategoryId = ref<string | null>(null)
// 明细区域挂载后接收焦点，键盘与触屏操作都能立即找到结果。
const categoryDetails = ref<HTMLElement>()
// 趋势位于页面下方，选择月份后通过标题按钮回到月度总览。
const statsPage = ref<HTMLElement>()
// 仅保存本次筛选的触发按钮，收起明细时把键盘焦点还给它。
let categoryTrigger: HTMLButtonElement | null = null
watch([() => props.month.getTime(), selectedType], () => {
  selectedCategoryId.value = null
  categoryTrigger = null
})

// 总览继续使用整数分汇总，切换统计类型不改变收入、支出或结余。
const summary = computed(() => summarize(props.transactions))
// 包括停用分类，历史账目仍使用原分类名称和图标。
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))

// 分类汇总复用领域函数，组件只补齐用于展示的名称和图标。
const categoryRows = computed(() => categoryBreakdown(props.transactions, selectedType.value)
  .map((row) => ({ ...row, category: categoriesById.value.get(row.id) })))

// 合计直接取分类汇总，删除该分类最后一笔账目后自动隐藏空明细。
const selectedCategory = computed(() => categoryRows.value.find((row) => row.id === selectedCategoryId.value))

// 分类明细按发生时间倒序，点击后仍编辑原始账目。
const selectedTransactions = computed(() => props.transactions
  .filter((item) => item.type === selectedType.value && item.categoryId === selectedCategoryId.value)
  .sort((a, b) => b.occurredAt - a.occurredAt))

// 六个月始终补齐零金额月份，并随当前收支类型一起切换。
const trend = computed(() => monthlyTrend(props.trendTransactions, props.month, selectedType.value))

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

/** 明细位于分类列表后，挂载后主动定位，避免分类多时点击没有可见反馈。 */
async function selectCategory(id: string, event: MouseEvent) {
  // 事件仍处于同步阶段时保存按钮，异步渲染后 currentTarget 会被清空。
  categoryTrigger = event.currentTarget as HTMLButtonElement
  if (selectedCategoryId.value === id) {
    closeCategory()
    return
  }
  selectedCategoryId.value = id
  await nextTick()
  // 使用即时滚动，减少动态效果偏好下也不会产生额外动画。
  categoryDetails.value?.scrollIntoView({ block: 'start' })
  categoryDetails.value?.focus({ preventScroll: true })
}

/** 收起后返回原分类按钮，避免焦点随被移除的明细区域丢失。 */
function closeCategory() {
  selectedCategoryId.value = null
  categoryTrigger?.focus()
}

/** 趋势按钮切月后定位到标题，避免用户仍停留在页面下方。 */
function selectTrendMonth(month: Date) {
  emit('selectMonth', month)
  statsPage.value?.querySelector<HTMLButtonElement>('button[aria-label="选择月份"]')?.focus()
}
</script>

<template>
  <main ref="statsPage" class="page stats-page">
    <MonthNavigation :month="month" @select-month="$emit('selectMonth', $event)" @settings="$emit('settings')" />

    <section class="stats-summary" :aria-label="`${monthLabel(month)}统计`">
      <span><small>收入</small><b class="income">{{ formatMoney(summary.income) }}</b></span>
      <span><small>支出</small><b class="expense">{{ formatMoney(summary.expense) }}</b></span>
      <span><small>结余</small><b>{{ formatMoney(summary.balance) }}</b></span>
    </section>

    <!-- 共用记账表单的分段按钮；切换只改变统计，不修改任何账目。 -->
    <div class="segmented-control stats-type-switch" role="group" aria-label="统计类型">
      <button :class="{ active: selectedType === 'expense' }" :aria-pressed="selectedType === 'expense'" @click="selectedType = 'expense'">支出</button>
      <button :class="{ active: selectedType === 'income' }" :aria-pressed="selectedType === 'income'" @click="selectedType = 'income'">收入</button>
    </div>

    <!-- 分类条既是图表也是筛选按钮，便于键盘和读屏操作。 -->
    <section class="stats-section">
      <div class="section-heading">
        <h2>{{ typeLabel }}分类</h2>
        <small>点击查看明细</small>
      </div>
      <div v-if="categoryRows.length" class="category-bars">
        <button
          v-for="row in categoryRows"
          :key="row.id"
          :class="['category-bar-row', { selected: selectedCategoryId === row.id }]"
          :aria-pressed="selectedCategoryId === row.id"
          :aria-expanded="selectedCategoryId === row.id && !!selectedCategory"
          :aria-controls="selectedCategoryId === row.id && selectedCategory ? 'category-details' : undefined"
          @click="selectCategory(row.id, $event)"
        >
          <span class="bar-label"><b>{{ row.category?.icon }} {{ row.category?.name ?? '已停用分类' }}</b><small>{{ formatPercent(row.percent) }}</small></span>
          <span class="bar-track"><i :style="{ width: `${row.percent}%` }"></i></span>
          <strong>{{ formatMoney(row.amount) }}</strong>
        </button>
      </div>
      <p v-else class="empty-copy">本月还没有{{ typeLabel }}数据</p>
    </section>

    <section v-if="selectedCategory" id="category-details" ref="categoryDetails" class="stats-section filtered-list" tabindex="-1" aria-labelledby="category-details-title">
      <div class="section-heading">
        <h2 id="category-details-title">{{ selectedCategory.category?.name ?? '已停用分类' }}明细</h2>
        <button class="text-button" @click="closeCategory">收起</button>
      </div>
      <p class="category-detail-summary"><span>{{ selectedTransactions.length }} 笔，合计</span><strong :class="selectedType">{{ formatMoney(selectedCategory.amount) }}</strong></p>
      <button v-for="item in selectedTransactions" :key="item.id" class="compact-transaction" @click="$emit('edit', item)">
        <span>{{ new Date(item.occurredAt).getMonth() + 1 }}月{{ new Date(item.occurredAt).getDate() }}日</span>
        <b>{{ item.note || categoriesById.get(item.categoryId)?.name }}</b>
        <strong :class="item.type">{{ formatSignedMoney(item) }}</strong>
      </button>
    </section>

    <!-- 固定 viewBox 使六个点在不同屏宽上保持相同相对位置。 -->
    <section class="stats-section">
      <div class="section-heading">
        <h2>近 6 个月{{ typeLabel }}</h2>
        <small>点击月份查看统计</small>
      </div>
      <div class="trend-chart">
        <svg viewBox="0 0 300 96" role="img" :aria-label="`近六个月${typeLabel}趋势，具体金额见下方月份按钮`">
          <line x1="12" y1="82" x2="288" y2="82" />
          <polyline v-if="trend.some((item) => item.amount)" :points="polyline" />
          <circle v-for="point in trendPoints" :key="point.month.getTime()" :cx="point.x" :cy="point.y" r="4">
            <title>{{ monthLabel(point.month) }} {{ formatMoney(point.amount) }}</title>
          </circle>
        </svg>
        <div class="trend-labels">
          <span v-for="item in trend" :key="item.month.getTime()">{{ item.month.getMonth() + 1 }}月</span>
        </div>
      </div>
      <!-- 金额常显且按钮可键盘操作，手机无需依赖 SVG 悬停提示。 -->
      <div class="trend-months" :aria-label="`每月${typeLabel}金额`">
        <button
          v-for="item in trend"
          :key="item.month.getTime()"
          :class="{ selected: item.month.getTime() === month.getTime() }"
          :disabled="item.month.getFullYear() < 1000"
          :aria-current="item.month.getTime() === month.getTime() ? 'date' : undefined"
          :aria-label="`${monthLabel(item.month)}${typeLabel}${formatMoney(item.amount)}，查看该月统计`"
          @click="selectTrendMonth(item.month)"
        >
          <span>{{ monthLabel(item.month) }}</span>
          <strong>{{ formatMoney(item.amount) }}</strong>
        </button>
      </div>
    </section>
  </main>
</template>
