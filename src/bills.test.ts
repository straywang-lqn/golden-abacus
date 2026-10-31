import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { readSheet } from 'read-excel-file/node'
import { checkXlsxSize } from './billFile.ts'
import { decodeBillCsv, parseBillRows, parseCsv, transactionsCsv, type BillCell } from './bills.ts'
import { DEFAULT_CATEGORIES, type Transaction } from './domain.ts'

// 使用虚构商户及单号覆盖真实文件列名，不含私人账目。
const wxHeader = ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注']
const aliHeader = ['交易时间', '交易分类', '交易对方', '对方账号', '商品说明', '收/支', '金额', '收/付款方式', '交易状态', '交易订单号', '商家订单号', '备注']
/** 生成一条可定向修改的微信明细，金额、单号都保留字符串。 */
function wxRow(changes: Record<number, BillCell> = {}): BillCell[] {
  const row: BillCell[] = ['2026-10-30 12:34:56', '商户消费', '测试商户', '午饭', '支出', '￥12.30', '零钱', '支付成功', '4200000000000000000000001', '/', '/']
  for (const [index, value] of Object.entries(changes)) row[Number(index)] = value
  return row
}

test('CSV 支持 BOM、CRLF、带逗号及换行的引号字段和双引号转义', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"商户,分店","第一行\n第二行"\r\n"含""引号",末尾'), [['a', 'b'], ['商户,分店', '第一行\n第二行'], ['含"引号', '末尾']])
  assert.throws(() => parseCsv('a,"未闭合'), /未闭合/)
  assert.throws(() => parseCsv('"a"bad,b'), /引号格式/)
})

test('CSV 严格处理 UTF-8 和 GBK 文件编码以及体积限制', () => {
  assert.equal(decodeBillCsv(new TextEncoder().encode('微信').buffer), '微信')
  assert.equal(decodeBillCsv(new Uint8Array([0xd6, 0xa7, 0xb8, 0xb6, 0xb1, 0xa6]).buffer), '支付宝')
  assert.throws(() => decodeBillCsv(new ArrayBuffer(10 * 1024 * 1024 + 1)), /10 MB/)
})

test('微信自动寻找表头，保留长单号、整数分和本地时分秒', () => {
  const preview = parseBillRows([['微信支付账单明细'], [], wxHeader, wxRow()], new Set(), 123)
  assert.equal(preview.source, 'wechat')
  assert.equal(preview.rows[0]!.line, 4)
  const entry = preview.rows[0]!.entry!
  assert.equal(entry.id, 'bill:wechat:4200000000000000000000001')
  assert.equal(entry.amountCents, 1230)
  assert.equal(entry.occurredAt, new Date(2026, 9, 30, 12, 34, 56).getTime())
  assert.equal(entry.createdAt, 123)
  assert.match(entry.note, /微信.*测试商户.*午饭/)
})

test('支付宝列名、前后说明和收入正确识别，跨平台单号不碰撞', () => {
  const row = ['2026-10-31 09:01:02', '其他', '测试单位', '/', '工资', '收入', '1234.56', '余额', '交易成功', '20260001', '/', '测试备注']
  const preview = parseBillRows([['支付宝交易记录明细查询'], aliHeader, row, ['----------------'], ['说明内容']], new Set(['bill:wechat:20260001']))
  assert.equal(preview.source, 'alipay')
  assert.equal(preview.rows.length, 1)
  assert.equal(preview.rows[0]!.entry!.type, 'income')
  assert.equal(preview.rows[0]!.entry!.amountCents, 123456)
})

test('同文件和已入库的重复单号均跳过，不覆盖编辑过的账目', () => {
  const data = [wxHeader, wxRow(), wxRow(), wxRow({ 8: 'existing' })]
  const rows = parseBillRows(data, new Set(['bill:wechat:existing'])).rows
  assert.equal(rows.filter((row) => row.entry).length, 1)
  assert.match(rows[1]!.reason, /文件内.*重复/)
  assert.match(rows[2]!.reason, /已导入/)
})

test('退款、部分退款、关闭、不计收支和未知状态均有明确跳过原因', () => {
  const rows = parseBillRows([wxHeader, wxRow({ 7: '已全额退款' }), wxRow({ 7: '已退款(部分)' }), wxRow({ 7: '交易关闭' }), wxRow({ 4: '不计收支' }), wxRow({ 7: '未知状态' })], new Set()).rows
  assert.equal(rows.every((row) => !row.entry && !!row.reason), true)
  assert.match(rows[0]!.reason, /退款/)
  assert.match(rows[2]!.reason, /未完成/)
})

