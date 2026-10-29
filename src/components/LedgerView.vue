<script setup lang="ts">
import { computed } from 'vue'
import MonthNavigation from './MonthNavigation.vue'
import {
  formatMoney,
  formatSignedMoney,
  groupTransactionsByDay,
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
  selectMonth: [month: Date]
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
    <MonthNavigation :month="month" @select-month="$emit('selectMonth', $event)" @settings="$emit('settings')" />

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
        <!-- 每日合计复用整数分汇总，只显示支出，收入不抵扣当天开销。 -->
        <h2>
          <span>{{ group.label }}</span>
          <span class="daily-expense">支出合计 {{ formatMoney(summarize(group.items).expense) }}</span>
        </h2>
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
