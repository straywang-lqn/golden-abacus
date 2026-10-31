import { MAX_BACKUP_BYTES } from './backup.ts'
import { formatDateInput, parseDateInput, toCents, type Category, type Transaction } from './domain.ts'

/** 两个平台使用独立的主键命名空间，避免交易单号碰撞。 */
export type BillSource = 'wechat' | 'alipay'
/** XLSX 的数值保留原字符串，日期单元格由读取器解析为 Date。 */
export type BillCell = string | number | boolean | Date | null
/** 每条明细保留原行号；跳过原因和待导入内容互斥。 */
export type BillRow = { line: number; description: string; reason: string; entry: Omit<Transaction, 'categoryId'> | null }
/** 预览只保存在内存，确认之前不写入账本。 */
export type BillPreview = { source: BillSource; rows: BillRow[] }
/** 限制单次明细数量，保护移动设备的解析和预览内存。 */
const MAX_BILL_ROWS = 20000

/** 严格解码 UTF-8，旧版支付宝 CSV 回退 GB18030，拒绝损坏字节。 */
export function decodeBillCsv(buffer: ArrayBuffer): string {
  if (buffer.byteLength > MAX_BACKUP_BYTES) throw new Error('账单文件不能超过 10 MB')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try { return new TextDecoder('gb18030', { fatal: true }).decode(buffer) }
    catch { throw new Error('账单编码无法识别，请重新导出 UTF-8 或 GBK 格式的 CSV') }
  }
}

/** 解析引号、双引号转义和单元格内换行，不按逗号直接切开账单。 */
export function parseCsv(text: string): string[][] {
  if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error('账单文件不能超过 10 MB')
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  let closed = false
  // 文件末尾补一个行结束符，统一处理最后一行没有换行的文件。
  const input = text.replace(/^\uFEFF/, '') + '\n'
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { value += '"'; index++ }
      else if (char === '"') { quoted = false; closed = true }
      else value += char
    } else if (char === ',' || char === '\r' || char === '\n') {
      row.push(value)
      if (row.length > 100) throw new Error('账单列数过多，请选择原始账单文件')
      value = ''; closed = false
      if (char !== ',') {
        rows.push(row); row = []
        if (char === '\r' && input[index + 1] === '\n') index++
        if (rows.length > MAX_BILL_ROWS + 200) throw new Error('单次最多导入 20000 条，请缩短账单时间范围')
      }
    } else if (char === '"' && !value && !closed) quoted = true
    else {
      // 允许官方文件在闭引号后追加制表符或空格，拒绝歧义格式。
      if ((closed && char.trim()) || char === '"') throw new Error('CSV 引号格式有误，请选择未经编辑的账单文件')
      value += char
    }
    if (value.length > 10000) throw new Error('账单单元格内容过长')
  }
  if (quoted) throw new Error('CSV 引号未闭合，请重新导出账单')
  return rows
}

/** 严格按本地日历还原时间，禁止 Date 自动把 2 月 30 日滚到下个月。 */
function billTime(cell: BillCell | undefined): number | null {
  // Excel 日期表示墙上时间，读取器的 UTC 分量不应再做时区偏移。
  // 日期序列的浮点误差可能落在上一秒末尾，按账单的秒精度先四舍五入。
  const dateCell = cell instanceof Date ? new Date(Math.round(cell.getTime() / 1000) * 1000) : null
  const text = dateCell
    ? `${dateCell.getUTCFullYear()}-${String(dateCell.getUTCMonth() + 1).padStart(2, '0')}-${String(dateCell.getUTCDate()).padStart(2, '0')} ${String(dateCell.getUTCHours()).padStart(2, '0')}:${String(dateCell.getUTCMinutes()).padStart(2, '0')}:${String(dateCell.getUTCSeconds()).padStart(2, '0')}`
    : String(cell ?? '').trim()
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!match) return null
  const [, year, month, day, hour, minute, second = '00'] = match
  const date = parseDateInput(`${year}-${month}-${day}`)
  if (!date || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null
  date.setHours(Number(hour), Number(minute), Number(second), 0)
  return date.getHours() === Number(hour) ? date.getTime() : null
}