test('拒绝无效金额、溢出金额、无效日期、缺失单号和科学计数单号', () => {
  const invalid: Record<number, BillCell>[] = [{ 5: '0' }, { 5: '-1' }, { 5: '1.001' }, { 5: '1e3' }, { 5: '900719925474099.99' }, { 0: '2026-02-30 12:00:00' }, { 0: '2026-10-31 24:00:00' }, { 8: '' }, { 8: '4.2E+24' }]
  for (const changes of invalid) {
    const row = parseBillRows([wxHeader, wxRow(changes)], new Set()).rows[0]!
    assert.equal(row.entry, null)
    assert.ok(row.reason)
  }
})

test('Excel 日期按 UTC 墙上时间分量还原到本地日历', () => {
  const row = parseBillRows([wxHeader, wxRow({ 0: new Date('2024-02-29T23:59:58Z') })], new Set()).rows[0]!
  assert.equal(row.entry!.occurredAt, new Date(2024, 1, 29, 23, 59, 58).getTime())
})

test('实际 XLSX 样本保留数字单号精度并还原 Excel 日期与金额', async () => {
  // 固定虚构样本覆盖 ZIP、XML、数字和日期读取链，避免只测试手工数组。
  const file = readFileSync(new URL('./fixtures/wechat.xlsx', import.meta.url))
  checkXlsxSize(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  const data = await readSheet(file, { parseNumber: (value) => value })
  const entry = parseBillRows(data as unknown as BillCell[][], new Set()).rows[0]!.entry!
  assert.equal(entry.id, 'bill:wechat:4200000000000000000000003')
  assert.equal(entry.amountCents, 999)
  assert.equal(entry.occurredAt, new Date(2026, 9, 30, 13, 14, 15).getTime())
})

test('拒绝未知、空白、重复表头和过多明细的文件', () => {
  assert.throws(() => parseBillRows([['普通表格']], new Set()), /未识别/)
  assert.throws(() => parseBillRows([wxHeader], new Set()), /没有明细/)
  assert.throws(() => parseBillRows([[...wxHeader, '交易时间']], new Set()), /重复列名/)
  assert.throws(() => parseBillRows(Array.from({ length: 20201 }, () => []), new Set()), /过大/)
})

test('XLSX 解压前拒绝非 ZIP、截断目录、加密及异常展开体积', () => {
  assert.throws(() => checkXlsxSize(new ArrayBuffer(5)), /损坏/)
  const buffer = new ArrayBuffer(68)
  const view = new DataView(buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint32(46, 0x06054b50, true)
  view.setUint16(56, 1, true)
  checkXlsxSize(buffer)
  view.setUint32(24, 51 * 1024 * 1024, true)
  assert.throws(() => checkXlsxSize(buffer), /过大/)
  view.setUint32(24, 0, true)
  view.setUint16(8, 1, true)
  assert.throws(() => checkXlsxSize(buffer), /加密/)
})

test('CSV 导出中文表头、分类、本地时间和两位小数，安全转义公式和换行', () => {
  const item: Transaction = { id: 'test', type: 'expense', categoryId: 'expense-food', amountCents: 1230, note: '=1+1,"备注"\n第二行', occurredAt: new Date(2026, 9, 31, 12, 3, 4).getTime(), createdAt: 1, updatedAt: 1 }
  const csv = transactionsCsv([item], DEFAULT_CATEGORIES)
  assert.ok(csv.startsWith('\uFEFF'))
  const rows = parseCsv(csv).filter((row) => row.some(Boolean))
  assert.deepEqual(rows[1], ['2026-10-31 12:03:04', '支出', '餐饮', '12.30', "'=1+1,\"备注\"\n第二行", 'test'])
  for (const note of ['+cmd', '-cmd', '@SUM(A1)', '\tcmd', '  =cmd']) assert.match(transactionsCsv([{ ...item, note }], DEFAULT_CATEGORIES), /"'/)
  assert.equal(parseCsv(transactionsCsv([], DEFAULT_CATEGORIES))[0]!.length, 6)
})
