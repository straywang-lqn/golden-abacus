<script setup lang="ts">
import { computed, ref } from 'vue'
import { budgetForMonth, budgetProgress, categoryBreakdown, formatDateInput, formatMoney, monthLabel, summarize, toCents, type Category, type MonthlyBudget, type Transaction } from '../domain'
import { useSheetFocus } from '../useSheetFocus'

/** 编辑所选月份的独立预算草稿，取消不改变已经保存的配置。 */
const props = defineProps<{ month: Date; budgets: MonthlyBudget[]; categories: Category[]; transactions: Transaction[]; saving: boolean; saveError: string }>()
/** 根组件负责保存设置和错误，预算表单只提交普通业务对象。 */
const emit = defineEmits<{ close: []; save: [budget: MonthlyBudget] }>()

// 从最近一次生效配置初始化，保留停用分类已有的预算以便取消限制。
const existing = budgetForMonth(props.budgets, props.month)
const total = ref(existing?.totalCents ? (existing.totalCents / 100).toFixed(2) : '')
const limits = ref(Object.fromEntries((existing?.categoryLimits ?? []).map((limit) => [limit.categoryId, (limit.amountCents / 100).toFixed(2)])))
const categories = computed(() => props.categories.filter((category) => category.type === 'expense' && (category.active || category.id in limits.value)))
// 直接复用月度统计，首次设置预算也能看到每个分类已经花了多少。
const expense = computed(() => summarize(props.transactions).expense)
const spentByCategory = computed(() => new Map(categoryBreakdown(props.transactions, 'expense').map((item) => [item.id, item.amount])))
const error = ref('')
const panel = ref<HTMLElement>()
useSheetFocus(panel, () => { if (!props.saving) emit('close') })

// 只将有效的分类草稿交给领域层预览；空白和非法输入仍由提交校验解释。
const remainingByCategory = computed(() => new Map(budgetProgress({
  month: formatDateInput(props.month.getTime()).slice(0, 7),
  totalCents: null,
  categoryLimits: categories.value.flatMap((category) => {
    const amountCents = toCents(limits.value[category.id] ?? '')
    return amountCents === null ? [] : [{ categoryId: category.id, amountCents }]
  }),
}, props.transactions).categories.map((category) => [category.categoryId, category.remaining])))

/** 空白表示取消限额；所有非空限额必须是正整数分。 */
function submit() {
  error.value = ''
  const totalCents = total.value.trim() ? toCents(total.value) : null
  if (total.value.trim() && totalCents === null) {
    error.value = '总预算请输入大于 0 且最多两位小数的金额，留空取消限制'
    return
  }
  const categoryLimits: MonthlyBudget['categoryLimits'] = []
  for (const category of categories.value) {
    const raw = limits.value[category.id]?.trim()
    if (!raw) continue
    const amountCents = toCents(raw)
    if (amountCents === null) {
      error.value = `${category.name}预算请输入大于 0 且最多两位小数的金额`
      return
    }
    categoryLimits.push({ categoryId: category.id, amountCents })
  }
  // 即使全部留空也保存当前月配置，明确停止沿用之前的预算。
  emit('save', { month: formatDateInput(props.month.getTime()).slice(0, 7), totalCents, categoryLimits })
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="!saving && emit('close')">
    <section ref="panel" class="sheet budget-sheet" role="dialog" aria-modal="true" aria-label="月度预算">
      <header class="sheet-header"><button class="text-button" :disabled="saving" @click="emit('close')">取消</button><h1>月度预算</h1><span></span></header>
      <form class="settings-content budget-form" @submit.prevent="submit">
        <section class="settings-section">
          <h2>{{ monthLabel(month) }}</h2>
          <p class="field-help">保存后从本月起生效，后续月份自动沿用。过去月份的预算不变。</p>
          <label class="form-row"><span>总预算</span><input v-model="total" data-initial-focus inputmode="decimal" placeholder="留空不限制" aria-label="月度总预算"></label>
          <p class="field-help">本月已支出 {{ formatMoney(expense) }}，收入不抵扣预算。</p>
        </section>
        <section class="settings-section">
          <h2>分类预算</h2>
          <p class="field-help">分类限额独立计算，未设置的分类仍计入总预算。</p>
          <div v-for="category in categories" :key="category.id" class="budget-category-field">
            <label class="form-row"><span>{{ category.icon }} {{ category.name }}{{ category.active ? '' : '（停用）' }}</span><input v-model="limits[category.id]" inputmode="decimal" placeholder="留空不限制" :aria-label="`${category.name}月度预算`"></label>
            <small class="field-help">已支出 {{ formatMoney(spentByCategory.get(category.id) ?? 0) }}</small>
            <small v-if="remainingByCategory.has(category.id)" :class="['field-help', { expense: remainingByCategory.get(category.id)! < 0 }]">{{ remainingByCategory.get(category.id)! < 0 ? '已超支' : '还可支出' }} {{ formatMoney(Math.abs(remainingByCategory.get(category.id)!)) }}</small>
          </div>
        </section>
        <p v-if="error || saveError" class="form-error" role="alert">{{ error || saveError }}</p>
        <button class="primary-button save-button" :disabled="saving" type="submit">{{ saving ? '正在保存…' : '保存预算' }}</button>
      </form>
    </section>
  </div>
</template>
