<script setup lang="ts">
import { ref } from 'vue'
import { formatLastExportTime, type AppSettings, type Category, type Theme, type TransactionType } from '../domain'
import { useSheetFocus } from '../useSheetFocus'
import CategoryIconPickerSheet from './CategoryIconPickerSheet.vue'

/** 设置抽屉接收当前快照，只有用户保存或执行数据操作时才通知父组件。 */
const props = defineProps<{
  categories: Category[]
  settings: AppSettings
  saving: boolean
}>()

/** 所有会触及 IndexedDB 或文件系统的操作均由 App.vue 实现。 */
const emit = defineEmits<{
  close: []
  save: [categories: Category[], settings: AppSettings]
  clear: []
  exportData: []
  importData: [file: File]
}>()

// 深度仅一层的普通对象副本足以隔离表单编辑，避免直接修改 props。
const localCategories = ref(props.categories.map((category) => ({ ...category })))
const theme = ref<Theme>(props.settings.theme)
// 开关随设置一起保存，取消不改变持久化提醒偏好。
const backupReminderEnabled = ref(props.settings.backupReminderEnabled)

// 新分类表单状态与设置保存错误。
const newType = ref<TransactionType>('expense')
const newName = ref('')
const newIcon = ref('✨')
// 图标选择器按需挂载，关闭后释放内部草稿并恢复入口焦点。
const iconPickerOpen = ref(false)
const error = ref('')
const confirmClear = ref(false)
const backupInput = ref<HTMLInputElement>()
const panel = ref<HTMLElement>()
useSheetFocus(panel, () => { if (!props.saving) emit('close') })

/** 返回指定收支类型的本地分类副本，并按显示顺序排列。 */
function categoriesFor(type: TransactionType) {
  return localCategories.value.filter((category) => category.type === type).sort((a, b) => a.order - b.order)
}

/** 校验并追加一个本地分类；真正持久化要等用户点击保存。 */
function addCategory() {
  // 输入先标准化，校验和最终保存使用同一份名称与图标。
  const name = newName.value.trim()
  const icon = newIcon.value.trim()
  if (!name || !icon) {
    error.value = '请填写分类图标和名称'
    return
  }
  // 同一收支类型不允许仅大小写不同的重复名称。
  if (categoriesFor(newType.value).some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    error.value = '已有同名分类'
    return
  }
  localCategories.value.push({
    id: crypto.randomUUID(),
    type: newType.value,
    name,
    icon,
    // 新分类追加到同类型末尾，现有显示顺序不受影响。
    order: categoriesFor(newType.value).length,
    active: true,
  })
  // 只在成功加入后重置表单，校验失败时保留用户输入供修正。
  newName.value = ''
  newIcon.value = '✨'
  error.value = ''
}

/** 清理可编辑文本后提交普通对象副本，避免把 Vue 代理写入 IndexedDB。 */
function submit() {
  error.value = ''
  // 在向父组件发事件前再次检查全部可编辑分类，包含原有分类的修改。
  if (localCategories.value.some((category) => !category.name.trim() || !category.icon.trim())) {
    error.value = '分类图标和名称不能为空'
    return
  }
  // 映射为普通对象并清理文本，避免 Vue ref 中的代理穿过持久化边界。
  emit('save', localCategories.value.map((category) => ({
    ...category,
    name: category.name.trim(),
    icon: category.icon.trim(),
  })), { ...props.settings, theme: theme.value, backupReminderEnabled: backupReminderEnabled.value })
}

