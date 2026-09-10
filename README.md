# 金算盘（Golden Abacus）

一款本地优先的个人记账应用。支持浏览器运行，也可通过 Capacitor 打包为 Android 应用。

金算盘不需要账号，没有服务器、云同步、分析统计或数据上传。账目默认只保存在当前设备的 IndexedDB 中。

## 功能

- 记录、编辑和删除收入或支出
- 按月份查看收入、支出、结余和每日明细
- 查看支出分类占比及近 6 个月支出趋势
- 新增、编辑、启用或停用收支分类
- 跟随系统、浅色和深色主题
- 导出与导入完整 JSON 备份
- 清空全部本地数据

## 技术栈

- Vue 3、TypeScript、Vite
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

该命令会依次运行测试、Web 构建、Capacitor 同步、Gradle 构建、应用身份检查和签名校验，并把带版本号的 APK 复制到 `releases/`。

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
- 卸载应用或清除应用数据可能删除本地账目，请提前导出备份并存放到其他安全位置。

## 项目结构

```text
src/                       应用源代码
  domain.ts                领域类型、默认值、金额与日期逻辑
  db.ts                    IndexedDB 结构、迁移和数据读写
  backup.ts                备份格式与导入校验
  App.vue                  应用状态与持久化编排
android/                   Android 原生工程
scripts/build-android.ps1  Android APK 构建入口
dist/                      生成的 Web 文件
releases/                  可交付的版本化 APK
```

`dist/`、`android/app/build/` 和 Capacitor 生成的 Gradle 文件均为构建产物，请通过对应命令更新，不要手动编辑。
