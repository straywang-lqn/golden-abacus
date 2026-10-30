<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { computed, onMounted, ref } from 'vue'
import { MAX_BACKUP_BYTES, parseBackup } from './backup'
import EntrySheet from './components/EntrySheet.vue'
import BudgetSheet from './components/BudgetSheet.vue'
import LedgerView from './components/LedgerView.vue'
import SettingsSheet from './components/SettingsSheet.vue'
import SearchSheet from './components/SearchSheet.vue'
import StatsView from './components/StatsView.vue'
import {
  clearAllData,
  createBackup,
  getCategories,
  getAllTransactions,
  getSettings,
  getTransactionsBetween,
  initializeDatabase,
  hasTransactions,
  removeTransaction,
  restoreBackup,
  saveCategories,
  saveSettings,
  saveTransaction,
} from './db'
import {
  DEFAULT_SETTINGS,
  budgetForMonth,
  copyEntryDraft,
  formatDateInput,
  formatMoney,
  monthBounds,
  needsBackupReminder,
  shiftMonth,
  type AppSettings,
  type Category,
  type EntryDraft,
  type MonthlyBudget,
  type Transaction,
} from './domain'

// 顶层页面状态：month 始终是当月 1 日，作为两个视图共用的查询基准。
const activeView = ref<'ledger' | 'stats'>('ledger')
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

// transactions 只含当前月；trendTransactions 覆盖统计图需要的近六个月。
const transactions = ref<Transaction[]>([])
const trendTransactions = ref<Transaction[]>([])

// 从 IndexedDB 读取的持久化状态。
const categories = ref<Category[]>([])
const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
// 备份提醒依据所有月份是否有数据，不能仅检查当前月。
const hasAnyTransactions = ref(false)
const backupDue = computed(() => needsBackupReminder(settings.value, hasAnyTransactions.value))
const currentBudget = computed(() => budgetForMonth(settings.value.budgets, month.value))

// 业务抽屉和当前编辑对象；复制草稿没有原记录身份。
const entryOpen = ref(false)
const settingsOpen = ref(false)
const editing = ref<Transaction | null>(null)
const initialDraft = ref<EntryDraft | null>(null)
const budgetOpen = ref(false)
const budgetError = ref('')
// 搜索首次打开才加载全部历史，读取失败留在搜索抽屉内重试。
const searchOpen = ref(false)
const searchTransactions = ref<Transaction[]>([])
const searchLoading = ref(false)
const searchError = ref('')

// 共享的异步操作与用户反馈状态，防止多个抽屉重复提交。
const saving = ref(false)
const entryError = ref('')
const fatalError = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined

/** 把持久化主题映射到根元素，CSS 负责实际配色。 */
function applyTheme() {
  document.documentElement.dataset.theme = settings.value.theme
}

/** 并行刷新当前月列表和以当前月为终点的六个月趋势数据。 */
async function refreshTransactions() {
  // 保存查询月份，防止快速切月时较慢的旧查询覆盖当前页。
  const requestedMonth = month.value.getTime()
  // 当前列表只取所选月；趋势从前五个月月初延伸到该月结束。
  const [start, end] = monthBounds(month.value)
  const [trendStart] = monthBounds(shiftMonth(month.value, -5))
  const [currentTransactions, recentTransactions, anyTransactions] = await Promise.all([
    getTransactionsBetween(start, end),
    getTransactionsBetween(trendStart, end),
    hasTransactions(),
  ])
  // 两组数据必须属于同一次选月，过期结果不写入响应式状态。
  if (month.value.getTime() !== requestedMonth) return
  transactions.value = currentTransactions
  trendTransactions.value = recentTransactions
  hasAnyTransactions.value = anyTransactions
}

/** 每次打开或改账后更新搜索快照，加载错误只影响搜索并允许重试。 */
async function refreshSearch() {
  if (!searchOpen.value) return
  searchLoading.value = true
  searchError.value = ''
  try {
    searchTransactions.value = await getAllTransactions()
  } catch (error) {
    searchError.value = error instanceof Error ? error.message : '历史账目读取失败，请重试'
  } finally {
    searchLoading.value = false
  }
}

