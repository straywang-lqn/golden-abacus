import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertVersionProgression, getReleaseBaseline, readAndroidVersion } from './version.mjs'

// 目录始终相对于脚本定位，调用者无需先切到项目根目录。
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const androidRoot = join(projectRoot, 'android')
// 在调用 Android 工具链前拒绝复用已交付或已构建版本，减少无效打包。
const currentVersion = readAndroidVersion(readFileSync(join(androidRoot, 'app', 'build.gradle'), 'utf8'))
assert.ok(assertVersionProgression(currentVersion, getReleaseBaseline()), '新 APK 必须同时递增 versionCode 和 versionName')
// 包名和证书共同标识现有安装，构建前后都不能改变。
const expectedAppId = 'com.goldenabacus.app'
const expectedSigner = '5c7ad0becc97ddd99acefdc14f07ec510e903c053d20330b5b81cca7938ad434'
// pnpm 可能是 JS 入口或独立原生程序；使用当前入口，避免依赖 CMD 或 Shell 转义。
const pnpmCli = process.env.npm_execpath
assert.ok(pnpmCli, '请通过 pnpm android:apk 启动构建')
// 只有脚本入口需要 Node，独立版 pnpm 应直接执行，不能作为 JavaScript 解析。
const pnpmIsScript = /\.(?:c|m)?js$/i.test(pnpmCli)
const pnpmCommand = pnpmIsScript ? process.execPath : pnpmCli
const pnpmArgs = pnpmIsScript ? [pnpmCli] : []

// 优先复用显式配置，macOS 使用已注册的 JDK 21，Windows 保留原有工具链位置。
let javaHome = process.env.JAVA_HOME
if (!javaHome && process.platform === 'darwin') {
  javaHome = execFileSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' }).trim()
}
if (!javaHome && process.platform === 'win32') {
  javaHome = join(process.env.LOCALAPPDATA ?? '', 'GoldenAbacus', 'jdk-21', 'jdk-21.0.12.1+1')
}
assert.ok(javaHome, '请配置指向 JDK 21 的 JAVA_HOME')
// 工具直接使用所选 JDK 的绝对路径，不依赖系统 PATH 中可能存在的其他 Java 版本。
const executableSuffix = process.platform === 'win32' ? '.exe' : ''
const java = join(javaHome, 'bin', `java${executableSuffix}`)
const keytool = join(javaHome, 'bin', `keytool${executableSuffix}`)
assert.ok(existsSync(join(javaHome, 'bin', `javac${executableSuffix}`)), `JDK 编译器缺失：${javaHome}`)

// 复用 Android Studio 写入的 SDK 路径，并解码 properties 中的 Unicode 和 Windows 路径转义。
const sdkProperty = readFileSync(join(androidRoot, 'local.properties'), 'utf8').match(/^\s*sdk\.dir\s*=(.*)$/m)?.[1]?.trim()
assert.ok(sdkProperty, 'android/local.properties 中缺少 sdk.dir')
const sdkRoot = sdkProperty.replace(/\\(?:u([0-9a-f]{4})|(.))/gi, (_, code, character) => code ? String.fromCharCode(parseInt(code, 16)) : character)
assert.ok(existsSync(sdkRoot), `Android SDK 不存在：${sdkRoot}`)
// 优先使用迁移到项目根目录的密钥，旧 Windows 环境仍可使用原用户目录密钥。
const debugKey = existsSync(join(projectRoot, 'debug.keystore')) ? join(projectRoot, 'debug.keystore') : join(homedir(), '.android', 'debug.keystore')
assert.ok(existsSync(debugKey), '原 debug.keystore 缺失；停止构建，不创建新密钥')
// 环境只作用于本次构建及子进程，不修改用户全局 Java、SDK 或签名配置。
const buildEnv = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot, GOLDEN_ABACUS_KEYSTORE: debugKey }

