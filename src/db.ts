import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Category,
  type Transaction,
} from './domain'
import { BACKUP_FORMAT_VERSION, type BackupData } from './backup'

// 这两个值共同定义现有用户数据的身份。仅在追加真实迁移时递增 DB_VERSION。
const DB_NAME = 'golden-abacus'
const DB_VERSION = 2

// 所有调用方共享一次打开操作，避免重复连接和并发升级。
let databasePromise: Promise<IDBDatabase> | undefined

/** 在 IndexedDB 自带的升级事务中按版本顺序建立或迁移结构。 */
function migrateDatabase(db: IDBDatabase, oldVersion: number, transaction: IDBTransaction) {
  // Keep shipped migrations unchanged; append a guard and bump DB_VERSION for each schema change.
  if (oldVersion < 1) {
    const transactions = db.createObjectStore('transactions', { keyPath: 'id' })
    transactions.createIndex('occurredAt', 'occurredAt')
    db.createObjectStore('categories', { keyPath: 'id' })
    db.createObjectStore('settings', { keyPath: 'key' })
  }
  // 为既有设置追加预算和导出状态，所有写入仍属于原生升级事务。
  if (oldVersion < 2) {
    const settings = transaction.objectStore('settings')
    const request = settings.get('app')
    request.onsuccess = () => {
      // 全新数据库尚无单例设置，交给 initializeDatabase 写入；升级不动原账目。
      if (request.result) settings.put({ key: 'app', value: {
        ...request.result.value,
        budgets: [],
        lastExportedAt: null,
        backupReminderEnabled: true,
      } })
    }
  }
}

/** 把单个 IDBRequest 的事件式结果转换成 Promise。 */
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 等待整个事务提交；错误或主动中止都向调用方抛出。 */
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/** 打开数据库，并在其他标签页触发版本升级时主动释放旧连接。 */
export function openDatabase(): Promise<IDBDatabase> {
  // 复用进行中或已完成的连接，避免每次读取都打开一个数据库句柄。
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    // 所有结构变更只能在浏览器提供的升级事务里执行。
    request.onupgradeneeded = (event) => migrateDatabase(request.result, event.oldVersion, request.transaction!)
    request.onsuccess = () => {
      // 其他标签页升级时释放连接，避免阻塞其版本迁移。
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

/** 仅为空存储写入首次启动默认值，不覆盖已有用户数据。 */
export async function initializeDatabase(): Promise<void> {
  const db = await openDatabase()
  const categoryCount = await result(db.transaction('categories').objectStore('categories').count())
  // 只在全新或被清空的分类库中写入默认值，已有自定义分类绝不覆盖。
  if (categoryCount === 0) await saveCategories(DEFAULT_CATEGORIES)
  const settings = await result(db.transaction('settings').objectStore('settings').get('app'))
  if (!settings) await saveSettings(DEFAULT_SETTINGS)
}

/** 读取全部分类，先按收支类型、再按用户顺序排列。 */
export async function getCategories(): Promise<Category[]> {
  const db = await openDatabase()
  const categories = await result<Category[]>(db.transaction('categories').objectStore('categories').getAll())
  return categories.sort((a, b) => a.type.localeCompare(b.type) || a.order - b.order)
}

/** 在同一事务内新增或更新一组分类。 */
export async function saveCategories(categories: Category[]): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction('categories', 'readwrite')
  for (const category of categories) transaction.objectStore('categories').put(category)
  await complete(transaction)
}

/** 读取单例设置；旧数据库缺失该记录时返回默认值副本。 */
export async function getSettings(): Promise<AppSettings> {
  const db = await openDatabase()
  const value = await result<{ key: string; value: AppSettings } | undefined>(
    db.transaction('settings').objectStore('settings').get('app'),
  )
  return value?.value ?? { ...DEFAULT_SETTINGS }
}

/** 保存单例应用设置。 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction('settings', 'readwrite')
  // 预算包含嵌套响应式数组，逐层构造普通对象，避免 IndexedDB 克隆 Vue 代理失败。
  transaction.objectStore('settings').put({ key: 'app', value: {
    ...settings,
    budgets: settings.budgets.map((budget) => ({ ...budget, categoryLimits: budget.categoryLimits.map((limit) => ({ ...limit })) })),
  } })
  await complete(transaction)
}

/** 按 occurredAt 索引读取半开时间区间 `[start, end)` 内的账目。 */
export async function getTransactionsBetween(start: number, end: number): Promise<Transaction[]> {
  const db = await openDatabase()
  const index = db.transaction('transactions').objectStore('transactions').index('occurredAt')
  // 下界包含、上界排除，使相邻月份查询不会重复月初账目。
  return result<Transaction[]>(index.getAll(IDBKeyRange.bound(start, end, false, true)))
}

/** 搜索按需读取全部账目；首页不为跨月搜索额外加载历史数据。 */
export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await openDatabase()
  return result<Transaction[]>(db.transaction('transactions').objectStore('transactions').getAll())
}

