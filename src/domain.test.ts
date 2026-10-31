import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, budgetForMonth, budgetProgress, categoryBreakdown, copyEntryDraft, dateInputToTimestamp, filterTransactions, formatDateInput, formatLastExportTime, formatPercent, monthBounds, monthlyTrend, needsBackupReminder, parseDateInput, parseMonthInput, summarize, toCents, type MonthlyBudget, type Transaction, type TransactionFilter } from './domain.ts'

// 覆盖金额解析、整数分汇总，以及十二月跨年时的半开月份边界。
test('金额和月度汇总使用整数分计算', () => {
  assert.equal(toCents('0.01'), 1)
  assert.equal(toCents('32'), 3200)
  assert.equal(toCents('1.001'), null)
  assert.equal(toCents('0'), null)

  // 各账目共用与本场景无关的字段，只突出收支方向和金额差异。
  const base = { id: '1', categoryId: 'c', note: '', occurredAt: 0, createdAt: 0, updatedAt: 0 }
  const rows: Transaction[] = [
    { ...base, type: 'income', amountCents: 10001 },
    { ...base, id: '2', type: 'expense', amountCents: 3200 },
  ]
  assert.deepEqual(summarize(rows), { income: 10001, expense: 3200, balance: 6801 })

  const [start, end] = monthBounds(new Date(2026, 11, 20))
  assert.equal(new Date(start).toDateString(), new Date(2026, 11, 1).toDateString())
  assert.equal(new Date(end).toDateString(), new Date(2027, 0, 1).toDateString())
})

// 分类汇总必须隔离收支、合并同类金额，并保留小额比例而不改变原数组。
test('分类统计按收支方向汇总且保留小额占比', () => {
  // 只改变本场景相关字段，让一分钱分类暴露整数百分比导致的精度丢失。
  const base = { id: '1', note: '', occurredAt: 0, createdAt: 0, updatedAt: 0 }
  const rows: Transaction[] = [
    { ...base, type: 'expense', categoryId: 'food', amountCents: 10000 },
    { ...base, id: '2', type: 'expense', categoryId: 'transport', amountCents: 1 },
    { ...base, id: '3', type: 'expense', categoryId: 'food', amountCents: 100 },
    { ...base, id: '4', type: 'income', categoryId: 'bonus', amountCents: 50000 },
    { ...base, id: '5', type: 'income', categoryId: 'salary', amountCents: 300000 },
  ]
  // 保存完整快照，确保统计不会排序或改写调用方持有的账目。
  const original = structuredClone(rows)
  const expense = categoryBreakdown(rows, 'expense')
  assert.deepEqual(expense, [
    { id: 'food', amount: 10100, percent: (10100 / 10101) * 100 },
    { id: 'transport', amount: 1, percent: (1 / 10101) * 100 },
  ])
  assert.equal(formatPercent(expense[1].percent), '<1%')
  assert.deepEqual(categoryBreakdown(rows, 'income'), [
    { id: 'salary', amount: 300000, percent: (300000 / 350000) * 100 },
    { id: 'bonus', amount: 50000, percent: (50000 / 350000) * 100 },
  ])
  assert.deepEqual(categoryBreakdown([], 'expense'), [])
  assert.deepEqual(rows, original)
})

// 六个月序列要涵盖跨年、缺失月份、收支隔离以及月初的包含与排除边界。
test('六个月趋势按本地月份统计并保留零值', () => {
  // 以一月为终点，覆盖八月起点到二月终点之间的完整半开区间。
  const month = new Date(2027, 0, 25)
  const monthTime = month.getTime()
  const base = { id: '1', categoryId: 'food', note: '', createdAt: 0, updatedAt: 0 }
  const rows: Transaction[] = [
    { ...base, type: 'expense', amountCents: 1, occurredAt: new Date(2026, 7, 1).getTime() - 1 },
    { ...base, id: '2', type: 'expense', amountCents: 101, occurredAt: new Date(2026, 7, 1).getTime() },
    { ...base, id: '3', type: 'expense', amountCents: 202, occurredAt: new Date(2026, 11, 1).getTime() - 1 },
    { ...base, id: '4', type: 'expense', amountCents: 303, occurredAt: new Date(2027, 0, 1).getTime() - 1 },
    { ...base, id: '5', type: 'expense', amountCents: 404, occurredAt: new Date(2027, 0, 1).getTime() },
    { ...base, id: '6', type: 'expense', amountCents: 505, occurredAt: new Date(2027, 1, 1).getTime() },
    { ...base, id: '7', type: 'income', categoryId: 'salary', amountCents: 100001, occurredAt: new Date(2027, 0, 1).getTime() },
  ]
  // 在不同资金方向上使用同一输入，统计不得更改原账目或传入月份。
  const original = structuredClone(rows)
  const expense = monthlyTrend(rows, month, 'expense')
  assert.deepEqual(expense.map((item) => [item.month.getFullYear(), item.month.getMonth(), item.month.getDate()]), [
    [2026, 7, 1], [2026, 8, 1], [2026, 9, 1], [2026, 10, 1], [2026, 11, 1], [2027, 0, 1],
  ])
  assert.deepEqual(expense.map((item) => item.amount), [101, 0, 0, 202, 303, 404])
  assert.deepEqual(monthlyTrend(rows, month, 'income').map((item) => item.amount), [0, 0, 0, 0, 0, 100001])
  assert.deepEqual(monthlyTrend([], month, 'expense').map((item) => item.amount), [0, 0, 0, 0, 0, 0])
  assert.deepEqual(rows, original)
  assert.equal(month.getTime(), monthTime)
})

