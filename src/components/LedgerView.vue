<script setup lang="ts">
import { computed } from 'vue'
import {
  formatMoney,
  formatSignedMoney,
  groupTransactionsByDay,
  monthLabel,
  summarize,
  type Category,
  type Transaction,
} from '../domain'

/** 当前月明细页只负责展示和上抛操作，不直接读写数据库。 */
const props = defineProps<{
  /** 已归一到 1 日的当前月份。 */
  month: Date
  transactions: Transaction[]
  categories: Category[]
  showStorageNotice: boolean
}>()

/** 页面行为交给 App.vue 统一处理，保证两个主视图共享同一状态。 */
defineEmits<{
  previousMonth: []
  nextMonth: []
  edit: [transaction: Transaction]
  add: []
  settings: []
  dismissNotice: []
}>()

// 三个派生值随 props 自动更新，模板不重复执行汇总、分组和分类查找。
const summary = computed(() => summarize(props.transactions))
const grouped = computed(() => groupTransactionsByDay(props.transactions))
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
</script>

<template>
  <main class="page ledger-page">
    <!-- 月份切换和设置入口。 -->
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

    <!-- 金额已在领域层按整数分汇总，这里只负责格式化显示。 -->
    <section class="balance-card" aria-label="本月收支汇总">
      <p>本月结余</p>
      <strong :class="{ negative: summary.balance < 0 }">{{ formatMoney(summary.balance) }}</strong>
      <div class="balance-details">
        <span><small>收入</small><b class="income">+{{ formatMoney(summary.income) }}</b></span>
        <span><small>支出</small><b class="expense">-{{ formatMoney(summary.expense) }}</b></span>
      </div>
    </section>

    <aside v-if="showStorageNotice" class="storage-notice" role="note">
      <div>
        <b>数据只保存在本机</b>
        <p>卸载或清除应用数据后无法恢复。</p>
      </div>
      <button class="text-button" @click="$emit('dismissNotice')">知道了</button>
    </aside>

    <!-- 账目按本地日历日倒序展示，点击行进入编辑。 -->
    <section v-if="grouped.length" class="transaction-groups" aria-label="本月明细">
      <section v-for="group in grouped" :key="group.key" class="transaction-group">
        <h2>{{ group.label }}</h2>
        <button
          v-for="item in group.items"
          :key="item.id"
          class="transaction-row"
          @click="$emit('edit', item)"
        >
          <span class="category-icon" aria-hidden="true">{{ categoriesById.get(item.categoryId)?.icon ?? '•' }}</span>
          <span class="transaction-copy">
            <b>{{ item.note || categoriesById.get(item.categoryId)?.name || '已停用分类' }}</b>
            <small v-if="item.note">{{ categoriesById.get(item.categoryId)?.name }}</small>
          </span>
          <span :class="['transaction-amount', item.type]">{{ formatSignedMoney(item) }}</span>
        </button>
      </section>
    </section>

    <section v-else class="empty-state">
      <span aria-hidden="true">○</span>
      <h2>本月还没有记录</h2>
      <p>从一笔日常支出开始吧</p>
      <button class="primary-button" @click="$emit('add')">记第一笔</button>
    </section>
  </main>
</template>
