import assert from 'node:assert/strict'
import test from 'node:test'
import { monthBounds, summarize, toCents, type Transaction } from './domain.ts'

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
