<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { formatLastExportTime, type AppSettings, type Category, type Theme, type TransactionType } from '../domain'
import { useSheetFocus } from '../useSheetFocus'
import CategoryIconPickerSheet from './CategoryIconPickerSheet.vue'

// 设置首页和三个二级页共用同一个抽屉，返回时恢复对应入口的焦点。
const pageTitles = { home: '设置', categories: '分类管理', appearance: '外观', data: '数据管理' }
type SettingsPage = keyof typeof pageTitles

// 主题选项与首页摘要共用中文名称。
const themeLabels: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

// 产品版本由构建配置从 Android 注入。
const appVersion: string = import.meta.env.VITE_APP_VERSION

/** 根组件处理持久化，保存失败时当前编辑页保留草稿。 */
const props = defineProps<{
  categories: Category[]
  settings: AppSettings
  saving: boolean
  aiStatus: string
  aiLoading: boolean
  saveCategories: (categories: Category[]) => Promise<void>
  savePreferences: (preferences: Partial<Pick<AppSettings, 'theme' | 'backupReminderEnabled'>>) => Promise<void>
}>()

/** 数据操作和 AI 配置沿用根组件的入口。 */
const emit = defineEmits<{
  ai: []
  close: []
  clear: []
  exportData: []
  importData: [file: File]
  openBillImport: []
  exportCsv: []
}>()

// 当前页决定导航焦点和可提交的设置项。
const page = ref<SettingsPage>('home')
const panel = ref<HTMLElement>()
const content = ref<HTMLElement>()
const backButton = ref<HTMLButtonElement>()
// Escape 优先撤回清空确认，再按层级返回。
useSheetFocus(panel, () => {
  if (props.saving) return
  if (page.value === 'data' && confirmClear.value) setClearConfirmation(false)
  else goBack()
})

// 分类草稿与已保存状态隔离，收支各保留一份新增表单。
const localCategories = ref<Category[]>([])
const categoryType = ref<TransactionType>('expense')
const newCategories = ref({ expense: { name: '', icon: '✨' }, income: { name: '', icon: '✨' } })
const newCategory = computed(() => newCategories.value[categoryType.value])
const visibleCategories = computed(() => localCategories.value
  .filter((category) => category.type === categoryType.value)
  .sort((a, b) => a.order - b.order))
const iconPickerOpen = ref(false)

// 外观和备份提醒独立保存，打开对应页面才读取已保存值。
const theme = ref<Theme>(props.settings.theme)
const backupReminderEnabled = ref(props.settings.backupReminderEnabled)
const reminderInput = ref<HTMLInputElement>()

// 数据操作的确认状态与文件输入仅在数据管理页使用。
const confirmClear = ref(false)
const clearButton = ref<HTMLButtonElement>()
const cancelClearButton = ref<HTMLButtonElement>()
const backupInput = ref<HTMLInputElement>()

// 错误留在当前页，并滚动到错误信息供用户处理。
const error = ref('')
const errorMessage = ref<HTMLElement>()

/** 打开二级页时，用最新已保存数据初始化该页草稿。 */
function openPage(nextPage: Exclude<SettingsPage, 'home'>) {
  if (props.saving) return
  if (nextPage === 'categories') {
    localCategories.value = props.categories.map((category) => ({ ...category }))
    categoryType.value = 'expense'
    newCategories.value = { expense: { name: '', icon: '✨' }, income: { name: '', icon: '✨' } }
  } else if (nextPage === 'appearance') {
    theme.value = props.settings.theme
  } else {
    backupReminderEnabled.value = props.settings.backupReminderEnabled
    confirmClear.value = false
  }
  page.value = nextPage
  nextTick(() => {
    content.value?.scrollTo(0, 0)
    backButton.value?.focus()
  })
}

/** 返回首页会舍弃当前页草稿，关闭首页则交给共用抽屉恢复外部焦点。 */
function goBack() {
  if (props.saving) return
  if (page.value === 'home') {
    emit('close')
    return
  }

  const previousPage = page.value
  error.value = ''
  page.value = 'home'
  nextTick(() => {
    content.value?.scrollTo(0, 0)
    panel.value?.querySelector<HTMLElement>(`[data-settings-entry="${previousPage}"]`)?.focus()
  })
}

