import { MAX_BACKUP_BYTES } from './backup.ts'
import { decodeBillCsv, parseCsv, type BillCell } from './bills.ts'

/** 在 XLSX 解压前限制 ZIP 目录声明的总展开体积，拒绝加密及 ZIP64 文件。 */
export function checkXlsxSize(buffer: ArrayBuffer): void {
  const view = new DataView(buffer)
  let end = buffer.byteLength - 22
  while (end >= Math.max(0, buffer.byteLength - 65557) && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('XLSX 文件损坏，请重新导出')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  let expanded = 0
  if (count > 1000) throw new Error('XLSX 内容过多，请缩短账单时间范围')
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('XLSX 文件目录无效')
    expanded += view.getUint32(offset + 24, true)
    if (expanded > 50 * 1024 * 1024 || (view.getUint16(offset + 8, true) & 1)) throw new Error('XLSX 解压内容过大或已加密，请使用解压后的原始账单')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
}

/** 按需加载 XLSX 读取器，所有解码和解析均在设备本地完成。 */
export async function readBillFile(file: File): Promise<BillCell[][]> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('账单文件不能超过 10 MB')
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('请选择 CSV 或 XLSX 文件；ZIP 压缩包请先解压，暂不支持 XLS 和 PDF')
  const buffer = await file.arrayBuffer()
  if (/\.csv$/i.test(file.name)) return parseCsv(decodeBillCsv(buffer))
  checkXlsxSize(buffer)
  try {
    const { readSheet } = await import('read-excel-file/browser')
    // 金额与长交易单号保留原始数字文本，避免经过浮点数而丢失精度。
    // 上游类型将日期写为 DateConstructor，实际返回 Date 实例，边界统一收窄。
    const rows = await readSheet(buffer, { parseNumber: (value) => value })
    return rows.map((row) => row.map((cell): BillCell => {
      if (cell === null || cell instanceof Date || ['string', 'number', 'boolean'].includes(typeof cell)) return cell as BillCell
      throw new Error('账单单元格类型无效')
    }))
  } catch {
    throw new Error('XLSX 无法读取，请选择未经编辑、未加密的原始账单文件')
  }
}