/** 用参数数组执行工具；任一步失败立即终止，只有需要校验的输出才捕获。 */
function run(command, args, capture = false, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, env: buildEnv, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${basename(command)} 执行失败（${result.status}）${capture ? `\n${result.stdout}${result.stderr}` : ''}`)
  return result.stdout ?? ''
}

// 先验证工具链及原证书，确保 Gradle 启动前就拒绝缺失或错误的升级签名。
assert.match(run(java, ['--version'], true), /(?:openjdk|java) 21[.\s]/, '构建必须使用 JDK 21')
const certificate = run(keytool, ['-list', '-v', '-J-Duser.language=en', '-keystore', debugKey, '-storepass', 'android', '-alias', 'androiddebugkey'], true)
assert.equal(certificate.match(/SHA256:\s*([0-9a-f:]+)/i)?.[1]?.replaceAll(':', '').toLowerCase(), expectedSigner, '原密钥证书指纹不匹配，停止构建')

// 选取已安装的最新稳定 Build Tools，用其官方工具校验最终 APK。
const toolsVersion = readdirSync(join(sdkRoot, 'build-tools')).filter((name) => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1)
assert.ok(toolsVersion, '未找到 Android Build Tools')
const toolsRoot = join(sdkRoot, 'build-tools', toolsVersion)
const signerJar = join(toolsRoot, 'lib', 'apksigner.jar')
const aapt = join(toolsRoot, `aapt2${executableSuffix}`)
assert.ok(existsSync(signerJar) && existsSync(aapt), 'Build Tools 缺少 apksigner.jar 或 aapt2')

console.log('原签名校验通过，开始测试、Web 构建及 Capacitor 同步。')
run(pnpmCommand, [...pnpmArgs, 'test'])
run(pnpmCommand, [...pnpmArgs, 'build'])
run(process.execPath, [join(projectRoot, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'])
// 直接启动项目现有 Wrapper JAR，在各平台使用同一份 Gradle 版本与配置。
run(java, ['-classpath', join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', 'assembleDebug', '--console=plain', '--no-daemon'], false, androidRoot)

// Gradle 元数据必须描述单个通用 APK，实际包内的身份和版本还需独立核对。
const outputRoot = join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug')
const apk = join(outputRoot, 'app-debug.apk')
const metadata = JSON.parse(readFileSync(join(outputRoot, 'output-metadata.json'), 'utf8'))
assert.equal(metadata.applicationId, expectedAppId, 'Gradle 包名不匹配')
assert.equal(metadata.elements.length, 1, '预期只有一个通用 APK')
const element = metadata.elements[0]
assert.equal(element.versionCode, currentVersion.versionCode, 'Gradle 产物 versionCode 与源码不一致')
assert.equal(element.versionName, currentVersion.versionName, 'Gradle 产物 versionName 与源码不一致')
const packageLine = run(aapt, ['dump', 'badging', apk], true).split('\n').find((line) => line.startsWith('package:'))
assert.ok(packageLine?.includes(`name='${expectedAppId}'`) && packageLine.includes(`versionCode='${element.versionCode}'`) && packageLine.includes(`versionName='${element.versionName}'`), 'APK 实际包名或版本与元数据不一致')
// 校验已生成 APK 的签名，而不是仅依赖 Gradle 签名配置或密钥文件本身。
const signature = run(java, ['-jar', signerJar, 'verify', '--print-certs', apk], true)
assert.equal(signature.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1]?.toLowerCase(), expectedSigner, 'APK 签名与原安装不一致')

// 所有校验通过后才交付版本化文件；禁止覆盖已存在的发布产物。
const releaseRoot = join(projectRoot, 'releases')
const filename = `golden-abacus-${element.versionName}-vc${element.versionCode}-debug.apk`
const releaseApk = join(releaseRoot, filename)
const hashPath = `${releaseApk}.sha256`
// 清单同时记录源码提交与工作区状态，防止把未提交改动误标为某个正式提交。
const manifestPath = `${releaseApk}.build.json`
assert.ok(!existsSync(releaseApk) && !existsSync(hashPath) && !existsSync(manifestPath), '发布产物已存在，请递增 Android 版本后再构建')
const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: projectRoot, encoding: 'utf8' }).trim().length > 0
const manifest = { ...currentVersion, applicationId: expectedAppId, sourceCommit, sourceDirty, signerSha256: expectedSigner, filename, sha256 }
mkdirSync(releaseRoot, { recursive: true })
copyFileSync(apk, releaseApk, constants.COPYFILE_EXCL)
writeFileSync(hashPath, `${sha256}  ${filename}\n`, { flag: 'wx' })
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
console.log(`APK: ${releaseApk}\nPackage: ${expectedAppId}\nVersion: ${element.versionName} (${element.versionCode})\nSigner SHA-256: ${expectedSigner}\nFile SHA-256: ${sha256}`)
