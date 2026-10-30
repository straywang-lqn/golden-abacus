# 开发与发布流程

本项目采用单主分支与短期功能分支。`main` 保持可发布，不建立长期 `develop` 分支。

## 每次修改

1. 在 `main` 上执行 `git pull --ff-only`，从最新主分支创建 `codex/<topic>`。
2. 只提交本次相关文件；本机配置、密钥、账目备份与生成文件不入库。
3. 按 `AGENTS.md` 完成对应验证，并运行 `pnpm check:version`；涉及用户行为或发布流程的改动更新 `CHANGELOG.md`。
4. 推送功能分支，创建目标为 `main` 的 PR，写清改动、验证与数据影响。
5. `verify` 通过、讨论解决且分支已包含最新 `main` 后，使用普通合并或 Squash 合并。

GitHub 主分支保护要求 PR、通过 `verify`、合并前跟上主分支并解决讨论；禁止强推和删除，管理员同样遵守。个人仓库的审批人数设为 0，避免作者无法批准自己的 PR。Android 签名构建在本机完成，密钥不上传 CI。

## 版本规则

- `android/app/build.gradle` 的 `versionName` 是唯一产品版本，使用 `主版本.次版本.修订号`：不兼容变更增加主版本，功能增加次版本，修复及构建流程调整增加修订号。
- 私有 npm 包没有单独版本；数据库 `DB_VERSION` 和备份格式版本仅在相应结构变化时增加。
- 普通 PR 可以保持产品版本不变。准备交付新 APK 时，`versionCode` 和 `versionName` 都必须高于已使用版本。
- `release-baseline.json` 固定记录采用本流程前的交付下限 1.3.0 / 5，不随新版本修改。后续从正式 `vX.Y.Z` 标签读取 Android 版本，本机已有 APK 也占用其版本号。
- CI 使用完整标签历史。打包前必须先 `git fetch origin --tags`；现有产物禁止覆盖，标签禁止移动。

## 发布

1. 在发布准备 PR 中递增 Android 版本，将 `CHANGELOG.md` 对应条目标为实际发布日期，完成检查并合并。
2. 回到 `main`，运行 `git pull --ff-only` 和 `git fetch origin --tags`。用 `git status --short` 确认没有未提交或未跟踪的源码改动；有本地草稿时先在干净的检出目录构建。
3. 运行 `pnpm android:apk`。脚本会校验版本递增、原签名、包名、测试及构建，生成 APK、`.sha256` 与 `.build.json`。
4. 核对构建清单的 `sourceCommit` 等于 `git rev-parse HEAD`、`sourceDirty` 为 `false`、版本与签名正确；安装验证受影响流程。版本在生成 APK 后即被本机占用，不覆盖、不复用。
5. 在该提交创建附注标签 `v<versionName>`，只推送该标签。例如版本为 1.3.1 时：

   ```bash
   git tag -a v1.3.1 -m '金算盘 1.3.1'
   git push origin refs/tags/v1.3.1
   ```

6. 把本版更新说明保存到临时文本文件；创建对应 GitHub Release，上传三个同版本产物。以下路径和版本必须替换为本次实际值：

   ```bash
   gh release create v1.3.1 \
     releases/golden-abacus-1.3.1-vc6-debug.apk \
     releases/golden-abacus-1.3.1-vc6-debug.apk.sha256 \
     releases/golden-abacus-1.3.1-vc6-debug.apk.build.json \
     --verify-tag --title '金算盘 1.3.1' --notes-file /tmp/golden-abacus-release-notes.md
   ```

7. 核对远端标签提交、Release 附件及 SHA-256 后再交付。源码回退通过新提交修复，安装包回退也必须使用更大的 `versionCode`，不能覆盖旧版本或回退数据结构。

`releases/` 是本机输出目录；GitHub Release 保存交付附件，Git 标签与构建清单共同记录源码来源。既有旧包没有可靠源码关联时只记录已知信息，不补造历史。
