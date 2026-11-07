import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'

/** 设备配置独立于账本；浏览器持久化时必须排除 apiKey。 */
export type AiConfig = { enabled: boolean; baseUrl: string; model: string; apiKey: string }
/** 原生插件只保存一个加密配置，不提供通用文件或数据库访问。 */
const secure = registerPlugin<{ get(): Promise<{ value: string }>; set(options: { value: string }): Promise<void>; clear(): Promise<void> }>('AiSecureStorage')
/** 浏览器密钥只驻留本次页面运行。 */
let sessionKey = ''
/** 单独的设备配置键不会进入 JSON 备份。 */
const storageKey = 'golden-abacus-ai-config'
/** 未配置时禁止联网。 */
export const emptyAiConfig = (): AiConfig => ({ enabled: false, baseUrl: '', model: '', apiKey: '' })
/** 地址必须为 HTTPS，禁止凭据、查询参数和跳转携带密钥。 */
export function validateAiConfig(config: AiConfig): AiConfig {
  let url: URL
  try { url = new URL(config.baseUrl.trim()) } catch { throw new Error('请输入有效的 HTTPS API 基础地址') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须使用 HTTPS，且不能包含凭据或查询参数')
  if (!config.model.trim() || !config.apiKey.trim() || /[\r\n]/.test(config.apiKey)) throw new Error('请填写模型名和有效 API Key')
  return { enabled: config.enabled, baseUrl: url.href.replace(/\/+$/, ''), model: config.model.trim(), apiKey: config.apiKey.trim() }
}
/** 读取失败交给配置页处理，不影响账本启动。 */
export async function loadAiConfig(): Promise<AiConfig> {
  const text = Capacitor.isNativePlatform() ? (await secure.get()).value : localStorage.getItem(storageKey)
  if (!text) return emptyAiConfig()
  try {
    const value = JSON.parse(text)
    if (typeof value.enabled !== 'boolean' || typeof value.baseUrl !== 'string' || typeof value.model !== 'string') throw new Error()
    return { enabled: value.enabled, baseUrl: value.baseUrl, model: value.model, apiKey: Capacitor.isNativePlatform() ? String(value.apiKey ?? '') : sessionKey }
  } catch { throw new Error('AI 配置无法读取，请清除配置后重新填写') }
}
/** 写入成功才更新内存；浏览器磁盘上始终没有 Key。 */
export async function saveAiConfig(value: AiConfig): Promise<AiConfig> {
  const config = validateAiConfig(value)
  if (Capacitor.isNativePlatform()) await secure.set({ value: JSON.stringify(config) })
  else { localStorage.setItem(storageKey, JSON.stringify({ ...config, apiKey: undefined })); sessionKey = config.apiKey }
  return config
}
/** 清空账本和配置页都调用此入口。 */
export async function clearAiConfig(): Promise<void> {
  if (Capacitor.isNativePlatform()) await secure.clear()
  else localStorage.removeItem(storageKey)
  sessionKey = ''
}
/** 一次请求，不自动重试；响应及错误都不能回显服务端的敏感正文。 */
export async function requestAi(config: AiConfig, messages: { role: string; content: string }[], signal: AbortSignal): Promise<string> {
  const valid = validateAiConfig(config)
  if (signal.aborted) throw new Error('请求已取消')
  if (!valid.enabled) throw new Error('请先启用 AI 助手')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const timer = setTimeout(abort, 30000)
  try {
    const url = `${valid.baseUrl}/chat/completions`
    const headers = { Authorization: `Bearer ${valid.apiKey}`, 'Content-Type': 'application/json' }
    const data = { model: valid.model, messages, response_format: { type: 'json_object' }, stream: false, max_tokens: 1200 }
    let status: number
    let body: unknown
    if (Capacitor.isNativePlatform()) {
      const response = await Promise.race([
        CapacitorHttp.post({ url, headers, data, connectTimeout: 10000, readTimeout: 30000, disableRedirects: true }),
        new Promise<never>((_, reject) => { controller.signal.addEventListener('abort', () => reject(new Error('请求已取消或超时')), { once: true }); if (controller.signal.aborted) reject(new Error('请求已取消或超时')) }),
      ]).catch(() => { throw new Error('无法连接 AI 服务，请检查网络和地址') })
      status = response.status
      body = response.data
    } else {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data), signal: controller.signal, redirect: 'error', credentials: 'omit' })
      status = response.status
      // 先按状态处理失败，不解析可能包含敏感内容的错误正文。
      if (status === 200) {
        if (Number(response.headers.get('content-length')) > 64000) throw new Error('AI 响应过长')
        const text = await response.text()
        if (text.length > 64000) throw new Error('AI 响应过长')
        try { body = JSON.parse(text) } catch { throw new Error('服务未返回有效 JSON，请检查 API 地址') }
      }
    }
    if (controller.signal.aborted) throw new Error('请求已取消或超时')
    if (status !== 200) throw new Error(status === 401 || status === 403 ? 'API Key 无效或没有权限，请检查配置' : status === 429 ? '请求受限或额度不足，请稍后重试' : `AI 服务请求失败（${status}），请检查地址、模型和 JSON 输出支持`)
    const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim() || content.length > 16000) throw new Error('AI 返回为空或过长，请重试或更换模型')
    return content
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求已取消或超过 30 秒，请重试')
    if (error instanceof TypeError) throw new Error('无法连接 AI 服务；请检查网络，浏览器还需服务允许跨域')
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
