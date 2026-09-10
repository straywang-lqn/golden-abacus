import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBackup, type BackupData } from './backup.ts'

// 最小但完整的合法备份，后续用对象展开只破坏待验证的单项约束。
const backup: BackupData = {
  formatVersion: 1,
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
  settings: { currency: 'CNY', theme: 'system', seenStorageNotice: true },
}

// 重复主键会被 IndexedDB 静默覆盖，因此和未知格式版本一起作为回归重点。
test('备份校验接受完整数据并拒绝会静默覆盖的数据', () => {
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup)
  assert.throws(
    () => parseBackup(JSON.stringify({ ...backup, transactions: [...backup.transactions, backup.transactions[0]] })),
    /重复的数据编号/,
  )
  assert.throws(
    () => parseBackup(JSON.stringify({ ...backup, formatVersion: 2 })),
    /不支持此备份文件版本/,
  )
})