/** 校验当前类型的新增表单，分类写入仍需点击保存。 */
function addCategory() {
  const name = newCategory.value.name.trim()
  const icon = newCategory.value.icon.trim()
  if (!name || !icon) {
    showError('请填写分类图标和名称')
    return
  }

  // 仅在同一收支类型内检查重名，新分类追加在当前类型末尾。
  if (visibleCategories.value.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    showError('已有同名分类')
    return
  }
  localCategories.value.push({
    id: crypto.randomUUID(),
    type: categoryType.value,
    name,
    icon,
    order: visibleCategories.value.length,
    active: true,
  })
  newCategory.value.name = ''
  newCategory.value.icon = '✨'
  error.value = ''
}

/** 让错误可见并恢复键盘焦点，保留草稿供用户修改或重试。 */
function showError(message: string) {
  error.value = message
  nextTick(() => errorMessage.value?.focus())
}

/** 只提交当前页所编辑的数据，分类提交前移除 Vue 代理并清理文本。 */
async function submit() {
  if (props.saving) return
  error.value = ''
  try {
    if (page.value === 'categories') {
      if (localCategories.value.some((category) => !category.name.trim() || !category.icon.trim())) {
        showError('分类图标和名称不能为空')
        return
      }
      // 保持与数据库读取一致的收支分组与排序，供账本和搜索立即使用。
      const nextCategories = localCategories.value.map((category) => ({
        ...category,
        name: category.name.trim(),
        icon: category.icon.trim(),
      })).sort((a, b) => a.type.localeCompare(b.type) || a.order - b.order)
      await props.saveCategories(nextCategories)
    } else if (page.value === 'appearance') {
      await props.savePreferences({ theme: theme.value })
    } else if (page.value === 'data') {
      // 保存提醒后留在数据管理页，继续操作备份或账单。
      await props.savePreferences({ backupReminderEnabled: backupReminderEnabled.value })
      await nextTick()
      reminderInput.value?.focus({ preventScroll: true })
      return
    }
    // 分类和主题保存成功后返回首页，让已保存的状态立即可见。
    await nextTick()
    goBack()
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : '保存失败，请重试')
  }
}

/** 显示确认时将焦点放在取消按钮，收起后恢复到清空入口。 */
function setClearConfirmation(visible: boolean) {
  confirmClear.value = visible
  nextTick(() => (visible ? cancelClearButton.value : clearButton.value)?.focus())
}

