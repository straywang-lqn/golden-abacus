# 金算盘（Golden Abacus）

一款本地优先的个人记账应用。支持浏览器运行，也可通过 Capacitor 打包为 Android 应用。

金算盘不需要账号，没有服务器、云同步、分析统计或数据上传。账目默认只保存在当前设备的 IndexedDB 中。

## 功能

- 记录、编辑和删除收入或支出
- 从编辑页“再记一笔”，复用内容并以今天为日期创建新草稿
- 跨月搜索备注和分类，组合收支、分类、金额区间和起止日期筛选
- 直接选择月份、回到本月，查看收入、支出、结余和每日明细
- 切换收支分类占比与近 6 个月趋势，直接读取每月金额并点击查看对应月份
- 点击分类查看合计、笔数和账目明细，小于 1% 的分类仍保留可见占比
- 新增、编辑、启用或停用收支分类
- 月度总预算和分类预算、剩余额度及超支提示；后续月份沿用最近一次配置
- 跟随系统、浅色和深色主题
- 导出与导入完整 JSON 备份
- 显示最近导出时间，有账目时每 7 天在应用内提醒备份，可在设置中关闭
- 清空全部本地数据

## 技术栈

- Vue 3、TypeScript、Vite，日期与月份选择使用 Vant 4
- IndexedDB
- Capacitor 8、Android
- pnpm 11.2.1

## 环境要求

- Node.js 22.6 或更高版本
- pnpm 11.2.1
- 构建 Android APK 时需要 Android SDK 和 JDK 21

## 本地开发

```bash
pnpm install
pnpm dev
```

运行测试：

```bash
pnpm test
```

构建 Web 版本：

```bash
pnpm build
```

生成的 Web 文件位于 `dist/`。

## 构建 Android APK

```bash
pnpm android:apk
```

该跨平台命令会先校验原密钥证书，再依次运行测试、Web 构建、Capacitor 同步、Gradle 构建、APK 包名与版本检查和签名校验，最后把带版本号的 APK 和 `.sha256` 校验文件保存到 `releases/`。已存在的同版本产物不会被覆盖。

构建使用 JDK 21：优先读取 `JAVA_HOME`，macOS 也可自动找到已注册的 JDK 21；Android SDK 路径读取 `android/local.properties` 中的 `sdk.dir`。把原安装使用的 `debug.keystore` 放在项目根目录，旧 Windows 环境也可沿用用户目录下的 `.android/debug.keystore`。密钥缺失或证书不匹配时构建会停止，不会创建替代密钥。

项目当前使用 Debug 签名维护个人安装升级链。发布新版本前须递增 `android/app/build.gradle` 中的 `versionCode`；不要更改以下身份信息，否则已有安装可能无法覆盖升级或继续访问原数据：

- Capacitor `appId`：`com.goldenabacus.app`
- Android `applicationId`：`com.goldenabacus.app`
- IndexedDB 名称：`golden-abacus`
- 现有 Android 调试签名密钥

## 数据与备份

- 金额始终以整数分保存，避免浮点数精度问题。
- 时间使用 Unix 毫秒时间戳。
- 导入备份前会校验格式版本、数据结构、重复 ID、分类引用和文件大小。
- 备份恢复在单个 IndexedDB 事务中完成；失败时不会清空现有数据。
- 当前数据库版本为 2，升级仅补齐预算与导出状态，不改动旧账目；JSON 备份格式为 2，仍可导入格式 1 的旧备份。
- 导出时间只表示已触发下载或完成分享，请确认文件已保存到应用之外。备份提醒不会在后台发送通知。
- 卸载应用或清除应用数据可能删除本地账目，请提前导出备份并存放到其他安全位置。

## 项目结构

```text
src/                       应用源代码
  domain.ts                领域类型、默认值、金额与日期逻辑
  db.ts                    IndexedDB 结构、迁移和数据读写
  backup.ts                备份格式与导入校验
  App.vue                  应用状态与持久化编排
android/                   Android 原生工程
scripts/build-android.mjs  跨平台 Android APK 构建入口
scripts/build-android.ps1  旧 Windows 构建入口转发
dist/                      生成的 Web 文件
releases/                  可交付的版本化 APK
```

`dist/`、`android/app/build/` 和 Capacitor 生成的 Gradle 文件均为构建产物，请通过对应命令更新，不要手动编辑。
