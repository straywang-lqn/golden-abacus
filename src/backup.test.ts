import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_BACKUP_BYTES, parseBackup, serializeBackup, type BackupData } from './backup.ts'
import { DEFAULT_SETTINGS } from './domain.ts'

// 最小但完整的合法备份，后续用对象展开只破坏待验证的单项约束。
const backup: BackupData = {
  formatVersion: 2,
  exportedAt: '2026-09-09T00:00:00.000Z',
  transactions: [{
    id: 'transaction-1',
    type: 'expense',
    amountCents: 1200,
    categoryId: 'expense-food',
    note: '午餐',
    occurredAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }],
  categories: [{
    id: 'expense-food',
    type: 'expense',
    name: '餐饮',
    icon: '🍜',
    order: 0,
    active: true,
  }],
  settings: { ...DEFAULT_SETTINGS, seenStorageNotice: true },
}

// 重复主键会被 IndexedDB 静默覆盖，因此和未知格式版本一起作为回归重点。
test('备份校验接受完整数据并拒绝会静默覆盖的数据', () => {
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup)
  assert.throws(
    () => parseBackup(JSON.stringify({ ...backup, transactions: [...backup.transactions, backup.transactions[0]] })),
    /重复的数据编号/,
  )
  assert.throws(
    () => parseBackup(JSON.stringify({ ...backup, formatVersion: 3 })),
    /不支持此备份文件版本/,
  )
})

// 旧 JSON 仍可恢复，升级只补齐设置，不改变历史主键、金额或分类。
test('v1 备份升级设置且保留全部既有数据', () => {
  const legacy = { ...backup, formatVersion: 1, settings: { currency: 'CNY', theme: 'dark', seenStorageNotice: true } }
  const parsed = parseBackup(JSON.stringify(legacy))
  assert.deepEqual(parsed, { ...backup, settings: { ...DEFAULT_SETTINGS, theme: 'dark', seenStorageNotice: true } })
})

// 新预算同样属于导入信任边界，必须拒绝非法金额、重复配置与无效外键。
test('v2 备份校验预算结构、月份、金额和分类引用', () => {
  const budget = { month: '2026-10', totalCents: 100000, categoryLimits: [{ categoryId: 'expense-food', amountCents: 20000 }] }
  const valid = { ...backup, settings: { ...backup.settings, budgets: [budget], lastExportedAt: 123 } }
  assert.deepEqual(parseBackup(JSON.stringify(valid)), valid)
  // 每份坏数据只破坏一个约束，避免因更早失败而漏测对应校验。
  const invalidBudgets = [
    [{ ...budget, month: '2026-13' }],
    [{ ...budget, totalCents: 1.5 }],
    [{ ...budget, totalCents: 0 }],
    [{ ...budget, totalCents: Number.MAX_SAFE_INTEGER + 1 }],
    [budget, budget],
    [{ ...budget, categoryLimits: [...budget.categoryLimits, ...budget.categoryLimits] }],
    [{ ...budget, categoryLimits: [{ categoryId: 'missing', amountCents: 100 }] }],
    [{ ...budget, categoryLimits: [{ categoryId: 'expense-food', amountCents: -1 }] }],
  ]
  for (const budgets of invalidBudgets) {
    assert.throws(() => parseBackup(JSON.stringify({ ...valid, settings: { ...valid.settings, budgets } })), /设置数据无效|无效的支出分类/)
  }
  for (const lastExportedAt of [-1, '123', 8640000000000001]) {
    assert.throws(() => parseBackup(JSON.stringify({ ...valid, settings: { ...valid.settings, lastExportedAt } })), /设置数据无效/)
  }
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, transactions: [{ ...backup.transactions[0], categoryId: 'missing' }] })), /不存在的分类/)
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, categories: [{ ...backup.categories[0], type: 'income' }] })), /无效的支出分类/)
})

// UTF-8 字节数而非字符数决定恢复上限，导出必须提前拒绝同样的超限数据。
test('导出备份可原样恢复，超限中文内容不能生成成功备份', () => {
  assert.deepEqual(parseBackup(serializeBackup(backup)), backup)
  assert.throws(() => serializeBackup({ ...backup, transactions: [{ ...backup.transactions[0], note: '餐'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3)) }] }), /超过 10 MB/)
})
