# Golden Abacus project instructions

These instructions apply to the whole project. Follow the user's current request when it conflicts with this file.

## Project background

- This is a local-only personal ledger built with Vue 3, TypeScript, Vite, Capacitor 8, and Android.
- Source code lives in `src/`; generated web assets live in `dist/`; the native project lives in `android/`.
- Data is stored in the WebView's IndexedDB. There is no account, server, sync, analytics, or upload.
- Money is always stored as integer cents. Timestamps are Unix milliseconds.
- Package manager: pnpm 11.2.1. Node.js must be 22.6 or newer.
- The workspace currently has no Git repository. Do not assume Git history or use destructive Git commands.

## Keep existing data upgradeable

- Never change the Capacitor `appId`, Android `applicationId`, IndexedDB name `golden-abacus`, or WebView origin for a normal upgrade.
- Never delete or recreate the database during startup or error recovery.
- Increment `DB_VERSION` only for a real schema change.
- Keep every shipped migration unchanged. Append a new `if (oldVersion < N)` block so users can upgrade across multiple versions in one launch.
- Run schema and data changes inside the IndexedDB upgrade transaction. A migration failure must abort and surface an error; it must never clear user data.
- IndexedDB cannot clone Vue reactive proxies. Construct a plain object before calling any database write, save it first, then update reactive state.
- Imported backups are untrusted input. Keep format-version, shape, duplicate-ID, category-reference, and size validation before the atomic restore transaction.
- When data types change, update both the database migration and backup compatibility before changing UI callers.

## Code conventions

- Use strict TypeScript and Vue `<script setup>` with the existing Composition API style.
- Reuse functions and types from `src/domain.ts`, `src/db.ts`, and `src/backup.ts`; do not duplicate domain or persistence logic in components.
- Prefer the platform and existing dependencies. Add a production dependency only when the current stack cannot reliably implement the requirement.
- Keep changes small and focused. Do not add speculative abstractions, configuration, or compatibility layers.
- Every new or modified code declaration and non-trivial implementation step must have a concise, accurate comment: cover type/data constraints, non-obvious state, function intent, and key branches, conversions, or transactions. Explain intent and invariants rather than restating syntax; update or remove stale comments with the code. Use Chinese comments in UTF-8 source files, but keep comments in BOM-less Windows PowerShell scripts ASCII/English for PowerShell 5.1 compatibility.
- Preserve Chinese user-facing copy, accessibility labels, keyboard behavior, safe-area handling, and the existing 48 px minimum touch targets.
- Every ordinary screen must use `.page`; every full-screen drawer must use `.sheet`. Both inherit `--page-top-inset`, which keeps content below the status bar with a minimum 28 px top gap.
- Handle errors where the user can act on them. Never swallow database, import, export, or save failures.
- Do not edit generated files under `dist/`, `android/app/build/`, or generated Capacitor Gradle files by hand.

## 界面风格与组件复用

- 延续现有手机优先、单列、墨绿色主题；普通页面内容宽度上限为 520 px，字体使用系统字体，不引入在线字体或装饰性渐变。
- 颜色统一引用 `src/style.css` 的语义变量（如 `--surface`、`--text`、`--muted`、`--primary`、`--primary-soft`），同时适配浅色、深色和跟随系统；组件内不要写死另一套颜色。
- 新布局优先使用 4、8、12、16、24 px 间距。内容卡片沿用 16 px 圆角，紧凑选择块沿用 12 px，底部短弹层使用 `--radius-popup`（24 px）；主要确认按钮可使用胶囊形状。
- 月份和日期入口统一复用 `src/components/DatePickerSheet.vue` 的 Vant `DatePicker` + `Popup`，使用中文滚轮、日期预览、浅绿色选中行和“取消 / 确定”；不要再直接调用浏览器原生日期或月份弹层。
- Vant 组件及其样式按需引入，不全量注册或为局部需求再加另一套 UI 库。其他控件优先复用本项目现有按钮、分段控件、表单行和抽屉样式；确保第三方样式不覆盖应用字体与键盘焦点。
- 滚动中的日期只更新弹层草稿，确认后才应用，取消保留原值。保留本地日期语义、月份边界、闰日联动和编辑记录时原有的时分秒。
- 新控件保持至少 48 px 触摸尺寸，提供中文无障碍名称、方向键与 Tab 操作、Escape 关闭和关闭后的焦点恢复；验证 320 px 窄屏、安全区及减少动态效果偏好。

## Verification by change type

- Documentation-only change: inspect the rendered text; no build is required.
- CSS or Vue-template-only change: run `pnpm build` and verify the affected screen once in the browser.
- TypeScript, domain, backup, or database change: run `pnpm test` and `pnpm build`; exercise the affected flow once.
- Dependency, Capacitor, Android, database-migration, or install-package change: run `pnpm android:apk`. This command already performs tests, web build, Capacitor sync, Gradle build, metadata checks, signer verification, artifact copy, and SHA-256 generation.
- Once the required checks pass, do not repeat broad environment scans or unrelated tests unless a new failure gives a concrete reason.

## Android release identity

- Build the current personal-installation line as Debug so it remains signed by the existing debug key.
- Expected package ID: `com.goldenabacus.app`.
- Expected signer SHA-256: `5c7ad0becc97ddd99acefdc14f07ec510e903c053d20330b5b81cca7938ad434`.
- Expected key location: `%USERPROFILE%\.android\debug.keystore`. Never delete, replace, or regenerate it. If missing or the signer differs, stop before producing an upgrade APK.
- JDK 21 is installed at `%LOCALAPPDATA%\GoldenAbacus\jdk-21\jdk-21.0.12.1+1`; the build script sets `JAVA_HOME` for its own process.
- Android SDK is configured in `android/local.properties`.
- Increment Android `versionCode` before producing a version newer than an APK already delivered to the user. Keep `versionName` human-readable.
- Do not increment IndexedDB `DB_VERSION` merely because Android `versionCode` changed.
- Build with `pnpm android:apk`. Deliver the versioned APK from `releases/`, not the mutable Gradle output path.

## Current important files

- `src/domain.ts`: domain types, defaults, money and date logic.
- `src/db.ts`: IndexedDB schema, migrations, reads, writes, and atomic backup restore.
- `src/backup.ts`: backup format and trust-boundary validation.
- `src/App.vue`: application state and persistence orchestration.
- `src/components/DatePickerSheet.vue`: shared Vant date/month picker, draft confirmation, and keyboard/focus behavior.
- `src/style.css`: shared visual tokens, controls, responsive layout, and light/dark themes.
- `android/app/build.gradle`: package ID, Android version code, and version name.
- `scripts/build-android.ps1`: the single supported APK build entry point on this machine.