/** 取单个备份文件上抛，并重置 input 以允许再次选择同一文件。 */
function selectBackup(event: Event) {
  // change 事件目标是文件输入框，取第一项即可；界面仅允许单文件导入。
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('importData', file)
  // 即使导入失败也清空选择，用户才能重新选择同一个备份文件。
  input.value = ''
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="!saving && $emit('close')">
    <section ref="panel" class="sheet settings-sheet" role="dialog" aria-modal="true" aria-label="设置">
      <header class="sheet-header">
        <button class="text-button" :disabled="saving" @click="$emit('close')">取消</button>
        <h1>设置</h1>
        <button class="text-button" :disabled="saving" @click="submit">{{ saving ? '保存中' : '保存' }}</button>
      </header>

      <div class="settings-content">
        <section class="settings-section">
          <h2>外观</h2>
          <div class="theme-options" role="group" aria-label="主题">
            <button v-for="option in (['system', 'light', 'dark'] as Theme[])" :key="option" :class="{ selected: theme === option }" :aria-pressed="theme === option" @click="theme = option">
              {{ { system: '跟随系统', light: '浅色', dark: '深色' }[option] }}
            </button>
          </div>
        </section>

        <!-- 收入、支出复用同一编辑结构，停用分类不会删除历史账目。 -->
        <section v-for="kind in (['expense', 'income'] as TransactionType[])" :key="kind" class="settings-section">
          <h2>{{ kind === 'expense' ? '支出分类' : '收入分类' }}</h2>
          <div class="category-settings-list">
            <label v-for="category in categoriesFor(kind)" :key="category.id" class="category-setting-row">
              <input v-model="category.icon" class="icon-input" maxlength="2" :aria-label="`${category.name}图标`">
              <input v-model="category.name" maxlength="12" :aria-label="'分类名称'">
              <span class="switch-copy">{{ category.active ? '启用' : '停用' }}</span>
              <input v-model="category.active" type="checkbox" class="switch" :aria-label="`${category.name}${category.active ? '停用' : '启用'}`">
            </label>
          </div>
        </section>

        <section class="settings-section add-category">
          <h2>新增分类</h2>
          <div class="segmented-control compact">
            <button :class="{ active: newType === 'expense' }" @click="newType = 'expense'">支出</button>
            <button :class="{ active: newType === 'income' }" @click="newType = 'income'">收入</button>
          </div>
          <div class="new-category-row">
            <button type="button" class="icon-input" :aria-label="`选择新分类图标，当前${newIcon}`" aria-haspopup="dialog" :aria-expanded="iconPickerOpen" @click="iconPickerOpen = true">{{ newIcon }}</button>
            <input v-model="newName" maxlength="12" placeholder="分类名称" aria-label="新分类名称">
            <button class="secondary-button" @click="addCategory">添加</button>
          </div>
        </section>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>

        <!-- 导入、导出和清空都交给父组件处理忙碌状态与错误。 -->
        <section class="settings-section privacy-section">
          <h2>隐私与数据</h2>
          <p><b>所有数据仅保存在此设备。</b></p>
          <p>应用不登录、不同步、不上传数据。卸载或清除应用数据前，请先导出备份。</p>
          <p>最近导出：{{ formatLastExportTime(settings.lastExportedAt) }}</p>
          <label class="backup-reminder-toggle"><span>每 7 天在应用内提醒备份</span><input v-model="backupReminderEnabled" type="checkbox" aria-label="开启应用内备份提醒"></label>
          <div class="theme-options">
            <button :disabled="saving" @click="$emit('exportData')">导出备份</button>
            <button :disabled="saving" @click="backupInput?.click()">导入备份</button>
            <input ref="backupInput" hidden type="file" accept="application/json,.json" @change="selectBackup">
          </div>
          <p>导入前会校验文件，并在确认后替换当前全部数据。</p>
          <p>导出时间仅记录下载或分享操作，请确认文件已保存到应用之外。</p>
          <button v-if="!confirmClear" class="danger-text" @click="confirmClear = true">清空全部数据</button>
          <div v-else class="clear-confirm" role="alert">
            <b>此操作不可恢复</b>
            <div>
              <button class="secondary-button" @click="confirmClear = false">取消</button>
              <button class="danger-button" @click="$emit('clear')">确认清空</button>
            </div>
          </div>
        </section>
      </div>
    </section>
    <!-- 短弹层独立管理草稿和焦点，取消不会改动新增分类表单。 -->
    <CategoryIconPickerSheet v-if="iconPickerOpen" :value="newIcon" @close="iconPickerOpen = false" @confirm="newIcon = $event; iconPickerOpen = false" />
  </div>
</template>
