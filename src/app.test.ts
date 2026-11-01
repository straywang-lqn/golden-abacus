import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { MAX_BACKUP_BYTES, serializeBackup } from './backup.ts'
import { DEFAULT_SETTINGS } from './domain.ts'

// 直接执行真实组件函数并替换外部 I/O，故障用例无需触碰用户的 IndexedDB。
const script = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
const source = ts.createSourceFile('App.ts', script, ts.ScriptTarget.Latest, true)
/** 通过语法树定位函数，避免测试复制实现或依赖源码行号。 */
function appFunction(name: string, context: Record<string, unknown>) {
  const declaration = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(declaration)
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  context.Error = Error
  return vm.runInNewContext(`${code}\n${name}`, context)
}

// 保存结果与刷新结果必须分开，写入失败仍允许修正重试。
test('保存成功后读取失败关闭表单，写入失败保留表单，忙碌时不重复写入', async () => {
  let writes = 0
  const context = {
    saving: { value: false }, entryError: { value: '' }, fatalError: { value: '' },
    editing: { value: null }, initialDraft: { value: null }, entryOpen: { value: true },
    categories: { value: [] }, crypto: { randomUUID: () => 'new-id' },
    saveTransaction: async () => { writes++ },
    refreshTransactions: async () => { throw new Error('read failed') },
    refreshSearch: async () => {}, formatMoney: String, notify: () => {},
  }
  const save = appFunction('saveEntry', context)
  await save({ amountCents: 100 })
  assert.equal(writes, 1)
  assert.equal(context.entryOpen.value, false)
  assert.equal(context.entryError.value, '')
  assert.match(context.fatalError.value, /已保存.*刷新失败/)
  context.entryOpen.value = true
  context.saveTransaction = async () => { throw new Error('write failed') }
  await save({ amountCents: 100 })
  assert.equal(context.entryOpen.value, true)
  assert.equal(context.entryError.value, 'write failed')
  context.saving.value = true
  context.entryError.value = ''
  await save({ amountCents: 100 })
  assert.equal(context.entryError.value, '')
})

// 超限不能调用分享、保存设置或给出成功提示，尤其不能抑制备份提醒。
test('超限导出保留原导出时间且不触发文件交付', async () => {
  let shared = false
  let saved = false
  let error = ''
  const context = {
    saving: { value: false }, settings: { value: { ...DEFAULT_SETTINGS } },
    createBackup: async () => ({ exportedAt: new Date().toISOString(), settings: { ...DEFAULT_SETTINGS }, transactions: [{ note: 'x'.repeat(MAX_BACKUP_BYTES) }] }),
    serializeBackup, formatDateInput: () => '2026-11-01',
    shareTextFile: async () => { shared = true; return true },
    saveSettings: async () => { saved = true }, notify: () => assert.fail('不应提示成功'),
    showFatalError: (value: Error) => { error = value.message },
  }
  await appFunction('exportBackup', context)()
  assert.equal(shared, false)
  assert.equal(saved, false)
  assert.equal(context.settings.value.lastExportedAt, null)
  assert.match(error, /超过 10 MB/)
  assert.equal(context.saving.value, false)
})
