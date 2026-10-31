<script setup lang="ts">
import { computed, ref } from 'vue'
import { readBillFile } from '../billFile'
import { parseBillRows, type BillPreview } from '../bills'
import { formatDateInput, formatMoney, type Category, type Transaction, type TransactionType } from '../domain'
import { useSheetFocus } from '../useSheetFocus'

/** 已有主键仅用于预览，提交时数据库仍会在同一事务内重新去重。 */
const props = defineProps<{ categories: Category[]; existingIds: string[]; loading: boolean; saving: boolean; error: string }>()
/** 数据库写入和失败重试由根组件统一处理。 */
const emit = defineEmits<{ close: []; retry: []; confirm: [entries: Transaction[]] }>()
// 文件解析失败保留当前账本；重新选文件时清掉旧预览，避免误确认。
const preview = ref<BillPreview | null>(null)
const filename = ref('')
const reading = ref(false)
const localError = ref('')
const fileInput = ref<HTMLInputElement>()
const panel = ref<HTMLElement>()
// 每个收支类型可以更换统一归类，默认优先使用启用的“其他”。
const categoryIds = ref({ expense: defaultCategory('expense'), income: defaultCategory('income') })
const page = ref(0)
const onlySkipped = ref(false)
const busy = computed(() => props.saving || props.loading || reading.value)
const entries = computed(() => preview.value?.rows.flatMap((row) => row.entry ? [row.entry] : []) ?? [])
const skipped = computed(() => preview.value?.rows.filter((row) => row.reason) ?? [])
const visibleRows = computed(() => (onlySkipped.value ? skipped.value : preview.value?.rows ?? []).slice(page.value * 50, (page.value + 1) * 50))
const pageCount = computed(() => Math.ceil((onlySkipped.value ? skipped.value.length : preview.value?.rows.length ?? 0) / 50))
const missingCategory = computed(() => entries.value.some((entry) => !props.categories.some((category) => category.id === categoryIds.value[entry.type] && category.active && category.type === entry.type)))
useSheetFocus(panel, () => { if (!busy.value) emit('close') })

/** 只列出已保存且启用的分类，设置抽屉中未保存的草稿不参与导入。 */
function categoriesFor(type: TransactionType) {
  return props.categories.filter((category) => category.type === type && category.active)
}

/** 自定义账本没有“其他”时使用首个启用分类，预览中允许更换。 */
function defaultCategory(type: TransactionType): string {
  const available = categoriesFor(type)
  return (available.find((category) => category.name === '其他') ?? available[0])?.id ?? ''
}

/** 文件仅在内存中解析，全部校验完成后才显示可确认的预览。 */
async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  preview.value = null
  filename.value = file.name
  localError.value = ''
  page.value = 0
  onlySkipped.value = false
  reading.value = true
  try {
    preview.value = parseBillRows(await readBillFile(file), new Set(props.existingIds))
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '账单读取失败，请重新选择文件'
  } finally {
    reading.value = false
  }
}

/** 提交普通对象而非 Vue 代理；只有父组件成功写入后才关闭。 */
function confirm() {
  if (busy.value || missingCategory.value || !entries.value.length) return
  emit('confirm', entries.value.map((entry) => ({ ...entry, categoryId: categoryIds.value[entry.type] })))
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="!busy && emit('close')">
    <section ref="panel" class="sheet bill-import-sheet" role="dialog" aria-modal="true" aria-label="导入微信或支付宝账单">
      <header class="sheet-header">
        <button class="text-button" :disabled="busy" @click="emit('close')">返回</button>
        <h1>导入账单</h1>
        <span />
      </header>
      <div class="settings-content bill-import-content" :aria-busy="busy">
        <p>选择“用于个人对账”的账单，收到压缩包后先解压。支持微信 XLSX／CSV、支付宝 CSV，每次最多 10 MB、20000 条。</p>
        <p>所有处理均在本机完成。确认后追加到账本，不替换已有数据。交易单号相同的账目会跳过；手工记过的同笔消费仍需自行核对。</p>
        <button class="secondary-button" :disabled="busy" @click="fileInput?.click()">{{ reading ? '正在读取…' : '选择账单文件' }}</button>
        <input ref="fileInput" hidden type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="selectFile">
        <p v-if="loading" role="status">正在读取已有账目…</p>
        <p v-if="error || localError" class="form-error" role="alert">{{ error || localError }}</p>
        <button v-if="error" class="secondary-button" :disabled="busy" @click="emit('retry')">重新读取账本</button>
        <template v-if="preview">
          <section class="settings-section">
            <h2>{{ preview.source === 'wechat' ? '微信' : '支付宝' }}账单预览</h2>
            <p class="bill-filename">{{ filename }}</p>
            <p role="status">共 {{ preview.rows.length }} 条，待导入 {{ entries.length }} 条，跳过 {{ skipped.length }} 条。</p>
            <p>退款、关闭交易及不计收支项不会导入，请查看原因后手动核对。</p>
            <label v-for="kind in (['expense', 'income'] as TransactionType[])" :key="kind" class="bill-category-row">
              <span>{{ kind === 'expense' ? '支出归类' : '收入归类' }}</span>
              <select v-model="categoryIds[kind]" :disabled="busy" :aria-label="kind === 'expense' ? '导入支出分类' : '导入收入分类'">
                <option v-if="!categoriesFor(kind).length" value="">请先启用分类</option>
                <option v-for="category in categoriesFor(kind)" :key="category.id" :value="category.id">{{ category.icon }} {{ category.name }}</option>
              </select>
            </label>
            <p v-if="missingCategory" class="form-error" role="alert">请先在设置中保存并启用相应的收支分类。</p>
            <p v-for="kind in (['expense', 'income'] as TransactionType[])" :key="kind">待导入{{ kind === 'expense' ? '支出' : '收入' }} {{ entries.filter((entry) => entry.type === kind).length }} 条：{{ formatMoney(entries.filter((entry) => entry.type === kind).reduce((sum, entry) => sum + entry.amountCents, 0)) }}</p>
            <button class="primary-button" :disabled="busy || missingCategory || !entries.length || !!error" @click="confirm">{{ saving ? '正在导入…' : `确认追加 ${entries.length} 条` }}</button>
          </section>
          <label class="backup-reminder-toggle"><span>只看跳过项与原因</span><input v-model="onlySkipped" type="checkbox" @change="page = 0"></label>
          <ol class="bill-preview-list" aria-label="账单明细预览">
            <li v-for="row in visibleRows" :key="row.line">
              <b>第 {{ row.line }} 行 · {{ row.entry ? `${row.entry.type === 'income' ? '收入' : '支出'} ${formatMoney(row.entry.amountCents)}` : '跳过' }}</b>
              <span>{{ row.description || '无商品说明' }}</span>
              <span v-if="row.entry">{{ formatDateInput(row.entry.occurredAt) }} · {{ row.entry.note }}</span>
              <span v-else class="bill-skip-reason">{{ row.reason }}</span>
            </li>
          </ol>
          <div v-if="pageCount > 1" class="bill-pagination" aria-label="预览分页">
            <button class="secondary-button" :disabled="page === 0" @click="page--">上一页</button>
            <span>{{ page + 1 }} / {{ pageCount }}</span>
            <button class="secondary-button" :disabled="page + 1 >= pageCount" @click="page++">下一页</button>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
