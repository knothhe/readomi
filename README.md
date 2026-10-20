<p align="center"><img src=".github/assets/logo.png" alt="Readomi 图标" width="128"></p>
<h1 align="center">Readomi</h1>
<p align="center">让文字更容易读懂 · <a href="./README.en.md">English</a></p>

Readomi 是一个本地优先的浏览器阅读助手，以翻译为主要功能。译文直接融入正在读的网页，支持双语对照或仅译文，让你顺着原来的页面继续读。

## 项目来源

Fork 链：**[Read Frog（陪读蛙）](https://github.com/mengxi-ream/read-frog) → [Jiandao（简道翻译）](https://github.com/Xuanwo/jiandao) → [Readomi](https://github.com/knothhe/readomi)**。

Readomi 修改自 Xuanwo/jiandao 和 mengxi-ream/read-frog，主要移除了 Read Frog 的悬浮工具栏、朗读、自定义 AI 动作、托管账号、配置同步和统计等功能，并在 jiandao 的基础上添加了作者需要的功能。我希望尽可能保持功能简洁，并提供本地化的使用体验，因此基于个人体验进行了定制。

另一个重要原因是，我认为在 AI 时代，翻译这类基础能力人人都可以按需定制。如果你喜欢 Readomi 目前提供的精简功能，欢迎使用；如果你需要 Readomi 有意从 Read Frog 中移除的功能，可以使用 Read Frog 或其他同类产品。

感谢 Read Frog 和 jiandao 的开源贡献。没有它们，就没有 Readomi。

Readomi 此后由本仓库独立维护和迭代，产品方向、发布和问题反馈由本项目负责，与上游团队没有隶属或官方合作关系。

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

[本地安装（make install）](./docs/install-local.md)

打开设置 → 翻译服务 → 添加服务，手动填写，或复制说明给 agent，再粘贴它验证过的配置，点“检查并添加”。可以保存同一地址下的不同模型或账号；首次配置自动使用，之后添加默认保留当前服务，也可勾选“添加后使用此服务”。修改已有配置时，从目标服务的操作菜单进入“修改”，点“保存修改”；切换服务可在弹窗或设置页进行，已有译文保留。配置指南见 [docs/agent-setup.md](./docs/agent-setup.md)，可选 skill 见 [skills/readomi-setup](./skills/readomi-setup/SKILL.md)。之后点击“翻译此页”，或按默认快捷键 `Alt+E`（Mac 为 `Option+E`）；再次触发恢复原文。

新安装默认把其他语言译为简体中文，中文保持原文；已有语言设置会保留。翻译失败时，可在弹窗中重试失败段落或重新翻译此页。弹窗底部的垃圾桶只清理当前页面缓存，悬停可查看说明；清空所有文字、字幕与摘要缓存在设置 → 备份与缓存。文章摘要开关在设置 → 译文质量，网站修复入口收在弹窗的“翻译有问题？”中。

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

用 `make release` 预览 patch 更新，或用 `VERSION_BUMP=minor|major|精确版本`
选择目标版本；加 `RELEASE_FLAGS=--apply` 才会执行检查、版本提交、tag 和推送。
首次发布版本文件中的当前版本用 `make release-initial`。GitHub Release 与扩展包
由现有 CI 发布。版本选择、首次发布和失败恢复见 [RELEASING.md](./RELEASING.md)。
