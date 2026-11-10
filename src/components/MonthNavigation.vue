<script setup lang="ts">
import { computed, ref } from 'vue'
import DatePickerSheet from './DatePickerSheet.vue'
import { formatDateInput, monthLabel, parseMonthInput, shiftMonth } from '../domain'

/** 两个主页面共用月份入口，数据库查询仍由 App.vue 负责。 */
const props = defineProps<{ month: Date }>()

/** 所有入口都提交完整月份，避免箭头和直接选择维护两套状态。 */
const emit = defineEmits<{
  selectMonth: [month: Date]
  settings: []
}>()

// 共享选择器使用 YYYY-MM；同时作为当前月和范围判断的稳定键。
const monthValue = computed(() => formatDateInput(props.month.getTime()).slice(0, 7))
// 跟随选中月份重算当前年月，返回按钮不修改任何已保存账目。
const isCurrentMonth = computed(() => monthValue.value === formatDateInput(Date.now()).slice(0, 7))

// 原生按钮自带回车和空格行为，选择器的焦点与取消由共享弹层管理。
const pickerOpen = ref(false)

/** 复用领域校验，只在共享弹层确认后改变查询月份。 */
function selectMonth(value: string) {
  const selected = parseMonthInput(value)
  if (selected) emit('selectMonth', selected)
}
</script>

<template>
  <div class="month-navigation">
    <header class="top-bar">
      <button class="icon-button" aria-label="上一个月" :disabled="monthValue === '1000-01'" @click="emit('selectMonth', shiftMonth(month, -1))">‹</button>
      <h1 class="month-heading" :aria-label="monthLabel(month)">
        <button class="month-picker" aria-label="选择月份" aria-haspopup="dialog" :aria-expanded="pickerOpen" @click="pickerOpen = true">
          <span>{{ monthLabel(month) }} <small aria-hidden="true">▾</small></span>
        </button>
      </h1>
      <button class="icon-button" aria-label="下一个月" :disabled="monthValue === '9999-12'" @click="emit('selectMonth', shiftMonth(month, 1))">›</button>
      <button class="icon-button settings-button" aria-label="设置" @click="emit('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" />
          <circle cx="9" cy="6" r="2.5" />
          <circle cx="16" cy="12" r="2.5" />
          <circle cx="11" cy="18" r="2.5" />
        </svg>
      </button>
    </header>
    <div v-if="!isCurrentMonth" class="month-shortcuts">
      <button class="text-button" @click="emit('selectMonth', shiftMonth(new Date(), 0))">回到本月</button>
    </div>
    <DatePickerSheet v-model:show="pickerOpen" :value="monthValue" mode="month" @confirm="selectMonth" />
  </div>
</template>
