import assert from 'node:assert/strict'
import test from 'node:test'
import { aiMessages, answerAi, parseAiCommand } from './ai.ts'
import { DEFAULT_CATEGORIES, formatDateInput } from './domain.ts'

// 验证草稿边界，不允许非法金额、日期或模型指定写入操作。
test('AI 草稿校验金额、日期与分类', () => {
  const entry = { kind: 'entry', type: 'expense', amount: '35.01', categoryId: 'expense-food', date: '2024-02-29', note: '午饭' }
  const parse = (value: unknown) => parseAiCommand(JSON.stringify(value), DEFAULT_CATEGORIES)
  const result = parse(entry)
  assert.equal(result.kind, 'entry')
  assert.equal(result.draft.amountCents, 3501)
  assert.equal(formatDateInput(result.draft.occurredAt), '2024-02-29')
  assert.throws(() => parse({ ...entry, amount: '35.001' }))
  assert.throws(() => parse({ ...entry, date: '2025-02-29' }))
  assert.throws(() => parse([entry, entry]))
  assert.throws(() => parse({ kind: 'delete' }))
  const mismatch = parse({ ...entry, categoryId: 'income-salary' })
  assert.equal(mismatch.kind === 'entry' && mismatch.draft.categoryId, '')
})

// 查询结果取自本机账本，模型请求只携带允许的字段。
test('本机预算计算与请求数据边界', () => {
  const now = new Date(2024, 1, 29).getTime()
  const messages = aiMessages('本月预算', DEFAULT_CATEGORIES, new Date(now), now)
  assert.deepEqual(Object.keys(JSON.parse(messages[1].content)), ['input', 'today', 'viewedMonth', 'categories'])
  const transactions = [{ id: '1', type: 'expense' as const, amountCents: 3501, categoryId: 'expense-food', note: '本机备注', occurredAt: now, createdAt: now, updatedAt: now }]
  const answer = answerAi({ kind: 'budget', month: '2024-02' }, transactions, DEFAULT_CATEGORIES, [{ month: '2024-01', totalCents: 10000, categoryLimits: [] }])
  assert.match(answer.lines.join(' '), /64\.99/)
  assert.equal(answer.details[0].filter.endDate, '2024-02-29')
})