/** 从列名识别平台和字段，说明行数不固定，也不信任文件名。 */
export function parseBillRows(data: BillCell[][], existingIds: Set<string>, now = Date.now()): BillPreview {
  if (data.length > MAX_BILL_ROWS + 200 || data.some((row) => row.length > 100)) throw new Error('账单过大，单次最多导入 20000 条')
  if (data.some((row) => row.some((cell) => String(cell ?? '').length > 10000))) throw new Error('账单单元格内容过长')
  const headerIndex = data.findIndex((row) => row.some((cell) => String(cell).trim() === '收/支')
    && row.some((cell) => ['交易单号', '交易订单号'].includes(String(cell).trim())))
  if (headerIndex < 0) throw new Error('未识别到微信或支付宝账单表头，请选择用于个人对账的原始文件')
  const header = data[headerIndex]!.map((cell) => String(cell ?? '').trim().replace(/^\uFEFF/, ''))
  if (new Set(header.filter(Boolean)).size !== header.filter(Boolean).length) throw new Error('账单存在重复列名')
  const source: BillSource = header.includes('交易单号') ? 'wechat' : 'alipay'
  const fields = {
    time: ['交易时间', '交易创建时间'], direction: ['收/支'], amount: ['金额(元)', '金额（元）', '金额'],
    id: source === 'wechat' ? ['交易单号'] : ['交易订单号'], status: ['当前状态', '交易状态'],
    counterparty: ['交易对方'], product: ['商品', '商品说明', '商品名称'], kind: ['交易类型', '交易分类'], note: ['备注'],
  }
  const columns = Object.fromEntries(Object.entries(fields).map(([key, names]) => [key, header.findIndex((name) => names.includes(name))])) as Record<keyof typeof fields, number>
  if (Object.entries(columns).some(([key, index]) => key !== 'note' && index < 0)) throw new Error('账单缺少时间、金额、交易单号或状态等必要列')
  const seen = new Set<string>()
  const rows: BillRow[] = []
  for (let index = headerIndex + 1; index < data.length; index++) {
    const row = data[index]!
    if (row.every((cell) => !String(cell ?? '').trim())) continue
    // 官方页尾说明以单列分隔线起始；其后的汇总不属于账目明细。
    if (/^-{3,}/.test(String(row[0] ?? '').trim())) break
    const get = (key: keyof typeof fields) => String(row[columns[key]] ?? '').trim()
    const description = [get('counterparty'), get('product')].filter((text) => text && text !== '/').join(' · ')
    const result: BillRow = { line: index + 1, description, reason: '', entry: null }
    const direction = get('direction')
    const status = get('status')
    const kind = get('kind')
    // 退款关联尚无数据模型，连同未完成和不计收支项交给用户手动核对。
    if (/退款|退还|退回/.test(status + kind)) result.reason = '退款相关，请手动核对'
    else if (!['收入', '支出'].includes(direction)) result.reason = '不计收支或收支方向无法识别'
    else if (!['支付成功', '交易成功', '已收钱', '已到账', '对方已收钱', '已转账', '转账成功', '已存入零钱'].includes(status)) result.reason = `未完成或不支持的状态：${status || '空白'}`
    else {
      const orderId = get('id')
      const id = `bill:${source}:${orderId}`
      const amount = get('amount').replace(/^[¥￥]\s*/, '')
      const amountCents = toCents(amount)
      const occurredAt = billTime(row[columns.time])
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) result.reason = '交易单号缺失或无效'
      else if (amountCents === null) result.reason = '金额无效，须为正数且最多两位小数'
      else if (occurredAt === null) result.reason = '交易时间无效'
      else if (existingIds.has(id)) result.reason = '已导入，保留原账目'
      else if (seen.has(id)) result.reason = '文件内交易单号重复'
      else {
        seen.add(id)
        const note = [source === 'wechat' ? '微信' : '支付宝', kind, description, get('note')].filter((text) => text && text !== '/').join(' · ')
        result.entry = { id, type: direction === '收入' ? 'income' : 'expense', amountCents, note, occurredAt, createdAt: now, updatedAt: now }
      }
    }
    rows.push(result)
    if (rows.length > MAX_BILL_ROWS) throw new Error('单次最多导入 20000 条，请缩短账单时间范围')
  }
  if (!rows.length) throw new Error('账单中没有明细记录')
  return { source, rows }
}

/** 文本始终引用并防止公式注入；数值金额保持两位小数，UTF-8 BOM 兼容 Excel。 */
export function transactionsCsv(transactions: Transaction[], categories: Category[]): string {
  const names = new Map(categories.map((category) => [category.id, category.name]))
  const quote = (value: string) => `"${(/^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`
  const rows = [['日期', '收支', '分类', '金额(元)', '备注', '交易编号'].map(quote).join(',')]
  for (const item of [...transactions].sort((a, b) => b.occurredAt - a.occurredAt)) {
    const date = new Date(item.occurredAt)
    if (Number.isNaN(date.getTime())) throw new Error('存在无效的账目日期，无法导出表格')
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':')
    const amount = `${Math.floor(item.amountCents / 100)}.${String(item.amountCents % 100).padStart(2, '0')}`
    rows.push([`${formatDateInput(item.occurredAt)} ${time}`, item.type === 'income' ? '收入' : '支出', names.get(item.categoryId) ?? '未知分类', amount, item.note, item.id].map(quote).join(','))
  }
  return '\uFEFF' + rows.join('\r\n') + '\r\n'
}
