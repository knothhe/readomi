<p align="center"><img src=".github/assets/logo.png" alt="Readomi 图标" width="128"></p>
<h1 align="center">Readomi</h1>
<p align="center">让文字更容易读懂 · <a href="./README.en.md">English</a></p>

Readomi 是一个本地优先的浏览器阅读助手，以翻译为主要功能。译文直接融入正在读的网页，支持双语对照或仅译文，让你顺着原来的页面继续读。

## 项目来源

Fork 链：**[Read Frog（陪读蛙）](https://github.com/mengxi-ream/read-frog) → [Jiandao（简道翻译）](https://github.com/Xuanwo/jiandao) → [Readomi](https://github.com/knothhe/readomi)**。

Readomi 直接 fork 自简道翻译；简道翻译 fork 自陪读蛙。感谢两个上游项目的作者与贡献者。Readomi 此后由本仓库独立维护和迭代，产品方向、发布和问题反馈由本项目负责，与上游团队没有隶属或官方合作关系。

## 特点

- **围绕阅读**：整页翻译优先处理可见段落，保留页面布局；可开启段落悬停翻译、已有视频字幕翻译和英文词首加粗。
- **自己选择模型**：支持 OpenAI、Anthropic、Gemini、DeepSeek、兼容接口及本地模型。请求从浏览器直接发往你配置的服务。
- **配置灵活**：手动配置或交给 coding agent 验证，支持模型列表、快捷键、自定义提示词与本地配置备份。
- **自己的外观**：默认陶红；设置 → 外观可切换暖紫、琥珀或墨青。界面、译文标记和工具栏图标同步换色；设置 → 外观可选择亮色、暗色或跟随系统，默认跟随系统。
- **本地优先**：没有账号、云同步或托管翻译服务。设置、密钥和缓存保存在浏览器本地，见[隐私政策](./PRIVACY.md)。

视频翻译使用 YouTube 已开启的字幕或 HTML5 字幕轨道，不包含无字幕视频语音识别。悬停与字幕翻译默认关闭。

## 安装与使用

从本仓库 [Releases](https://github.com/knothhe/readomi/releases) 下载可用的 Chrome 构建并解压，在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”。Edge 使用 `edge://extensions`。也可以从源码构建：

```bash
git clone https://github.com/knothhe/readomi.git
cd readomi
pnpm install
pnpm build           # Chrome
pnpm build:edge      # Edge
pnpm build:firefox   # Firefox
```

Chrome / Edge 加载 `.output/` 下对应构建目录；Firefox 在 `about:debugging#/runtime/this-firefox` 临时载入对应目录中的 `manifest.json`。

开发时可以把构建安装到固定的本地目录，避免依赖 `.output/`：

```bash
cp .install-local.example.json .install-local.json
# 编辑 .install-local.json，为每个浏览器指定安装父目录和插件 name
pnpm install:local           # 使用配置中的 browser，默认 Chrome
pnpm install:local chrome
pnpm install:local firefox
pnpm install:local edge
# 也可以直接指定目录，覆盖配置
pnpm install:local --browser chrome --dir "~/Extensions/chrome" --name readomi
```

`.install-local.json` 已被 Git 忽略；可配置 `browser`、`name` 和 `directories`，格式见
[.install-local.example.json](./.install-local.example.json)。路径支持 `~/`，相对路径以仓库根目录为基准；
`--config <文件>` 可选择其他配置文件。`directories` 和 `--dir` 都是**父目录**；`name` 是插件子目录名，默认 `readomi`，可用 `--name` 覆盖。
例如父目录 `~/Extensions/chrome`、名称 `readomi`，实际安装到 `~/Extensions/chrome/readomi/`，不会覆盖父目录或其中的其他插件和文件。
命令先构建对应浏览器的 MV3 扩展，再更新这个插件子目录并清除其中的旧构建文件。
已有插件子目录不属于本项目及所选浏览器时，会显示完整路径并用 `Y/n` 询问是否覆盖**这个插件子目录**：回车或 `Y` 确认，`n` 取消且不构建或修改文件；输入结束也会取消。
确认后只替换插件子目录内的文件，后续更新同项目、同浏览器的子目录无需重复确认。插件子目录不能与仓库或 `.output/` 重叠。
旧命令曾直接复制到父目录的文件会保留，不自动删除或迁移。首次仍需在浏览器中加载插件子目录（Firefox 选择其中的 `manifest.json`），后续更新后在浏览器中重新加载扩展。
Firefox 使用临时加载，重启浏览器后需要再次加载。

打开设置 → 翻译服务 → 添加服务，手动填写，或复制说明给 agent，再粘贴它验证过的配置，点“检查并添加”。可以保存同一地址下的不同模型或账号；首次配置自动使用，之后添加默认保留当前服务，也可勾选“添加后使用此服务”。修改已有配置时，从目标服务的操作菜单进入“修改”，点“保存修改”；切换服务可在弹窗或设置页进行，已有译文保留。配置指南见 [docs/agent-setup.md](./docs/agent-setup.md)，可选 skill 见 [skills/readomi-setup](./skills/readomi-setup/SKILL.md)。之后点击“翻译此页”，或按默认快捷键 `Alt+E`（Mac 为 `Option+E`）；再次触发恢复原文。

Readomi 使用独立的扩展标识，与上游可以同时安装。

## 开发与反馈

```bash
pnpm dev
pnpm test
pnpm type-check
pnpm build
```

界面设计以 `design/` 为准，可直接打开 [design/index.html](./design/index.html)。浏览器测试用 `pnpm test:e2e`；首次运行先执行 `pnpm exec playwright-core install --no-shell chromium`。

问题与建议请提交到 [Readomi Issues](https://github.com/knothhe/readomi/issues)。本项目继承上游的 GNU GPL v3 许可，见 [LICENSE](./LICENSE)。

## 版本管理

用 `pnpm release patch`（或 `minor` / `major`）预览版本更新；加 `--apply`
才会执行检查、版本提交、tag 和推送。GitHub Release 与扩展包由现有 CI 发布。
版本选择、首次接入和失败恢复见 [RELEASING.md](./RELEASING.md)。
