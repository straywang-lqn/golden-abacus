import { parseMonthInput, type AppSettings, type Category, type MonthlyBudget, type Transaction } from './domain.ts'

/** 导出文件的结构版本；与 IndexedDB 的 DB_VERSION 相互独立。 */
export const BACKUP_FORMAT_VERSION = 2

/** 在解析前执行的体积上限，避免异常文件占用过多内存。 */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

/** 可导出、导入的完整本地数据快照。 */
export type BackupData = {
  formatVersion: typeof BACKUP_FORMAT_VERSION
  /** ISO 8601 格式的导出时间，仅作用户和排障参考。 */
  exportedAt: string
  transactions: Transaction[]
  categories: Category[]
  settings: AppSettings
}

/** 排除 null 与数组，收窄外部 JSON 对象。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验一笔账目的全部持久化字段，不信任 JSON 提供的静态类型。 */
function isTransaction(value: unknown): value is Transaction {
  if (!isObject(value)) return false
  return typeof value.id === 'string'
    && (value.type === 'expense' || value.type === 'income')
    && Number.isSafeInteger(value.amountCents) && Number(value.amountCents) > 0
    && typeof value.categoryId === 'string'
    && typeof value.note === 'string'
    && Number.isSafeInteger(value.occurredAt)
    && Number.isSafeInteger(value.createdAt)
    && Number.isSafeInteger(value.updatedAt)
}

/** 校验分类字段及非空、非负约束。 */
function isCategory(value: unknown): value is Category {
  if (!isObject(value)) return false
  return typeof value.id === 'string' && value.id.length > 0
    && (value.type === 'expense' || value.type === 'income')
    && typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.icon === 'string' && value.icon.trim().length > 0
    && Number.isSafeInteger(value.order) && Number(value.order) >= 0
    && typeof value.active === 'boolean'
}

/** 新旧备份共用的设置约束；扩展字段另行按版本校验。 */
function isBaseSettings(value: unknown): value is Record<string, unknown> & Pick<AppSettings, 'currency' | 'theme' | 'seenStorageNotice'> {
  if (!isObject(value)) return false
  return value.currency === 'CNY'
    && (value.theme === 'system' || value.theme === 'light' || value.theme === 'dark')
    && typeof value.seenStorageNotice === 'boolean'
}

/** 预算使用有效月份、正整数分和唯一分类，不接受宽松解析或重复限额。 */
function isBudget(value: unknown): value is MonthlyBudget {
  if (!isObject(value) || typeof value.month !== 'string' || !parseMonthInput(value.month)) return false
  if (value.totalCents !== null && (!Number.isSafeInteger(value.totalCents) || Number(value.totalCents) <= 0)) return false
  if (!Array.isArray(value.categoryLimits)) return false
  const ids = new Set<string>()
  return value.categoryLimits.every((limit: unknown) => {
    if (!isObject(limit) || typeof limit.categoryId !== 'string' || ids.has(limit.categoryId)
      || !Number.isSafeInteger(limit.amountCents) || Number(limit.amountCents) <= 0) return false
    ids.add(limit.categoryId)
    return true
  })
}

/** v2 设置完整校验，导出状态只能是可显示的非负时间戳或 null。 */
function isSettings(value: unknown): value is AppSettings {
  if (!isObject(value) || !isBaseSettings(value)) return false
  return Array.isArray(value.budgets) && value.budgets.every(isBudget)
    && new Set(value.budgets.map((budget) => budget.month)).size === value.budgets.length
    && (value.lastExportedAt === null || (Number.isSafeInteger(value.lastExportedAt) && Number(value.lastExportedAt) >= 0 && Number(value.lastExportedAt) <= 8640000000000000))
    && typeof value.backupReminderEnabled === 'boolean'
}

/** 防止恢复时 IndexedDB 的 put 静默覆盖同文件中的重复主键。 */
function hasUniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length
}

/**
 * 将不可信备份文本解析为可恢复数据。
 * 校验顺序从文件级结构逐步深入到主键唯一性和分类引用完整性。
 */
export function parseBackup(text: string): BackupData {
  // 先检查原始文本大小，避免 JSON.parse 为过大文件分配内存。
  if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 10 MB')

  let value: unknown
  try {
    // JSON.parse 的返回值必须从 unknown 开始逐层验证，不能直接相信类型断言。
    value = JSON.parse(text)
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }

  // 先锁定文件版本和顶层对象，再读取其余属性。
  if (!isObject(value) || (value.formatVersion !== 1 && value.formatVersion !== BACKUP_FORMAT_VERSION)) {
    throw new Error('不支持此备份文件版本')
  }
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error('备份文件缺少有效的导出时间')
  }
  // 数组成员需完整匹配持久化模型，避免恢复后出现半条记录。
  if (!Array.isArray(value.transactions) || !value.transactions.every(isTransaction)) {
    throw new Error('备份中的账目数据无效')
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0 || !value.categories.every(isCategory)) {
    throw new Error('备份中的分类数据无效')
  }
  if (!(value.formatVersion === 1 ? isBaseSettings(value.settings) : isSettings(value.settings))) {
    throw new Error('备份中的设置数据无效')
  }
  if (!hasUniqueIds(value.transactions) || !hasUniqueIds(value.categories)) {
    throw new Error('备份中存在重复的数据编号')
  }

  // 最后校验外键引用，防止账目恢复后指向不存在的分类。
  const categoryIds = new Set(value.categories.map((category) => category.id))
  if (value.transactions.some((transaction) => !categoryIds.has(transaction.categoryId))) {
    throw new Error('备份中有账目引用了不存在的分类')
  }
  // 旧备份在恢复事务之前补齐新字段，旧账目和主题保持原值。
  const settings: AppSettings = value.formatVersion === 1
    ? { ...(value.settings as Pick<AppSettings, 'currency' | 'theme' | 'seenStorageNotice'>), budgets: [], lastExportedAt: null, backupReminderEnabled: true }
    : value.settings as AppSettings
  const expenseIds = new Set(value.categories.filter((category) => category.type === 'expense').map((category) => category.id))
  if (settings.budgets.some((budget) => budget.categoryLimits.some((limit) => !expenseIds.has(limit.categoryId)))) {
    throw new Error('备份中的预算引用了无效的支出分类')
  }
  return { ...value, formatVersion: BACKUP_FORMAT_VERSION, settings } as BackupData
}
