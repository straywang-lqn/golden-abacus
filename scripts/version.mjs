import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 版本规则同时供 CI 与本地 APK 构建使用，产品版本只读取 Android 配置。
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 读取当前项目的字面量版本声明；拒绝缺失、非整数或无法精确比较的版本。 */
export function readAndroidVersion(source) {
  // 只接受独占一行的声明，避免把注释或动态 Gradle 表达式误当作版本。
  const versionCode = Number(source.match(/^\s*versionCode\s+(\d+)\s*$/m)?.[1])
  const versionName = source.match(/^\s*versionName\s+"(\d+\.\d+\.\d+)"\s*$/m)?.[1]
  assert.ok(Number.isSafeInteger(versionCode) && versionCode > 0 && versionCode <= 2147483647, 'versionCode 必须是正的 Android 整数')
  assert.ok(versionName && versionName.split('.').every((part) => /^(0|[1-9]\d*)$/.test(part) && Number.isSafeInteger(Number(part))), 'versionName 必须是三段非负整数版本号')
  return { versionCode, versionName }
}

/** 普通 PR 可以保持版本不变；发生升级时，安装序号和产品版本必须同时增加。 */
export function assertVersionProgression(current, previous) {
  // 安装序号相同只允许完全相同的产品版本，避免换名称复用旧升级序号。
  if (current.versionCode === previous.versionCode) {
    assert.equal(current.versionName, previous.versionName, '修改 versionName 时必须递增 versionCode')
    return false
  }
  assert.ok(current.versionCode > previous.versionCode, 'versionCode 必须高于已发布版本')
  // 逐段比较整数，保证 1.10.0 高于 1.9.0，而不是进行字符串排序。
  const currentParts = current.versionName.split('.').map(Number)
  const previousParts = previous.versionName.split('.').map(Number)
  const difference = currentParts.findIndex((part, index) => part !== previousParts[index])
  assert.ok(difference >= 0 && currentParts[difference] > previousParts[difference], 'versionName 必须高于已发布版本')
  return true
}

/** 合并历史交付基线、正式版本标签与本机已有 APK，防止回退或复用升级序号。 */
export function getReleaseBaseline(root = projectRoot) {
  // 旧包无法可靠追溯源码，仅保留已确认的交付版本下限，不补造历史标签。
  const baseline = JSON.parse(readFileSync(join(root, 'release-baseline.json'), 'utf8'))
  const versions = [readAndroidVersion(`versionCode ${baseline.versionCode}\nversionName "${baseline.versionName}"`)]
  // shortcut: 本地只读取已获取的标签，发布前必须 git fetch origin --tags；CI 始终获取完整历史。
  const tags = execFileSync('git', ['tag', '--list', 'v[0-9]*'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  for (const tag of tags.filter((name) => /^v\d+\.\d+\.\d+$/.test(name))) {
    const version = readAndroidVersion(execFileSync('git', ['show', `${tag}:android/app/build.gradle`], { cwd: root, encoding: 'utf8' }))
    assert.equal(tag, `v${version.versionName}`, `标签 ${tag} 与 Android 版本不一致`)
    versions.push(version)
  }
  // 已构建但尚未打标签的本机包也占用版本号；现有产物始终禁止覆盖。
  const releaseRoot = join(root, 'releases')
  for (const filename of existsSync(releaseRoot) ? readdirSync(releaseRoot) : []) {
    const match = filename.match(/^golden-abacus-(\d+\.\d+\.\d+)-vc(\d+)-debug\.apk$/)
    if (match) versions.push(readAndroidVersion(`versionCode ${match[2]}\nversionName "${match[1]}"`))
  }
  // 先按安装序号排序，再验证产品版本递增，拒绝互相矛盾的发布记录。
  versions.sort((a, b) => a.versionCode - b.versionCode)
  versions.reduce((previous, current) => {
    assertVersionProgression(current, previous)
    return current
  })
  return versions.at(-1)
}

// 直接执行时运行轻量版本检查；被构建脚本或测试导入时不产生副作用。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = readAndroidVersion(readFileSync(join(projectRoot, 'android/app/build.gradle'), 'utf8'))
  assertVersionProgression(current, getReleaseBaseline())
  console.log(`Android 产品版本校验通过：${current.versionName} (versionCode ${current.versionCode})`)
}