// 百分比文案保留非零信息，并去掉没有意义的小数零。
test('百分比文案让小额可见且最多显示一位小数', () => {
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(0.001), '<1%')
  assert.equal(formatPercent(0.999), '<1%')
  assert.equal(formatPercent(1), '1%')
  assert.equal(formatPercent(12.34), '12.3%')
  assert.equal(formatPercent(12.36), '12.4%')
  assert.equal(formatPercent(100), '100%')
})

// 月份选择只允许完整且有效的四位年月，防止宽松解析把输入变成别的月份。
test('月份输入严格校验并返回本地月初', () => {
  // 上下界和普通年月都归一到本地一日零点。
  for (const [input, year, month] of [['1000-01', 1000, 0], ['2026-10', 2026, 9], ['9999-12', 9999, 11]] as const) {
    const parsed = parseMonthInput(input)
    assert.ok(parsed)
    assert.equal(parsed.getFullYear(), year)
    assert.equal(parsed.getMonth(), month)
    assert.equal(parsed.getDate(), 1)
    assert.equal(parsed.getHours(), 0)
  }
  // 拒绝空值、短年份、五位年份、越界月份、未补零和带日期或空格的输入。
  for (const input of ['', '0999-12', '10000-01', '2026-00', '2026-13', '2026-1', '2026-10-01', ' 2026-10', '2026-10 ']) {
    assert.equal(parseMonthInput(input), null)
  }
})

// 共享日期弹层必须拒绝会自动进位的月底和闰日，编辑未改日期时保留原始时刻。
test('日期选择校验真实日历日期并保留编辑记录的时分秒', () => {
  // 合法闰日与月份范围两端都保持本地日期，不经过 UTC 字符串解析。
  for (const value of ['1000-01-01', '2024-02-29', '2026-04-30', '9999-12-31']) {
    const date = parseDateInput(value)
    assert.ok(date)
    assert.equal(formatDateInput(date.getTime()), value)
  }
  // 小月、非闰年和未补零输入不能被静默转换为另一天。
  for (const value of ['', '2025-02-29', '2026-04-31', '2026-01-00', '2026-13-01', '2026-2-01', '2026-02-1', '2026-02-28T00:00:00']) {
    assert.equal(parseDateInput(value), null)
  }
  // 只改备注等字段时，确认同一天仍保留记录原有的时分秒和毫秒。
  const previous = new Date(2024, 1, 29, 19, 27, 43, 321).getTime()
  assert.equal(dateInputToTimestamp('2024-02-29', previous), previous)
  assert.equal(dateInputToTimestamp(formatDateInput(0), 0), 0)
})