/** 仅检查是否存在账目，供备份提醒使用，不把全部历史载入内存。 */
export async function hasTransactions(): Promise<boolean> {
  const db = await openDatabase()
  return (await result(db.transaction('transactions').objectStore('transactions').count())) > 0
}

/** 按主键新增或覆盖一笔账目。调用方必须传入可结构化克隆的普通对象。 */
export async function saveTransaction(item: Transaction): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction('transactions', 'readwrite')
  transaction.objectStore('transactions').put(item)
  await complete(transaction)
}

/** 按稳定主键删除一笔账目。 */
export async function removeTransaction(id: string): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction('transactions', 'readwrite')
  transaction.objectStore('transactions').delete(id)
  await complete(transaction)
}

/** 在一个只读事务中取得一致的数据快照，供导出文件使用。 */
export async function createBackup(): Promise<BackupData> {
  const db = await openDatabase()
  // 三个读取共享一个只读事务，导出时看到的是同一时刻的数据快照。
  const transaction = db.transaction(['transactions', 'categories', 'settings'])
  const transactions = result<Transaction[]>(transaction.objectStore('transactions').getAll())
  const categories = result<Category[]>(transaction.objectStore('categories').getAll())
  const settings = result<{ key: string; value: AppSettings } | undefined>(
    transaction.objectStore('settings').get('app'),
  )
  // 同时等待请求和事务完成；事务失败不能返回看似完整的半份备份。
  const [savedTransactions, savedCategories, savedSettings] = await Promise.all([
    transactions,
    categories,
    settings,
    complete(transaction),
  ])
  if (!savedSettings) throw new Error('本地设置数据不存在')
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: savedTransactions,
    categories: savedCategories,
    settings: savedSettings.value,
  }
}

/**
 * 用已通过 parseBackup 校验的内容原子替换三个存储。
 * clear 与 put 共用一个事务，因此任一写入失败都会整体回滚。
 */
export async function restoreBackup(backup: BackupData): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction(['transactions', 'categories', 'settings'], 'readwrite')
  // 先保存完成信号，之后即使中途 throw 也能把事务错误传回调用方。
  const finished = complete(transaction)
  const transactions = transaction.objectStore('transactions')
  const categories = transaction.objectStore('categories')
  const settings = transaction.objectStore('settings')
  // 清空与全部 put 处于同一事务，任何 put 失败都会撤销此前 clear。
  transactions.clear()
  categories.clear()
  settings.clear()
  for (const item of backup.transactions) transactions.put(item)
  for (const category of backup.categories) categories.put(category)
  settings.put({ key: 'app', value: backup.settings })
  await finished
}

/** 原子清空用户数据，提交成功后重新写入默认分类和设置。 */
export async function clearAllData(): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction(['transactions', 'categories', 'settings'], 'readwrite')
  transaction.objectStore('transactions').clear()
  transaction.objectStore('categories').clear()
  transaction.objectStore('settings').clear()
  // 三个存储共同提交后，才重新初始化默认数据。
  await complete(transaction)
  await initializeDatabase()
}
