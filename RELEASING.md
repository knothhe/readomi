# 版本管理与发布

版本流程按项目的 `h2-semver-release` skill 接入。`package.json` 的 `version`
是唯一版本源；WXT 构建使用该版本，单包 `pnpm-lock.yaml` 无需修改项目版本。
发布配置见 [`.release.json`](./.release.json)，执行脚本见
[`scripts/release.mjs`](./scripts/release.mjs)，统一通过 [Makefile](./Makefile) 调用。
需要 Make、Node.js 22+、Git 和项目指定的 pnpm；创建 GitHub Release 还需要
已登录的 GitHub CLI。首次发布到 GitHub 时，即使由 CI 创建 Release，也需要
GitHub CLI 查询该版本是否已有 Release 或当前凭据可见的草稿。

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
make release                       # 默认 patch
make release VERSION_BUMP=minor
make release VERSION_BUMP=major
make release VERSION_BUMP=2.0.0
```

预览打印发布类型、当前与目标版本、分支、remote、tag、版本文件、检查顺序和 GitHub Release
选项；读取远程 refs，但不修改文件、不执行检查、不创建提交或 tag。审核后执行：

```bash
make release RELEASE_FLAGS=--apply
```

以 `1.2.0` 执行 `patch` 为例，预览中的关键字段如下（省略检查等字段）：

```json
{
  "mode": "preview",
  "release_type": "upgrade",
  "current": "1.2.0",
  "target": "1.2.1",
  "branch": "main",
  "remote": "origin",
  "tag": "v1.2.1",
  "files": ["package.json"],
  "create_version_commit": true,
  "check_phase": "before-bump",
  "push": true,
  "github_release": false
}
```

默认顺序为：验证干净工作区和远程状态 → `pnpm lint`、`pnpm type-check`、
`pnpm test`、`pnpm test:release` → 确认检查未修改分支、提交、index 或工作区 →
更新版本 → 创建
`chore(release): v<version>` 提交 → annotated tag → 原子推送 `main` 和本次 tag。
项目使用 `before-bump` 顺序：检查运行于当前版本，通过后才写入新版本，
因此检查失败不会留下脚本造成的版本修改。检查验证源码，不构建目标版本产物；
检查产生的文件或 Git 状态变化会保留供人工处理，脚本不会自动回滚。
远程分支必须已存在且是本地 HEAD 的祖先；如有远程新提交，先 fetch 并整合。
本地已有的未推送提交会随 `main` 一起推送。脚本不运行构建或 npm 包发布。

后续升级的目标必须高于当前版本；指定相同版本不会转为首次发布。预发布升级
或转为正式版本时必须指定明确版本号，并遵守前述扩展商店版本约定。

### 首次发布当前版本

只有版本文件中的当前版本尚未发布时，使用独立的首次入口：

```bash
make release-initial
make release-initial RELEASE_FLAGS=--apply
```

首次发布不改写版本或锁文件，不创建版本提交。它要求当前版本文件已纳入 Git、
工作区干净、位于配置分支，并确认本地与目标远程均没有同名 tag。GitHub 目标
还会查询现有 Release（包括当前凭据可见的草稿）；查询失败就停止，不能解释为
尚未发布。`--no-push` 不查询远程，不能据此判断该版本是否已远程发布。

预览显示 `release_type: "initial"`、`current == target`、`files: []`、
`create_version_commit: false` 和 `check_phase: "current-version"`。执行时先检查
当前版本，再直接给 HEAD 创建 annotated tag，正文含 `Release-Type: initial`，
随后原子推送 `main` 与该 tag。首次发布部分成功后，用明确版本号续推，不再次
运行首次入口，也不移动已有 tag。

### 现有 CI

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
make release RELEASE_FLAGS=--github-release
make release RELEASE_FLAGS='--apply --github-release'
```

首次发布同样通过 `make release-initial RELEASE_FLAGS='--apply --github-release'`
显式启用本地 Release 创建。

启用后，先审核预览中的 `release_notes`：包含 Full Changelog 链接与上次可达的
较低版本 tag 以来的非 merge commit 标题。已有 Release 返回其 URL，不修改正文；
CI 继续上传附件。该选项本身不构建或上传扩展包。

