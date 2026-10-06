# 版本管理与发布

版本流程按项目的 `h2-semver-release` skill 接入。`package.json` 的 `version`
是唯一版本源；WXT 构建使用该版本，单包 `pnpm-lock.yaml` 无需修改项目版本。
发布配置见 [`.release.json`](./.release.json)，执行脚本见
[`scripts/release.mjs`](./scripts/release.mjs)。

## 选择版本

- `patch`：向后兼容的修复，例如 `1.2.0` → `1.2.1`。
- `minor`：向后兼容的新功能，例如 `1.2.0` → `1.3.0`。
- `major`：不兼容的公共接口变更，例如 `1.2.0` → `2.0.0`。

依据上次发布后的实际变更选择版本，提交标题只作线索。脚本支持明确的
SemVer 版本号、预发布与 build metadata，拒绝倒退、相同版本及仅修改 metadata。
扩展打包和商店提交对版本另有要求；当前扩展发布流程使用三段正式版本，
不要直接将通用脚本支持的预发布格式用于商店发布。

## 预览与执行

首次接入时，先将脚本、配置、命令和其他项目改动提交，使工作区干净。
未跟踪文件也必须处理，包括本地 `.codex/` skill：纳入版本管理，或按个人需求
用 `.git/info/exclude` 排除；脚本不会自动清理或忽略这些文件。

在 `main` 分支先预览：

```bash
pnpm release patch
pnpm release minor
pnpm release 2.0.0
```

预览打印当前与目标版本、分支、remote、tag、版本文件、检查和 GitHub Release
选项；读取远程 refs，但不修改文件、不执行检查、不创建提交或 tag。审核后执行：

```bash
pnpm release patch --apply
```

以 `1.2.0` 执行 `patch` 为例，预览中的关键字段如下（省略检查等字段）：

```json
{
  "mode": "preview",
  "current": "1.2.0",
  "target": "1.2.1",
  "branch": "main",
  "remote": "origin",
  "tag": "v1.2.1",
  "files": ["package.json"],
  "push": true,
  "github_release": false
}
```

默认顺序为：验证干净工作区和远程状态 → `pnpm lint`、`pnpm type-check`、
`pnpm test`、`pnpm test:release` → 确认检查未修改分支、提交、index 或工作区 →
更新版本 → 创建
`chore(release): v<version>` 提交 → annotated tag → 原子推送 `main` 和本次 tag。
这是本项目对通用发布脚本的定制：检查运行于当前版本，通过后才写入新版本，
因此检查失败不会留下脚本造成的版本修改。检查验证源码，不构建目标版本产物；
检查产生的文件或 Git 状态变化会保留供人工处理，脚本不会自动回滚。
远程分支必须已存在且是本地 HEAD 的祖先；如有远程新提交，先 fetch 并整合。
本地已有的未推送提交会随 `main` 一起推送。脚本不运行构建或 npm 包发布。

推送 tag 后，现有 [Release Extension CI](./.github/workflows/release.yml)
测试、构建 Chrome / Edge / Firefox ZIP、创建 GitHub Release 并上传扩展包。
Release 正文包含上次可达的较低版本 tag 以来的非 merge commit 标题和短 hash，
排除版本提交，并保留 Full Changelog 链接；CI 与本地命令使用相同的生成逻辑。
附件命名为 `readomi-<version>-chrome.zip`、`readomi-<version>-edge.zip` 和
`readomi-<version>-firefox.zip`，不生成或上传 sources ZIP。
配置完整的 Chrome 商店凭据时，tag 推送还会触发商店提交；手动重建既有 tag
的附件不会再次触发商店提交。

## GitHub Release 与附件

默认 `github_release: false`，由 CI 创建 GitHub Release。需要本地命令也创建
Release 时，可以显式启用；该选项需要已登录的 GitHub CLI：

```bash
pnpm release patch --github-release
pnpm release patch --apply --github-release
```

启用后，先审核预览中的 `release_notes`：包含 Full Changelog 链接与上次可达的
较低版本 tag 以来的非 merge commit 标题。已有 Release 返回其 URL，不修改正文；
CI 继续上传附件。该选项本身不构建或上传扩展包。

`pnpm release:chrome` 用于重建并上传某个已发布版本的 Chrome ZIP。必须检出
对应 tag、保持工作区干净，并确认 GitHub Release 已存在。它不修改版本、不创建
tag 或 Release；上传会替换同名 Chrome ZIP。

手动上传 Chrome Web Store 时，运行 `pnpm zip`，使用生成的
`.output/readomi-<version>-chrome.zip`。打包会自动移除 manifest 的
`key` 字段；`pnpm build` 和本地开发仍保留用于固定扩展 ID 的公钥。

## 本地发布与失败恢复

只生成本地版本提交与 tag、暂不推送：

```bash
pnpm release patch --apply --no-push --no-github-release
```

失败时先检查 `git status`、最近提交、本地 tag 与远程 refs；脚本保留实际状态，
不自动回滚、不强推、不移动已发布 tag。

- 检查失败或检查修改了工作区 / Git 状态：脚本尚未更新版本，也未创建版本提交
  或 tag。修复原因，审核并处理检查留下的改动，使工作区干净后重跑原命令。
- 版本写入失败，尚无版本提交：审核并还原本次脚本造成的版本修改，使工作区
  干净后重跑原命令。保留其他工作成果。
- 提交或 hook 失败：先核查 index、版本和提交内容。若版本提交已存在但尚无
  tag，核验检查结果后手动补齐同名 annotated tag，再续推。
- 提交和 annotated tag 已创建，推送失败或暂未推送：使用当前明确版本续推，
  不再次 bump。

```bash
pnpm release 1.2.1 --resume
pnpm release 1.2.1 --resume --apply
```

`--resume` 要求版本一致、tag 指向 HEAD、HEAD 标题为对应版本提交且工作区干净；
不再更新版本或执行检查。若本地创建 GitHub Release 失败，修复 `gh` 权限后，
使用相同明确版本加 `--resume --apply --github-release`。
CI 附件构建失败时，通过 Release Extension 的 `workflow_dispatch` 指定原 tag
重建附件，不增加版本或移动 tag。

版本管理测试用 `pnpm test:release`，在临时仓库与本地 bare remote 中验证，
不访问真实 GitHub、不执行真实项目发布。
