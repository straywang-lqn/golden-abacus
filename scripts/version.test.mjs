import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertVersionProgression, getReleaseBaseline, readAndroidVersion } from './version.mjs'

// 基线代表已有安装，覆盖最容易导致无法升级或重复发版的版本组合。
const previous = { versionName: '1.3.0', versionCode: 5 }

test('Android 版本仅接受可精确比较的字面量', () => {
  assert.deepEqual(readAndroidVersion('    versionCode 6\n    versionName "1.3.1"'), { versionCode: 6, versionName: '1.3.1' })
  // 缺失声明、非法整数、前导零和注释中的伪声明都不能进入发布比较。
  for (const source of [
    'versionCode 0\nversionName "1.3.1"',
    'versionCode 2147483648\nversionName "1.3.1"',
    'versionCode 6\nversionName "01.3.1"',
    'versionCode 6\nversionName "1.3.9007199254740992"',
    '// versionCode 6\n// versionName "1.3.1"',
    'versionCode 6 + 1\nversionName "1.3.1"',
  ]) assert.throws(() => readAndroidVersion(source))
})

test('普通修改可以保持版本，发布必须同时递增名称和安装序号', () => {
  assert.equal(assertVersionProgression(previous, previous), false)
  assert.equal(assertVersionProgression({ versionName: '1.3.1', versionCode: 6 }, previous), true)
  assert.equal(assertVersionProgression({ versionName: '1.10.0', versionCode: 6 }, { versionName: '1.9.0', versionCode: 5 }), true)
  // 名称增加但序号复用、序号增加但名称回退，以及直接降级都必须失败。
  for (const current of [
    { versionName: '1.3.1', versionCode: 5 },
    { versionName: '1.3.0', versionCode: 6 },
    { versionName: '1.2.9', versionCode: 6 },
    { versionName: '1.4.0', versionCode: 4 },
  ]) assert.throws(() => assertVersionProgression(current, previous))
})

test('交付下限同时包含历史基线、标签与本机产物，并拒绝矛盾记录', () => {
  // 全部 Git 操作只发生在临时仓库，不触碰项目历史或用户配置。
  const root = mkdtempSync(join(tmpdir(), 'golden-abacus-version-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init')
    writeFileSync(join(root, 'release-baseline.json'), JSON.stringify(previous))
    assert.deepEqual(getReleaseBaseline(root), previous)
    // 标签必须读取其自身提交的 Gradle 版本，而不是使用当前工作区配置。
    mkdirSync(join(root, 'android/app'), { recursive: true })
    writeFileSync(join(root, 'android/app/build.gradle'), 'versionCode 6\nversionName "1.4.0"')
    git('add', '.')
    git('-c', 'user.name=Version Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    git('tag', 'v1.4.0')
    assert.deepEqual(getReleaseBaseline(root), { versionName: '1.4.0', versionCode: 6 })
    // 本机构建占用更高版本；伪造的倒退版本和名称不匹配的标签必须失败。
    mkdirSync(join(root, 'releases'))
    writeFileSync(join(root, 'releases/golden-abacus-1.4.1-vc7-debug.apk'), '')
    assert.deepEqual(getReleaseBaseline(root), { versionName: '1.4.1', versionCode: 7 })
    writeFileSync(join(root, 'releases/golden-abacus-1.2.0-vc8-debug.apk'), '')
    assert.throws(() => getReleaseBaseline(root), /versionName 必须高于/)
    rmSync(join(root, 'releases/golden-abacus-1.2.0-vc8-debug.apk'))
    git('tag', 'v1.5.0')
    assert.throws(() => getReleaseBaseline(root), /标签 v1.5.0 与 Android 版本不一致/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
