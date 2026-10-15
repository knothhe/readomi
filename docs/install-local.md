# 本地安装（install:local）

`pnpm install:local` 构建所选浏览器的 MV3 扩展，再同步到固定的 `<安装父目录>/<插件名称>`，供浏览器加载。后续构建仍安装到同一位置，避免浏览器依赖仓库里的 `.output/`。

## 运行前提与配置

在仓库根目录使用 Node.js 22+ 和 [package.json](../package.json) 指定的 pnpm 版本，先执行 `pnpm install` 安装依赖。安装命令会自行构建，无需提前运行 `pnpm build`。

复制并编辑个人配置：

```bash
cp .install-local.example.json .install-local.json
```

配置格式见 [.install-local.example.json](../.install-local.example.json)：

```json
{
  "browser": "chrome",
  "name": "Readomi",
  "directories": {
    "chrome": "~/Extensions/chrome",
    "firefox": "~/Extensions/firefox",
    "edge": "~/Extensions/edge"
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `browser` | 默认浏览器，支持 `chrome`、`firefox`、`edge`；省略时为 `chrome` |
| `name` | 插件子目录名；示例为 `Readomi`，省略时脚本默认使用小写 `readomi` |
| `directories` | 各浏览器的安装父目录；所选浏览器必须有对应路径，或通过 `--dir` 指定 |

当前项目只支持这三个配置字段。`.install-local.json` 已被 Git 忽略，不应提交个人路径。使用其他个人配置文件时，也需将其加入 Git 忽略规则。

`directories` 与 `--dir` 都表示**父目录**，实际安装目录还会拼接 `name`。按上述示例运行 Chrome 安装时，目标是 `~/Extensions/chrome/Readomi/`。名称区分大小写的行为取决于文件系统，建议始终沿用同一个名称。

命令行参数优先于配置，名称优先级为 `--name` → 配置 `name` → `readomi`。名称必须是单个合法目录名，不能包含路径分隔符、首尾空格或文件系统保留字符和名称。它只改变本地目录名，不修改 manifest 名称或扩展 ID。

安装父目录支持 `~/`，相对路径以仓库根目录为基准，不展开 `$HOME` 等环境变量。`--config <文件>` 的相对路径也以仓库根目录为基准，指定的文件必须存在。默认配置不存在时，可直接通过 `--dir` 安装。

## 常用命令

```bash
pnpm install:local           # 使用配置中的 browser，省略时为 Chrome
pnpm install:local chrome
pnpm install:local firefox
pnpm install:local edge

# 覆盖配置中的浏览器、父目录和名称
pnpm install:local --browser chrome --dir "~/Extensions/chrome" --name Readomi

# 使用另一份个人配置
pnpm install:local edge --config .install-local.custom.json

# 仅查看帮助，不构建或安装
pnpm install:local --help
```

| 浏览器 | 实际构建命令 | 构建产物 |
| --- | --- | --- |
| Chrome | `pnpm build` | `.output/chrome-mv3/` |
| Firefox | `pnpm build:firefox` | `.output/firefox-mv3/` |
| Edge | `pnpm build:edge` | `.output/edge-mv3/` |

不同浏览器应使用不同父目录；共用父目录时，使用 `--name Readomi-chrome`、`--name Readomi-firefox` 等不同名称隔离。安装命令会执行构建并更新目录，没有预览模式。

## 更新与覆盖确认

只更新具名插件子目录，父目录中的文件和其他插件保留。新子目录、空子目录或属于同一项目、同一浏览器的 schema 2 受管子目录可直接安装。其他非空子目录会显示完整路径并询问：

```text
Plugin directory already contains files: /path/to/extensions/Readomi
Overwriting will replace all files in this plugin directory.
Overwrite this plugin? [Y/n]
```

- 回车、`Y` / `y` / `yes`：确认替换该插件子目录内全部文件，先构建再安装。
- `n` / `N` / `no`：取消，不构建、不修改目录。
- 其他输入：重新询问；输入结束或 Ctrl+C：取消。

成功安装后，子目录中的 `.readomi-install.json` 记录项目路径、浏览器和版本，后续同归属更新无需重复确认。移动仓库、切换工作树、切换浏览器或使用旧版归属标记后，可能再次要求确认。

更新会清除插件子目录中的旧构建文件，不要在其中存放个人文件。插件目标不能与仓库或 `.output/` 重叠，也不能本身是符号链接或文件。构建或复制期间目标变成需要确认的目录时，命令会停止，需重新运行并确认。

构建失败、产物 manifest 校验失败或复制失败时保留原安装。替换失败时尝试恢复；无法恢复时会输出旧安装备份的位置，按该位置检查并恢复文件。

旧版命令曾将 `--dir` 或配置路径直接当作最终安装目录。若原路径是 `~/Extensions/chrome/Readomi`，希望保留最终位置，应改为父目录 `~/Extensions/chrome` 加 `name: Readomi`，避免重复拼接名称。曾平铺在父目录中的旧资源会保留，不自动清理或迁移；首次加载时选择新的插件子目录。

## 自动安装条件

使用 `h2-browser-extension` 技能执行扩展改动任务时，若当前项目根目录存在真实的 `.install-local.json`，完成改动和必要验证后会按配置自动运行 `pnpm install:local`，并报告结果。只有示例文件、纯讨论或评估、用户明确要求跳过时不会安装；最终改动已成功安装时不重复执行。覆盖确认和执行权限要求仍然适用。

当前项目未配置 `install:local` 的 Codex 收尾 hook。可选择接入项目级 hook，在每轮回复结束前提醒 agent 检查安装条件；需明确同意后才配置。普通终端构建和测试不会因此自动安装。

## 浏览器首次加载与更新

命令成功只表示构建已同步到目录。浏览器加载需单独完成，使用命令输出的完整安装路径：

| 浏览器 | 首次加载 | 更新后 |
| --- | --- | --- |
| Chrome | 打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，选择插件子目录 | 在扩展管理页重新加载 Readomi |
| Edge | 打开 `edge://extensions`，开启开发者模式，加载解包扩展，选择插件子目录 | 在扩展管理页重新加载 Readomi |
| Firefox | 打开 `about:debugging#/runtime/this-firefox`，选择临时载入附加组件，选择插件子目录中的 `manifest.json` | 在调试页重新加载；重启浏览器后需再次临时加载 |

首次加载后，后续安装沿用同一目标目录即可。需要在已打开的网页使用新构建时，重新加载扩展后也刷新网页。

## 验证命令

```bash
pnpm test:install:local      # 安装脚本行为测试，使用临时目录
pnpm test                   # 项目测试，包含安装脚本行为测试
```

行为测试验证配置、目录保护和覆盖流程，实际浏览器构建由安装命令完成；浏览器加载和页面行为需另行验证。