// 旧设置缺字段或时间损坏时给出中文提示，合法的零值与 Date 上界仍能显示。
test('导出时间区分缺失、异常和有效本地时间', () => {
  assert.equal(formatLastExportTime(undefined), '暂无导出记录')
  assert.equal(formatLastExportTime(null), '暂无导出记录')
  for (const value of [NaN, Infinity, -Infinity, -1, 1.5, 8640000000000001, '', '123', true, {}]) {
    assert.equal(formatLastExportTime(value), '时间记录异常，请重新导出备份')
  }
  assert.equal(formatLastExportTime(new Date(2026, 9, 31, 13, 5).getTime()), '2026-10-31 13:05')
  assert.match(formatLastExportTime(0), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.doesNotMatch(formatLastExportTime(8640000000000000), /NaN|Invalid Date|异常/)
})

// 搜索必须跨月、包含起止整天、组合所有条件，并保留停用分类和原数组顺序。
test('跨月搜索组合备注、分类、收支、金额和本地日期边界', () => {
  const base = { type: 'expense' as const, categoryId: 'expense-food', amountCents: 1200, createdAt: 1, updatedAt: 1 }
  const rows: Transaction[] = [
    { ...base, id: 'a', note: '早餐 Coffee', occurredAt: new Date(2026, 8, 30, 23, 59, 59, 999).getTime() },
    { ...base, id: 'b', note: '午餐', amountCents: 2000, occurredAt: new Date(2026, 9, 1).getTime() },
    { ...base, id: 'c', type: 'income', categoryId: 'income-salary', note: '工资', occurredAt: new Date(2026, 9, 1).getTime() },
    { ...base, id: 'd', note: '午餐', occurredAt: new Date(2026, 9, 2).getTime() },
  ]
  const original = structuredClone(rows)
  const filter: TransactionFilter = { query: '', type: 'all', categoryId: '', minCents: null, maxCents: null, startDate: '', endDate: '' }
  const categories = DEFAULT_CATEGORIES.map((category) => ({ ...category, active: false }))
  assert.deepEqual(filterTransactions(rows, categories, { ...filter, query: ' COFFEE ' }).map((item) => item.id), ['a'])
  assert.deepEqual(filterTransactions(rows, categories, { ...filter, query: '餐饮', type: 'expense', minCents: 1200, maxCents: 2000, startDate: '2026-09-30', endDate: '2026-10-01' }).map((item) => item.id), ['b', 'a'])
  assert.deepEqual(filterTransactions(rows, categories, { ...filter, categoryId: 'income-salary' }).map((item) => item.id), ['c'])
  assert.deepEqual(filterTransactions(rows, categories, { ...filter, query: '午餐', maxCents: 1200 }).map((item) => item.id), ['d'])
  assert.deepEqual(filterTransactions(rows, categories, { ...filter, startDate: '2026-02-30' }), [])
  assert.deepEqual(rows, original)
  assert.equal(toCents('0.00', true), 0)
  assert.equal(toCents('-1', true), null)
  assert.equal(toCents('9007199254740992', true), null)
})

// 复制是新草稿，不能带走原主键、原日期或失效的分类选择。
test('再记一笔保留业务内容但使用今天和有效分类', () => {
  const item: Transaction = { id: 'original', type: 'expense', amountCents: 1234, categoryId: 'expense-food', note: '午餐', occurredAt: 1, createdAt: 1, updatedAt: 1 }
  const now = new Date(2026, 9, 30, 13, 20).getTime()
  const draft = copyEntryDraft(item, DEFAULT_CATEGORIES, now)
  assert.deepEqual(draft, { type: 'expense', amountCents: 1234, categoryId: 'expense-food', note: '午餐', occurredAt: now })
  assert.equal(copyEntryDraft(item, DEFAULT_CATEGORIES.map((category) => ({ ...category, active: false })), now).categoryId, '')
  assert.equal(item.occurredAt, 1)
  assert.equal(item.id, 'original')
})

// 历史预算不随未来设置改变，空配置可以从某月起显式停用沿用的预算。
test('预算按月沿用最近配置并隔离收入与不同分类', () => {
  const first: MonthlyBudget = { month: '2026-09', totalCents: 2000, categoryLimits: [{ categoryId: 'expense-food', amountCents: 1000 }] }
  const second: MonthlyBudget = { month: '2026-11', totalCents: 3000, categoryLimits: [] }
  const disabled: MonthlyBudget = { month: '2026-12', totalCents: null, categoryLimits: [] }
  const budgets = [second, disabled, first]
  assert.equal(budgetForMonth(budgets, new Date(2026, 7, 1)), undefined)
  assert.equal(budgetForMonth(budgets, new Date(2026, 9, 1)), first)
  assert.equal(budgetForMonth(budgets, new Date(2026, 10, 1)), second)
  assert.equal(budgetForMonth(budgets, new Date(2027, 0, 1)), disabled)
  const base = { id: 'a', note: '', occurredAt: 1, createdAt: 1, updatedAt: 1 }
  assert.deepEqual(budgetProgress(first, [
    { ...base, type: 'expense', categoryId: 'expense-food', amountCents: 1500 },
    { ...base, id: 'b', type: 'expense', categoryId: 'expense-other', amountCents: 1000 },
    { ...base, id: 'c', type: 'income', categoryId: 'income-salary', amountCents: 100000 },
  ]), { expense: 2500, remaining: -500, categories: [{ categoryId: 'expense-food', amountCents: 1000, spent: 1500, remaining: -500 }] })
  assert.equal(budgetProgress(disabled, []).remaining, null)
})

// 提醒只针对有数据的设备，准确覆盖首次导出、七天边界、开关和时钟回拨。
test('备份提醒遵守七天间隔与用户开关', () => {
  const now = Date.UTC(2026, 9, 30)
  const week = 7 * 24 * 60 * 60 * 1000
  assert.equal(needsBackupReminder(DEFAULT_SETTINGS, false, now), false)
  assert.equal(needsBackupReminder(DEFAULT_SETTINGS, true, now), true)
  assert.equal(needsBackupReminder({ ...DEFAULT_SETTINGS, lastExportedAt: now - week + 1 }, true, now), false)
  assert.equal(needsBackupReminder({ ...DEFAULT_SETTINGS, lastExportedAt: now - week }, true, now), true)
  assert.equal(needsBackupReminder({ ...DEFAULT_SETTINGS, backupReminderEnabled: false }, true, now), false)
  assert.equal(needsBackupReminder({ ...DEFAULT_SETTINGS, lastExportedAt: now + 1 }, true, now), false)
})