/** 打开搜索时立即呈现加载状态，避免将上次搜索快照当成最新数据。 */
function openSearch() {
  searchOpen.value = true
  refreshSearch()
}

/** 重新载入全部持久化状态；用于启动、设置保存、清空和导入后同步界面。 */
async function refreshAll() {
  // 分类和设置彼此独立，先并发读取以缩短启动和保存后的等待时间。
  ;[categories.value, settings.value] = await Promise.all([getCategories(), getSettings()])
  // 主题依赖刚读取的设置，必须在渲染后续内容前应用。
  applyTheme()
  await refreshTransactions()
}

/** 展示一个自动消失的提示；新提示会替换旧计时器。 */
function notify(message: string) {
  toast.value = message
  // 连续操作只保留最新提示，避免旧计时器提前清空新提示。
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2600)
}

/** 直接选月、前后月和返回本月共用刷新入口，失败保持全局可见。 */
function selectMonth(selected: Date) {
  // 趋势月份也能触发导航，在统一入口阻止无效日期或越过选择器边界。
  if (!Number.isFinite(selected.getTime()) || selected.getFullYear() < 1000 || selected.getFullYear() > 9999) return
  // 月份状态始终归一到 1 日；同月选择不重复读取数据库。
  const normalized = shiftMonth(selected, 0)
  if (normalized.getTime() === month.value.getTime()) return
  month.value = normalized
  // 立即清掉上一月显示值，避免新标题短暂配上旧月份金额。
  transactions.value = []
  trendTransactions.value = []
  refreshTransactions().catch(showFatalError)
}

/** 统一把未知异常转换成用户可操作的数据库错误提示。 */
function showFatalError(error: unknown) {
  fatalError.value = error instanceof Error ? error.message : '本地数据库操作失败'
}

/** 打开空白记账表单。 */
function openNewEntry() {
  editing.value = null
  initialDraft.value = null
  entryError.value = ''
  entryOpen.value = true
}

/** 打开表单并保留原记录身份，供覆盖保存。 */
function openEditEntry(item: Transaction) {
  editing.value = item
  initialDraft.value = null
  entryError.value = ''
  entryOpen.value = true
}

/** 在同一抽屉切换成新草稿，用户确认保存前不新增记录。 */
function openCopyEntry(item: Transaction) {
  editing.value = null
  initialDraft.value = copyEntryDraft(item, categories.value)
  entryError.value = ''
}

