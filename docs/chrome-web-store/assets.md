# Readomi 商店图片

图片使用实际构建的 Readomi 1.2.6 界面，按 `design/Store-*.html` 画板排版。画板已登记在 `design/canvas.js`，可通过设计画布审阅。原始界面截图保存在 `design/assets/store/`，最终 PNG 保存在本目录的 `assets/`。

## 上传顺序

简体中文与英文各有五张。分别上传到对应语言的截图字段，每种语言保持同一顺序。

| 顺序 | 文件名 | 内容 | 尺寸 |
| --- | --- | --- | --- |
| 1 | `01-bilingual.png` | 实际网页双语译文与实际弹窗 | 1280×800 |
| 2 | `02-translation-only.png` | 仅译文与最新弹窗，使用 Option+M 切换 | 1280×800 |
| 3 | `03-hover.png` | 只翻译一个段落，悬停开关已开启，本次示例关闭流式输出 | 1280×800 |
| 4 | `04-subtitles.png` | 有英文字幕轨道的 HTML5 示例视频与真实双语字幕 | 1280×800 |
| 5 | `05-service.png` | 多个已保存的本地兼容服务、当前选择与连接状态 | 1280×800 |

| 共用图片 | 用途 | 尺寸 |
| --- | --- | --- |
| `assets/icon-128.png` | 商店图标，复制自 `public/icon/128.png` | 128×128 |
| `assets/promo-small.png` | 必需的小宣传图 | 440×280 |
| `assets/promo-marquee.png` | 可选的大宣传图 | 1400×560 |

宣传图共用现有 Readomi 品牌图标和陶红色，无 Google 商标、排名、奖章或无法验证的效果承诺。它们只保留 Readomi 名称，便于不同语言共用。视频宣传片为可选项，本套资料没有生成。

## 内容来源

文章、英中译文、视频字幕和简洁山景均为本套素材自行编写。HTML5 示例使用本地静音媒体提供播放时钟、已有英文 VTT 字幕轨道及原创 SVG 背景；不是未经授权的视频截图。字幕由实际扩展渲染，未用图片替换字幕界面。

素材使用临时 Chromium 配置和 loopback 测试服务，服务仅返回固定示例译文。不使用真实浏览数据、外部 API Key、模型账号或公共网页。截图中的 `Demo local`、`Demo alternate` / `demo-translator` 是演示服务，不应暗示 Readomi 自带免费托管翻译。模型实际质量和费用由用户所选服务决定。

中英文前三张使用实际页面与实际弹窗截图进行组合展示；标注了示例内容与配置前提。截图外围是商店介绍版式，扩展内部文案保持真实界面内容。截图不属于 AI 生成的产品 UI。

## 重新生成

在仓库根目录运行：

```bash
pnpm build
node scripts/store-assets.mjs
```

依赖项目已有的 `playwright-core` 和完整 Chromium；如果还没安装 Chromium，可用 `pnpm exec playwright-core install --no-shell chromium`。macOS 上由自动化工具运行本脚本时，按 `AGENTS.md` 首次即请求沙箱外执行；脚本需要启动带扩展的独立 Chromium，内置浏览器无法加载这个临时扩展。脚本不会修改你的常用浏览器配置、真实 API Key 或商店条目。它会覆盖本套原始截图和最终素材；改动布局应先编辑 `design/`。

`assets/capture.json` 记录 package / manifest 一致的版本、源代码提交、构建权限、尺寸与生成时间。截图中的 Option 快捷键来自 macOS 实际构建界面；其他平台使用 Alt。弹窗按完整内容高度截图，画板不拉伸其比例。重新生成后请人工检查所有图片的文字、画面、切边与示例凭证，并重新核对实际构建版本。提交新版时不要继续沿用已经与实现不符的截图。

## 官方规范

[Chrome 图片规范](https://developer.chrome.com/docs/webstore/images)要求图标 128×128、小宣传图 440×280，至少一张截图且最多五张；截图可用 1280×800 或 640×400，推荐前者。大宣传图 1400×560 可选。截图与宣传图为不透明、直角、全幅 PNG；扩展图标保留原始 PNG 的透明背景。
