/** 账目的资金方向；金额本身始终保存为正整数分。 */
export type TransactionType = 'expense' | 'income'

/** `system` 表示交给操作系统的配色偏好决定明暗主题。 */
export type Theme = 'system' | 'light' | 'dark'

/** 一笔已经持久化的账目。金额单位为分，时间单位为 Unix 毫秒。 */
export type Transaction = {
  /** 稳定主键；编辑账目时保持不变。 */
  id: string
  type: TransactionType
  amountCents: number
  /** 指向 Category.id；导入备份时会校验引用完整性。 */
  categoryId: string
  note: string
  /** 用户选择的记账时间，用于查询、排序和按日分组。 */
  occurredAt: number
  createdAt: number
  updatedAt: number
}

/** 用户可编辑的收支分类；停用只影响后续选择，不删除历史引用。 */
export type Category = {
  id: string
  type: TransactionType
  name: string
  icon: string
  /** 同一收支类型内的显示顺序，从 0 开始。 */
  order: number
  active: boolean
}

/** 单例应用设置，以 `settings/app` 记录持久化。 */
export type AppSettings = {
  currency: 'CNY'
  theme: Theme
  seenStorageNotice: boolean
}

/** 新建或编辑表单提交的业务字段；主键和审计时间由 App.vue 补齐。 */
export type EntryDraft = Pick<Transaction, 'type' | 'amountCents' | 'categoryId' | 'note' | 'occurredAt'>

/** 首次启动或清空数据后的设置。 */
export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'CNY',
  theme: 'system',
  seenStorageNotice: false,
}

/** 首次启动时写入 IndexedDB 的内置分类。固定 id 保证历史账目的引用稳定。 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'expense-food', type: 'expense', name: '餐饮', icon: '🍜', order: 0, active: true },
  { id: 'expense-transport', type: 'expense', name: '交通', icon: '🚇', order: 1, active: true },
  { id: 'expense-shopping', type: 'expense', name: '购物', icon: '🛒', order: 2, active: true },
  { id: 'expense-home', type: 'expense', name: '住房', icon: '🏠', order: 3, active: true },
  { id: 'expense-fun', type: 'expense', name: '娱乐', icon: '🎮', order: 4, active: true },
  { id: 'expense-health', type: 'expense', name: '医疗', icon: '💊', order: 5, active: true },
  { id: 'expense-study', type: 'expense', name: '学习', icon: '📚', order: 6, active: true },
  { id: 'expense-other', type: 'expense', name: '其他', icon: '•', order: 7, active: true },
  { id: 'income-salary', type: 'income', name: '工资', icon: '💰', order: 0, active: true },
  { id: 'income-bonus', type: 'income', name: '奖金', icon: '🎁', order: 1, active: true },
  { id: 'income-part-time', type: 'income', name: '兼职', icon: '💼', order: 2, active: true },
  { id: 'income-investment', type: 'income', name: '理财', icon: '📈', order: 3, active: true },
  { id: 'income-other', type: 'income', name: '其他', icon: '•', order: 4, active: true },
]

// 复用格式化器，避免每次渲染金额时重复创建 Intl 对象。
const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
})

/** 将用户输入的元转换为整数分；非法格式、零值和溢出都返回 null。 */
export function toCents(raw: string): number | null {
  const value = raw.trim()
  // 不接受负数、科学计数法或第三位小数，避免 Number 的宽松解析改变用户输入。
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null
  const [yuan, fraction = ''] = value.split('.')
  // 补足两位小数后再整体转成分，业务计算全程避免浮点金额。
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null
}

/** 将整数分按人民币格式显示。 */
export function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100)
}

/** 根据收支类型为金额补上正负号。 */
export function formatSignedMoney(transaction: Pick<Transaction, 'amountCents' | 'type'>): string {
  return `${transaction.type === 'expense' ? '-' : '+'}${formatMoney(transaction.amountCents)}`
}

/** 返回本地时区中该月的半开区间 `[月初, 下月月初)`。 */
export function monthBounds(month: Date): [number, number] {
  return [
    new Date(month.getFullYear(), month.getMonth(), 1).getTime(),
    new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime(),
  ]
}

/** 移动月份并归一到目标月 1 日，避免月底跨月溢出。 */
export function shiftMonth(month: Date, offset: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + offset, 1)
}

/** 生成年月导航使用的中文标题。 */
export function monthLabel(month: Date): string {
  return `${month.getFullYear()}年${month.getMonth() + 1}月`
}

/** 按本地日期生成原生 `<input type="date">` 需要的 YYYY-MM-DD。 */
export function formatDateInput(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 把日期输入转回时间戳。编辑时若日期未变则保留原时分秒；新选的今天用当前时刻，
 * 其他日期取中午以避开少数时区在午夜发生的夏令时切换。
 */
export function dateInputToTimestamp(value: string, previous?: number): number {
  // 日期未改动时保留原始发生时刻，避免编辑备注后时间被悄悄改写。
  if (previous && formatDateInput(previous) === value) return previous
  const [year, month, day] = value.split('-').map(Number)
  // 非今天统一取中午，规避少数时区在午夜切换夏令时造成的日期偏移。
  const chosen = new Date(year, month - 1, day, 12)
  const today = new Date()
  return chosen.toDateString() === today.toDateString() ? Date.now() : chosen.getTime()
}

/** 汇总一组账目的收入、支出和结余，返回值仍以分为单位。 */
export function summarize(transactions: Transaction[]) {
  const income = transactions.reduce((sum, item) => sum + (item.type === 'income' ? item.amountCents : 0), 0)
  const expense = transactions.reduce((sum, item) => sum + (item.type === 'expense' ? item.amountCents : 0), 0)
  return { income, expense, balance: income - expense }
}

/** 将时间戳压缩为本地日历日键。 */
function dateKey(timestamp: number): string {
  return formatDateInput(timestamp)
}

/** 生成人类可读的日期分组标题，并为今天、昨天使用短标签。 */
export function dayLabel(timestamp: number): string {
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const date = new Date(timestamp)
  // 通过本地日历日比较，而不是比较 24 小时时间差，能正确处理跨日时段。
  if (dateKey(timestamp) === dateKey(today.getTime())) return '今天'
  if (dateKey(timestamp) === dateKey(yesterday.getTime())) return '昨天'
  return `${date.getMonth() + 1}月${date.getDate()}日 ${'日一二三四五六'[date.getDay()]}`
}

/** 按发生日期倒序分组；每组内也保持最新账目在前。 */
export function groupTransactionsByDay(transactions: Transaction[]) {
  const groups = new Map<string, Transaction[]>()
  // 复制后排序，绝不改变组件传入的响应式数组顺序。
  for (const item of [...transactions].sort((a, b) => b.occurredAt - a.occurredAt)) {
    const key = dateKey(item.occurredAt)
    // 每次写回新数组，保持结果作为普通数据而非原数组的可变别名。
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].map(([key, items]) => ({ key, label: dayLabel(items[0].occurredAt), items }))
}
