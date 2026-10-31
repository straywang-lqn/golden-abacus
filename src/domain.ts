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

/** 某月起生效的预算；后续月份沿用，遇到下一份配置时停止沿用。 */
export type MonthlyBudget = {
  month: string
  /** null 表示不限制总额；分类限额独立计算，收入不抵扣支出。 */
  totalCents: number | null
  categoryLimits: { categoryId: string; amountCents: number }[]
}

/** 单例应用设置，以 `settings/app` 记录持久化。 */
export type AppSettings = {
  currency: 'CNY'
  theme: Theme
  seenStorageNotice: boolean
  budgets: MonthlyBudget[]
  /** 仅记录已触发下载或完成分享的时刻，不能证明用户已保存文件。 */
  lastExportedAt: number | null
  backupReminderEnabled: boolean
}

/** 新建或编辑表单提交的业务字段；主键和审计时间由 App.vue 补齐。 */
export type EntryDraft = Pick<Transaction, 'type' | 'amountCents' | 'categoryId' | 'note' | 'occurredAt'>

/** 首次启动或清空数据后的设置。 */
export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'CNY',
  theme: 'system',
  seenStorageNotice: false,
  budgets: [],
  lastExportedAt: null,
  backupReminderEnabled: true,
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

/** 将元转换为整数分；默认拒绝零值，金额筛选边界可显式允许零。 */
export function toCents(raw: string, allowZero = false): number | null {
  const value = raw.trim()
  // 不接受负数、科学计数法或第三位小数，避免 Number 的宽松解析改变用户输入。
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null
  const [yuan, fraction = ''] = value.split('.')
  // 补足两位小数后再整体转成分，业务计算全程避免浮点金额。
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  return (cents > 0 || (allowZero && cents === 0)) && Number.isSafeInteger(cents) ? cents : null
}

/** 复制业务内容并重设为今天；停用分类必须重新选择，不复制主键与审计字段。 */
export function copyEntryDraft(item: Transaction, categories: Category[], now = Date.now()): EntryDraft {
  return {
    type: item.type,
    amountCents: item.amountCents,
    categoryId: categories.some((category) => category.id === item.categoryId && category.active && category.type === item.type) ? item.categoryId : '',
    note: item.note,
    occurredAt: now,
  }
}

/** 跨月搜索的条件；空文本和 null 金额表示不限制，日期包含起止两天。 */
export type TransactionFilter = {
  query: string
  type: TransactionType | 'all'
  categoryId: string
  minCents: number | null
  maxCents: number | null
  startDate: string
  endDate: string
}

/** 组合筛选全部账目，保留停用分类并返回按发生时间倒序的新数组。 */
export function filterTransactions(transactions: Transaction[], categories: Category[], filter: TransactionFilter): Transaction[] {
  const names = new Map(categories.map((category) => [category.id, category.name]))
  const query = filter.query.trim().toLocaleLowerCase('zh-CN')
  const start = filter.startDate ? parseDateInput(filter.startDate) : null
  const end = filter.endDate ? parseDateInput(filter.endDate) : null
  // 日期无效时不扩大查询；结束边界使用本地下一个日历日，兼容夏令时。
  if ((filter.startDate && !start) || (filter.endDate && !end)) return []
  if (end) end.setDate(end.getDate() + 1)
  return transactions.filter((item) => (
    (filter.type === 'all' || item.type === filter.type)
    && (!filter.categoryId || item.categoryId === filter.categoryId)
    && (filter.minCents === null || item.amountCents >= filter.minCents)
    && (filter.maxCents === null || item.amountCents <= filter.maxCents)
    && (!start || item.occurredAt >= start.getTime())
    && (!end || item.occurredAt < end.getTime())
    && (!query || `${item.note}\n${names.get(item.categoryId) ?? ''}`.toLocaleLowerCase('zh-CN').includes(query))
  )).sort((a, b) => b.occurredAt - a.occurredAt)
}

/** 获取指定月最近一次生效的预算；未来配置不影响历史月份。 */
export function budgetForMonth(budgets: MonthlyBudget[], month: Date): MonthlyBudget | undefined {
  const key = formatDateInput(month.getTime()).slice(0, 7)
  return budgets.filter((budget) => budget.month <= key).sort((a, b) => b.month.localeCompare(a.month))[0]
}