`make release-chrome` 用于重建并上传某个已发布版本的 Chrome ZIP。必须检出
对应 tag、保持工作区干净，并确认 GitHub Release 已存在。它不修改版本、不创建
tag 或 Release；上传会替换同名 Chrome ZIP。

独立生成已有 tag 的 Release 正文：

```bash
make --silent release-notes RELEASE_REPO=knothhe/readomi RELEASE_TAG=v1.2.10
```

`RELEASE_TAG` 必须是已有本地 tag，需要完整 Git 历史与 tags；输出 Markdown 到
stdout。该入口只读本地 Git 历史，不要求干净工作区或当前分支，不运行检查、
更新版本、创建 tag、推送或调用 GitHub CLI。现有 CI 使用同一 Make 入口生成正文。

手动上传 Chrome Web Store 时，运行 `make zip`，使用生成的
`.output/readomi-<version>-chrome.zip`。打包会自动移除 manifest 的
`key` 字段；`pnpm build` 和本地开发仍保留用于固定扩展 ID 的公钥。

商店比较 ZIP 内 `manifest.json` 的 `version`，新包版本必须高于已发布版本。
更新 `package.json` 或执行 `make release` 不会更新本地已有的 ZIP；必须重新
运行 `make zip`，并选择与当前版本一致的文件。若源码版本已高于商店版本，
重新打包即可，无需再次升版。可先运行 `make clean` 移除旧包，避免误选。

### 清理构建产物

运行 `make clean` 删除 `.output/` 下所有浏览器的构建目录和 ZIP、`.wxt/`
生成文件、`coverage/` 测试报告，以及根目录的 `stats.html`、`stats-*.html`
和 `stats-*.json` 构建分析报告。源码、`assets/`、依赖和已同步的本地扩展安装
目录均保留。需要重新打包时运行 `make zip`；仅重新生成 WXT 类型时运行
`pnpm exec wxt prepare`。

## 本地发布与失败恢复

只生成本地版本提交与 tag、暂不推送：

```bash
make release RELEASE_FLAGS='--apply --no-push --no-github-release'
```

首次发布只创建本地 tag 时，改用
`make release-initial RELEASE_FLAGS='--apply --no-push --no-github-release'`。

失败时先检查 `git status`、最近提交、本地 tag 与远程 refs；脚本保留实际状态，
不自动回滚、不强推、不移动已发布 tag。

- 检查失败或检查修改了工作区 / Git 状态：脚本尚未更新版本，也未创建版本提交
  或 tag。修复原因，审核并处理检查留下的改动，使工作区干净后重跑原命令。
- 首次发布检查失败或产生副作用：脚本未改写版本或创建 tag，检查自己的修改会
  保留。处理原因并恢复干净工作区后重跑 `make release-initial`。
- 版本写入失败，尚无版本提交：审核并还原本次脚本造成的版本修改，使工作区
  干净后重跑原命令。保留其他工作成果。
- 提交或 hook 失败：先核查 index、版本和提交内容。若版本提交已存在但尚无
  tag，核验检查结果后手动补齐同名 annotated tag，再续推。
- annotated tag 已创建，推送失败或暂未推送：使用当前明确版本续推，
  不再次 bump。

```bash
make release VERSION_BUMP=1.2.1 RELEASE_FLAGS=--resume
make release VERSION_BUMP=1.2.1 RELEASE_FLAGS='--resume --apply'
```

`--resume` 必须通过 `make release VERSION_BUMP=精确版本` 使用，不能传 `initial`。
两种发布都要求版本一致、annotated tag 指向 HEAD 且工作区干净；升级还要求 HEAD
标题为对应版本提交，首次发布则要求 tag 有脚本生成的初始发布标记。不再更新
版本或执行检查。远程同名 tag 必须与本地 tag 对象一致。若本地创建 GitHub
Release 失败，修复 `gh` 权限后执行：

```bash
make release VERSION_BUMP=1.2.1 RELEASE_FLAGS='--resume --apply --github-release'
```

已有首次 tag 缺少初始发布标记时，不修改 tag 来启用续推，需单独核查并完成原发布。
CI 附件构建失败时，通过 Release Extension 的 `workflow_dispatch` 指定原 tag
重建附件，不增加版本或移动 tag。

版本管理测试用 `pnpm test:release`，在临时仓库与本地 bare remote 中验证，
不访问真实 GitHub、不执行真实项目发布。