/** 取单个备份文件上抛，并重置输入框以允许重选同一文件。 */
function selectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('importData', file)
  input.value = ''
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="goBack">
    <section ref="panel" class="sheet settings-sheet" role="dialog" aria-modal="true" :aria-label="pageTitles[page]">
      <header class="sheet-header">
        <button ref="backButton" class="text-button" :disabled="saving" @click="goBack">{{ page === 'home' ? '关闭' : '返回' }}</button>
        <h1>{{ pageTitles[page] }}</h1>
        <button v-if="page === 'categories' || page === 'appearance'" class="text-button" :disabled="saving" @click="submit">{{ saving ? '保存中' : '保存' }}</button>
      </header>

      <div ref="content" class="settings-content">
        <!-- 首页只显示入口和摘要，表单在进入对应页面后渲染。 -->
        <template v-if="page === 'home'">
          <nav class="settings-menu" aria-label="设置项目">
            <button data-settings-entry="categories" :disabled="saving" @click="openPage('categories')">
              <span>分类管理</span><small>支出与收入</small>
            </button>
            <button data-settings-entry="appearance" :disabled="saving" @click="openPage('appearance')">
              <span>外观</span><small>{{ themeLabels[settings.theme] }}</small>
            </button>
            <button data-settings-entry="data" :disabled="saving" @click="openPage('data')">
              <span>数据管理</span><small>备份、恢复与账单</small>
            </button>
            <button :disabled="saving || aiLoading" aria-haspopup="dialog" @click="emit('ai')">
              <span>AI 助手</span><small>{{ aiStatus }}</small>
            </button>
          </nav>
          <p class="settings-version">金算盘 {{ appVersion }}</p>
        </template>

        <p v-if="error" ref="errorMessage" class="form-error" role="alert" tabindex="-1">{{ error }}</p>

        <!-- 使用原生单选支持方向键切换，同时保留既有分段控件外观。 -->
        <template v-if="page === 'categories'">
          <section class="settings-section">
            <fieldset class="segmented-control compact settings-radio" aria-label="分类类型" :disabled="saving">
              <label v-for="kind in (['expense', 'income'] as const)" :key="kind" :class="{ active: categoryType === kind }">
                <input v-model="categoryType" type="radio" name="settings-category-type" :value="kind">
                {{ kind === 'expense' ? '支出' : '收入' }}
              </label>
            </fieldset>
            <div class="category-settings-list">
              <div v-for="category in visibleCategories" :key="category.id" class="category-setting-row">
                <input v-model="category.icon" class="icon-input" maxlength="2" :disabled="saving" :aria-label="`${category.name}图标`">
                <input v-model="category.name" maxlength="12" :disabled="saving" :aria-label="'分类名称'">
                <span class="switch-copy" aria-hidden="true">{{ category.active ? '启用' : '停用' }}</span>
                <span class="settings-switch">
                  <input v-model="category.active" type="checkbox" :disabled="saving" :aria-label="`${category.name}启用状态`">
                  <span aria-hidden="true"></span>
                </span>
              </div>
            </div>
          </section>

          <section class="settings-section add-category">
            <h2>新增分类</h2>
            <div class="new-category-row">
              <button type="button" class="icon-input" :disabled="saving" :aria-label="`选择新分类图标，当前${newCategory.icon}`" aria-haspopup="dialog" :aria-expanded="iconPickerOpen" @click="iconPickerOpen = true">{{ newCategory.icon }}</button>
              <input v-model="newCategory.name" maxlength="12" :disabled="saving" placeholder="分类名称" aria-label="新分类名称">
              <button class="secondary-button" :disabled="saving" @click="addCategory">添加</button>
            </div>
          </section>
        </template>

        <!-- 主题草稿只有确认保存后才改变应用外观。 -->
        <section v-if="page === 'appearance'" class="settings-section">
          <fieldset class="theme-options settings-radio" aria-label="主题" :disabled="saving">
            <label v-for="(label, option) in themeLabels" :key="option" :class="{ selected: theme === option }">
              <input v-model="theme" type="radio" name="settings-theme" :value="option">
              {{ label }}
            </label>
          </fieldset>
        </section>

        <!-- JSON 备份可恢复全部账本，第三方账单和 CSV 单独列出。 -->
        <template v-if="page === 'data'">
          <section class="settings-section settings-data-section">
            <h2>备份与恢复</h2>
            <p>账本仅保存在本机。卸载或清除应用数据前，请先导出备份。</p>
            <p>最近导出：{{ formatLastExportTime(settings.lastExportedAt) }}</p>
            <div class="settings-backup-actions">
              <button class="secondary-button" :disabled="saving" @click="emit('exportData')">导出备份</button>
              <button class="secondary-button" :disabled="saving" @click="backupInput?.click()">导入备份</button>
              <input ref="backupInput" hidden type="file" accept="application/json,.json" @change="selectBackup">
            </div>
            <p>导入前会校验文件，并在确认后替换当前全部账本数据。</p>
            <p>导出时间仅记录下载或分享操作，请确认文件已保存到应用之外。</p>
            <label class="backup-reminder-toggle">
              <span>每 7 天在应用内提醒备份</span>
              <span class="settings-switch">
                <input ref="reminderInput" v-model="backupReminderEnabled" type="checkbox" :disabled="saving">
                <span aria-hidden="true"></span>
              </span>
            </label>
            <button v-if="backupReminderEnabled !== settings.backupReminderEnabled" class="secondary-button" :disabled="saving" @click="submit">保存提醒设置</button>
          </section>

          <section class="settings-section settings-data-section">
            <h2>账单与表格</h2>
            <div class="bill-actions">
              <button class="secondary-button" :disabled="saving" @click="emit('openBillImport')">导入微信／支付宝账单</button>
              <button class="secondary-button" :disabled="saving" @click="emit('exportCsv')">导出全部账目 CSV</button>
            </div>
            <p>账单先预览、确认后追加，重复交易单号会跳过。CSV 可用 Excel／WPS 查看；恢复账本请使用上方的 JSON 备份。</p>
          </section>

          <section class="settings-section settings-data-section">
            <h2>清空数据</h2>
            <button v-if="!confirmClear" ref="clearButton" class="danger-text" :disabled="saving" @click="setClearConfirmation(true)">清空全部数据</button>
            <div v-else class="clear-confirm" role="group" aria-label="清空确认">
              <b>此操作不可恢复</b>
              <div>
                <button ref="cancelClearButton" class="secondary-button" :disabled="saving" @click="setClearConfirmation(false)">取消</button>
                <button class="danger-button" :disabled="saving" @click="emit('clear')">确认清空</button>
              </div>
            </div>
          </section>
        </template>
      </div>
    </section>
    <!-- 图标弹层确认后只修改当前新增分类的草稿。 -->
    <CategoryIconPickerSheet v-if="iconPickerOpen" :value="newCategory.icon" @close="iconPickerOpen = false" @confirm="newCategory.icon = $event; iconPickerOpen = false" />
  </div>
</template>
