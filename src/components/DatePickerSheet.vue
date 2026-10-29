<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { DatePicker, type DatePickerColumnType, type DatePickerInstance } from 'vant/es/date-picker'
import { Popup } from 'vant/es/popup'
import type { PickerConfirmEventParams, PickerOption } from 'vant/es/picker'
// 只加载弹层、遮罩和滚轮实际使用的样式，避免通用入口额外引入图标字体。
import 'vant/es/style/base.css'
import 'vant/es/picker/index.css'
import 'vant/es/popup/index.css'
import 'vant/es/overlay/index.css'
import { parseDateInput, parseMonthInput } from '../domain'

/** 月份和记账日期共用同一弹层；传入值仍是领域层使用的本地日期字符串。 */
const props = defineProps<{ value: string; mode: 'month' | 'date' }>()
/** 外层只控制开关，滚动中的草稿不会直接改变查询月份或记账表单。 */
const show = defineModel<boolean>('show', { default: false })
/** 仅在按下确定并校验成功后提交新值。 */
const emit = defineEmits<{ confirm: [value: string] }>()

// 每个实例使用独立标题 id，避免月份和日期弹层曾打开后产生重复标识。
const titleId = useId()
// 两种模式只改变列和文案，共用触摸、键盘与焦点行为。
const title = computed(() => props.mode === 'month' ? '选择月份' : '选择日期')
const columns = computed<DatePickerColumnType[]>(() => props.mode === 'month' ? ['year', 'month'] : ['year', 'month', 'day'])
// 延续现有月份选择范围，历史记录不会因组件库默认十年范围而被截断。
const minDate = new Date(1000, 0, 1)
const maxDate = new Date(9999, 11, 31)
// 组件只保存字符串草稿，不在弹层里做时区或数据库转换。
const draft = ref(props.value.split('-'))
// 校验异常留在弹层内，用户可重新选择，不静默关闭或应用错误日期。
const error = ref('')
// 弹层和 Vant 实例用于焦点循环，以及确定前停止尚在惯性滚动的选项。
const panel = ref<HTMLElement>()
const picker = ref<DatePickerInstance>()
const cancelButton = ref<HTMLButtonElement>()
// 关闭后恢复打开入口的焦点，不把用户留在已隐藏的滚轮选项中。
let trigger: HTMLElement | null = null

// 每次打开从已确认值重建草稿，取消后再次打开不会残留上次滑动结果。
watch(show, (opened) => {
  if (!opened) return
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  draft.value = props.value.split('-')
  error.value = ''
})

// 将轮盘的选中值拼成人类可读的预览，读屏也能感知滑动后的日期变化。
const preview = computed(() => `${draft.value[0]}年${Number(draft.value[1])}月${props.mode === 'date' ? `${Number(draft.value[2])}日` : ''}`)

/** 为滚轮补上中文单位，保留 Vant 原始字符串值供月份和闰日联动。 */
function formatOption(type: string, option: PickerOption): PickerOption {
  return { ...option, text: `${Number(option.value)}${type === 'year' ? '年' : type === 'month' ? '月' : '日'}` }
}

/** 只应用组件确认时的最终选项，防止惯性滚动中的旧草稿被提前保存。 */
function confirmSelection({ selectedValues }: PickerConfirmEventParams) {
  const value = selectedValues.map(String).join('-')
  if (!(props.mode === 'month' ? parseMonthInput(value) : parseDateInput(value))) {
    error.value = '请选择有效日期'
    return
  }
  emit('confirm', value)
  show.value = false
}

/** 关闭动画完成后恢复原入口；入口若已随页面卸载则无需再聚焦。 */
function restoreFocus() {
  if (trigger?.isConnected) trigger.focus({ preventScroll: true })
}

/** Vant 提供触摸滚轮，在共享边界补齐方向键、确认键和弹层内的焦点循环。 */
async function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    show.value = false
    return
  }
  // 只把每列当前选项纳入 Tab 顺序，避免逐个遍历全部历史年份。
  if (event.key === 'Tab') {
    const targets = [...(panel.value?.querySelectorAll<HTMLElement>('button, .van-picker-column__item--selected') ?? [])]
    const index = targets.indexOf(document.activeElement as HTMLElement)
    event.preventDefault()
    targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus({ preventScroll: true })
    return
  }
  const option = (event.target as HTMLElement).closest<HTMLElement>('.van-picker-column__item')
  if (!option) return
  // 到达首尾时也拦截方向键，防止浏览器把边界操作变成滚动整个弹层。
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
  event.preventDefault()
  // 通过组件自身的点击行为更新选项，让二月和大小月继续由 Vant 联动校正。
  const target = event.key === 'ArrowUp' ? option.previousElementSibling
    : event.key === 'ArrowDown' ? option.nextElementSibling
      : event.key === 'Home' ? option.parentElement?.firstElementChild
        : event.key === 'End' ? option.parentElement?.lastElementChild
          : event.key === 'Enter' || event.key === ' ' ? option : null
  if (target instanceof HTMLElement) {
    target.click()
    await nextTick()
    target.focus({ preventScroll: true })
  }
}
</script>

<template>
  <Popup
    v-model:show="show"
    position="bottom"
    round
    teleport="body"
    class="date-picker-panel"
    overlay-class="date-picker-overlay"
    :aria-labelledby="titleId"
    aria-modal="true"
    destroy-on-close
    safe-area-inset-bottom
    @opened="cancelButton?.focus({ preventScroll: true })"
    @closed="restoreFocus"
    @keydown="handleKeydown"
  >
    <div ref="panel">
      <header class="date-picker-header">
        <button ref="cancelButton" type="button" class="text-button date-picker-cancel" @click="show = false">取消</button>
        <h2 :id="titleId">{{ title }}</h2>
        <button type="button" class="date-picker-confirm" @click="picker?.confirm()">确定</button>
      </header>
      <p class="date-picker-preview" aria-live="polite">{{ preview }}</p>
      <DatePicker
        ref="picker"
        v-model="draft"
        :columns-type="columns"
        :min-date="minDate"
        :max-date="maxDate"
        :formatter="formatOption"
        :show-toolbar="false"
        :option-height="48"
        :visible-option-num="5"
        :swipe-duration="300"
        @confirm="confirmSelection"
      />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </div>
  </Popup>
</template>