/** 将月度支出与总额、分类限额比较；超支保留负余额供文案呈现。 */
export function budgetProgress(budget: MonthlyBudget, transactions: Transaction[]) {
  const expense = summarize(transactions).expense
  return {
    expense,
    remaining: budget.totalCents === null ? null : budget.totalCents - expense,
    categories: budget.categoryLimits.map((limit) => {
      const spent = transactions.reduce((sum, item) => sum + (item.type === 'expense' && item.categoryId === limit.categoryId ? item.amountCents : 0), 0)
      return { ...limit, spent, remaining: limit.amountCents - spent }
    }),
  }
}

/** 有账目时每七天在应用内提示导出；关闭提醒或时钟回拨时不误报。 */
export function needsBackupReminder(settings: AppSettings, hasTransactions: boolean, now = Date.now()): boolean {
  return settings.backupReminderEnabled && hasTransactions
    && (settings.lastExportedAt === null || now - settings.lastExportedAt >= 7 * 24 * 60 * 60 * 1000)
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

/** 月份选择采用四位年份 1000–9999；非法或未选完的输入不改变当前月份。 */
export function parseMonthInput(value: string): Date | null {
  // 严格限定格式，避免 Date 自动修正越界月份或宽松解析用户输入。
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) return null
  // 数值构造使用本地月初，与月度查询和前后翻月使用同一时区。
  const [year, month] = value.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

/** 共享日期弹层返回本地日历日期，拒绝闰日和月底被 Date 自动进位的情况。 */
export function parseDateInput(value: string): Date | null {
  // 先复用月份校验，再要求完整的两位日期，避免宽松解析接受不完整输入。
  if (!/^[1-9]\d{3}-\d{2}-(0[1-9]|[12]\d|3[01])$/.test(value)) return null
  const date = parseMonthInput(value.slice(0, 7))
  if (!date) return null
  const day = Number(value.slice(8))
  date.setDate(day)
  return date.getDate() === day ? date : null
}

/** 按本地日期生成共享选择器和备份文件名使用的 YYYY-MM-DD。 */
export function formatDateInput(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 导出状态可能来自缺失字段的旧设置；缺失与损坏分别提示，不把异常日期展示给用户。 */
export function formatLastExportTime(timestamp: unknown): string {
  if (timestamp === null || timestamp === undefined) return '暂无导出记录'
  // 与备份校验保持相同约束，只格式化 Date 可表示的非负整数毫秒值。
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8640000000000000) {
    return '时间记录异常，请重新导出备份'
  }
  return `${formatDateInput(timestamp)} ${new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * 把日期输入转回时间戳。编辑时若日期未变则保留原时分秒；新选的今天用当前时刻，
 * 其他日期取中午以避开少数时区在午夜发生的夏令时切换。
 */
export function dateInputToTimestamp(value: string, previous?: number): number {
  // 日期未改动时保留原始发生时刻；时间戳 0 也是有效记录，不能按真假值判断。
  if (previous !== undefined && formatDateInput(previous) === value) return previous
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

/** 按资金方向汇总分类，金额仍为整数分，百分比保留精度供条形宽度使用。 */
export function categoryBreakdown(transactions: Transaction[], type: TransactionType) {
  // 历史分类无论是否停用都参与汇总；收入与支出各用自己的合计作分母。
  const amounts = new Map<string, number>()
  let total = 0
  for (const item of transactions) {
    if (item.type !== type) continue
    amounts.set(item.categoryId, (amounts.get(item.categoryId) ?? 0) + item.amountCents)
    total += item.amountCents
  }
  // 空账目直接产生空列表；非空分类的正整数金额保证分母大于零。
  return [...amounts.entries()]
    .map(([id, amount]) => ({ id, amount, percent: (amount / total) * 100 }))
    .sort((a, b) => b.amount - a.amount)
}

/** 返回以指定月份为终点的连续六个月统计，缺少账目的月份保留零值。 */
export function monthlyTrend(transactions: Transaction[], month: Date, type: TransactionType) {
  return Array.from({ length: 6 }, (_, index) => {
    // 使用本地月初和半开边界，跨年与相邻月份都不会漏记或重复月初账目。
    const targetMonth = shiftMonth(month, index - 5)
    const [start, end] = monthBounds(targetMonth)
    // 每月只累计当前资金方向，避免收入与支出在趋势中混合。
    const amount = transactions.reduce((sum, item) => sum + (
      item.type === type && item.occurredAt >= start && item.occurredAt < end ? item.amountCents : 0
    ), 0)
    return { month: targetMonth, amount }
  })
}

/** 非零小额占比不能显示为零；其他占比最多显示一位小数。 */
export function formatPercent(percent: number): string {
  return percent > 0 && percent < 1 ? '<1%' : `${Number(percent.toFixed(1))}%`
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