/** 补齐主键和审计时间，先持久化普通对象，再刷新响应式列表。 */
async function saveEntry(draft: EntryDraft) {
  saving.value = true
  entryError.value = ''
  try {
    // 同一次保存共用一个当前时间，新增保留创建时间，编辑只更新修改时间。
    const now = Date.now()
    // 展开草稿以构造普通对象，IndexedDB 不能克隆 Vue 响应式代理。
    await saveTransaction({
      ...draft,
      id: editing.value?.id ?? crypto.randomUUID(),
      createdAt: editing.value?.createdAt ?? now,
      updatedAt: now,
    })
    // 复制历史记录默认记在今天，保存后主页面定位到新记录所在月。
    if (initialDraft.value) month.value = shiftMonth(new Date(draft.occurredAt), 0)
    // 只在持久化成功后刷新，避免界面显示未落盘的账目。
    await refreshTransactions()
    await refreshSearch()
    entryOpen.value = false
    const category = categories.value.find((item) => item.id === draft.categoryId)
    notify(`已记录 ${formatMoney(draft.amountCents)} ${category?.name ?? '记录'}`)
  } catch (error) {
    entryError.value = error instanceof Error ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 删除指定记录并在提交成功后关闭编辑抽屉。 */
async function deleteEntry(id: string) {
  saving.value = true
  try {
    await removeTransaction(id)
    // 删除成功再关闭抽屉，失败时保留当前编辑上下文和错误位置。
    await refreshTransactions()
    await refreshSearch()
    entryOpen.value = false
    notify('记录已删除')
  } catch (error) {
    entryError.value = error instanceof Error ? error.message : '删除失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 仅替换所选月配置，保留其余月份；数据库写入成功后才更新卡片。 */
async function saveBudget(budget: MonthlyBudget) {
  saving.value = true
  budgetError.value = ''
  try {
    const nextSettings = { ...settings.value, budgets: [...settings.value.budgets.filter((item) => item.month !== budget.month), budget] }
    await saveSettings(nextSettings)
    settings.value = nextSettings
    budgetOpen.value = false
    notify('预算已保存，后续月份自动沿用')
  } catch (error) {
    budgetError.value = error instanceof Error ? error.message : '预算保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 同时保存分类和设置，完成后从数据库重载权威状态。 */
async function savePreferences(nextCategories: Category[], nextSettings: AppSettings) {
  saving.value = true
  try {
    // 两个存储没有相互引用，可并发保存；任一失败都会保留设置抽屉。
    await Promise.all([saveCategories(nextCategories), saveSettings(nextSettings)])
    await refreshAll()
    settingsOpen.value = false
    notify('设置已保存')
  } catch (error) {
    showFatalError(error)
  } finally {
    saving.value = false
  }
}

/** 持久化“本机存储”提示的已读状态。 */
async function dismissStorageNotice() {
  try {
    // 复制当前设置，既保留其余字段也不把 reactive 对象直接交给 IndexedDB。
    const nextSettings = { ...settings.value, seenStorageNotice: true }
    await saveSettings(nextSettings)
    settings.value = nextSettings
  } catch (error) {
    showFatalError(error)
  }
}

/** 清空用户数据并恢复默认值，然后回到当前月份。 */
async function clearData() {
  saving.value = true
  try {
    await clearAllData()
    // 清空后从本月重新查询，确保列表、趋势、分类和设置全部回到数据库状态。
    month.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    await refreshAll()
    settingsOpen.value = false
    notify('全部数据已清空')
  } catch (error) {
    showFatalError(error)
  } finally {
    saving.value = false
  }
}

/** 原生端写入缓存后调用系统分享；浏览器端使用临时下载链接。 */
async function exportBackup() {
  saving.value = true
  try {
    // 缩进 JSON 便于用户在需要时人工检查备份内容。
    const backup = await createBackup()
    const exportedAt = Date.parse(backup.exportedAt)
    backup.settings.lastExportedAt = exportedAt
    const json = JSON.stringify(backup, null, 2)
    const filename = `golden-abacus-backup-${formatDateInput(Date.now())}.json`
    if (Capacitor.isNativePlatform()) {
      // 原生平台先写缓存文件，系统分享面板需要可访问的文件 URI。
      const file = await Filesystem.writeFile({
        path: filename,
        data: json,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      })
      const shared = await Share.share({
        title: '金算盘数据备份',
        files: [file.uri],
        dialogTitle: '导出金算盘备份',
      })
      // 未选择分享目标不算完成导出，不能抑制后续备份提醒。
      if (!shared.activityType) {
        notify('尚未确认导出，请将备份保存到应用之外')
        return
      }
    } else {
      // 浏览器没有文件系统分享 API 时，以临时 Blob 链接触发下载。
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      // 下载触发后立即释放 Blob，避免长时间使用时累积内存。
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    // 只在下载触发或分享完成后记录时间，不将文件生成等同于已安全保存。
    const nextSettings = { ...settings.value, lastExportedAt: exportedAt }
    await saveSettings(nextSettings)
    settings.value = nextSettings
    notify('已发起导出，请确认备份文件已保存')
  } catch (error) {
    // 分享取消是用户操作，保留原导出时间和提醒状态。
    if (error instanceof Error && error.message === 'Share canceled') {
      notify('已取消导出')
      return
    }
    showFatalError(error)
  } finally {
    saving.value = false
  }
}

/** 在用户确认后原子恢复已校验的备份，并重载整个界面状态。 */
async function importBackup(file: File) {
  saving.value = true
  try {
    // 文件大小先于读取与解析检查，避免把明显不可信的文件载入内存。
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 10 MB')
    const backup = parseBackup(await file.text())
    // 在任何数据库写入前获得确认；restoreBackup 本身会原子替换全部数据。
    if (!window.confirm(`将用备份中的 ${backup.transactions.length} 条账目替换当前全部数据，是否继续？`)) return
    await restoreBackup(backup)
    month.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    await refreshAll()
    settingsOpen.value = false
    notify(`已导入 ${backup.transactions.length} 条账目`)
  } catch (error) {
    showFatalError(error)
  } finally {
    saving.value = false
  }
}

// 首次渲染后再打开 IndexedDB；启动失败留在页面上供用户看到错误。
onMounted(async () => {
  try {
    // 先确保对象存储和默认数据存在，再向组件提供查询结果。
    await initializeDatabase()
    await refreshAll()
  } catch (error) {
    showFatalError(error)
  }
})
</script>

<template>
  <div class="app-shell">
    <!-- 数据库、导入导出等跨页面错误统一显示在最上层。 -->
    <div v-if="fatalError" class="fatal-error" role="alert">
      <span>{{ fatalError }}</span>
      <button @click="fatalError = ''">关闭</button>
    </div>

    <!-- 两个主视图共享月份、分类和账目，由根组件负责持久化。 -->
    <LedgerView
      v-if="activeView === 'ledger'"
      :month="month"
      :transactions="transactions"
      :categories="categories"
      :show-storage-notice="!settings.seenStorageNotice"
      :budget="currentBudget"
      :show-backup-reminder="backupDue"
      :saving="saving"
      @select-month="selectMonth"
      @edit="openEditEntry"
      @add="openNewEntry"
      @settings="settingsOpen = true"
      @search="openSearch"
      @budget="budgetError = ''; budgetOpen = true"
      @export-data="exportBackup"
      @dismiss-notice="dismissStorageNotice"
    />
    <StatsView
      v-else
      :month="month"
      :transactions="transactions"
      :trend-transactions="trendTransactions"
      :categories="categories"
      @select-month="selectMonth"
      @edit="openEditEntry"
      @settings="settingsOpen = true"
    />

    <!-- 底部导航在两个视图中常驻，中间按钮始终新建账目。 -->
    <nav class="bottom-nav" aria-label="主导航">
      <button :class="{ active: activeView === 'ledger' }" @click="activeView = 'ledger'">
        <span aria-hidden="true">☷</span><small>明细</small>
      </button>
      <button class="add-button" aria-label="记一笔" @click="openNewEntry">
        <span aria-hidden="true">＋</span><small>记一笔</small>
      </button>
      <button :class="{ active: activeView === 'stats' }" @click="activeView = 'stats'">
        <span aria-hidden="true">◫</span><small>统计</small>
      </button>
    </nav>

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </Transition>

    <!-- 抽屉使用 v-if，每次打开都会从最新 props 创建一份表单状态。 -->
    <SearchSheet
      v-if="searchOpen"
      :transactions="searchTransactions"
      :categories="categories"
      :loading="searchLoading"
      :load-error="searchError"
      @close="searchOpen = false"
      @retry="refreshSearch"
      @edit="openEditEntry"
    />
    <BudgetSheet
      v-if="budgetOpen"
      :month="month"
      :budgets="settings.budgets"
      :categories="categories"
      :transactions="transactions"
      :saving="saving"
      :save-error="budgetError"
      @close="budgetOpen = false"
      @save="saveBudget"
    />
    <EntrySheet
      v-if="entryOpen"
      :categories="categories"
      :editing="editing"
      :initial-draft="initialDraft"
      :saving="saving"
      :save-error="entryError"
      @close="entryOpen = false"
      @save="saveEntry"
      @delete="deleteEntry"
      @copy="openCopyEntry"
    />
    <SettingsSheet
      v-if="settingsOpen"
      :categories="categories"
      :settings="settings"
      :saving="saving"
      @close="settingsOpen = false"
      @save="savePreferences"
      @clear="clearData"
      @export-data="exportBackup"
      @import-data="importBackup"
    />
  </div>
</template>
