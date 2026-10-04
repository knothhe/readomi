# 站点规则

站点规则在 DOM 遍历、翻译请求和最终展示中使用同一份有效配置。
内置库保留陪读蛙当前本地版本的 484 条原始规则（其中 2 条全站规则），
在其后叠加 Readomi 兼容处理，再叠加用户规则。每条内置规则可独立停用；
停用时也撤销该规则附带的 Readomi 兼容处理。

## 设置

「站点规则」是「网页阅读」的二级页面。侧栏只有「网页阅读」入口；默认阅读页在常用设置下方显示一行「站点规则」入口和说明，点击后才显示规则列表与编辑器。
详情页上方有「← 网页阅读」返回入口，侧栏仍选中「网页阅读」。从阅读页进入时，返回恢复父页历史与滚动位置；直达详情页时返回固定父页。
地址使用 `#reading/site-rules`，旧 `#site-rules` 自动兼容到此地址；浏览器前进、后退和刷新均恢复对应页面。
组件持续挂载，返回阅读或切换栏目不会丢失搜索、页签与未保存的规则草稿。

`Settings-Site-Rules.html` 默认展示内置规则。页面内容最大宽度 960px；
「内置规则／自定义规则」两页签分开浏览和编辑任务，不并排放置空 JSON 编辑器。
页签下方注明规则库源自陪读蛙（Read Frog），采用 GPL-3.0，由 Readomi 适配与维护，并提供项目和许可证链接。
可见规则 ID、描述、选择器和 CSS 使用 Readomi 名称；上游快照与归属文档保留原始署名。
旧 readfrog-* 停用记录仍对应同一条 readomi-* 规则，再次启用会清理旧别名。
列表沿用陪读蛙紧凑行：规则 ID、描述、前两个网址模式和余下数量，详情按需展开。
规则按 50 条分批显示；搜索改变时恢复首批，通过页面滚动浏览，没有内嵌列表滚动条。
`Settings-Site-Rules-Disabled.html` 展示停用 twitter 规则的即时状态。
`Settings-Site-Rules-Expanded.html` 展示完整网址模式和可复制 JSON。
`Settings-Site-Rules-No-Matches.html` 展示没有搜索结果时的提示。
`Settings-Site-Rules-Custom-Empty.html` 展示添加入口；已有自定义规则时展示摘要和编辑入口。
`Settings-Site-Rules-Editing.html` 只在读者进入编辑后显示 JSON，输入后等待 500ms 校验。
检查中、字段无效和保存失败分别有独立画板；失败保留输入，取消恢复最新已保存规则并退出编辑。
`Settings-Site-Rules-Invalid.html` 展示字段错误，保留未保存的草稿。
`Settings-Site-Rules-Mobile.html` 展示窄屏搜索；编辑和暗色也有独立画板。

内置开关立即保存。自定义编辑只在校验通过并点击「保存规则」后保存；
取消恢复已保存版本。搜索覆盖规则 ID、描述和 URL 模式。
内置规则可以查看完整 JSON；自定义规则说明和示例也可展开。
在内置／自定义页签或不同设置栏目间切换时保留编辑草稿。

## 执行

规则按 URL 和排除 URL 匹配；选择器以增删集合合并，数字参数最后一条优先。
用户规则可增删翻译范围、修改遍历标签、最低文本长度及站点 CSS。
匹配 include 的元素不会重新打开已被 exclude 排除的祖先。
段落节点的分组和译文的块级／行内展示分别配置。
站点 CSS 随译文会话插入，重置页面或退出会话时清理。

链接等保留区域不独立翻译，随父段落提取文本；数学公式等原子区域保留原有内容，
以占位符参与翻译并还原。扩展自己的 UI 与已生成的译文始终排除。

含有公式原子区域的悬停段落先显示等待点，完整结果返回后一起还原公式和译文，
避免临时展示内部占位符。对应 `Page-Inline-Math-Waiting.html` 与
`Page-Inline-Math-Ready.html`；普通文字继续跟随流式设置。

### 显式翻译组

站点规则可用 `translationGroups: [{ containerSelector, sourceSelectors, placement?, slot? }]`
把多个指定正文片段作为一组。`containerSelector` 识别组容器；每个容器只负责一组。
`sourceSelectors` 相对该容器查询后代，支持 `:scope`，只提取 light DOM 正文并保留段落，
不因整帖分组而纳入图片、操作按钮或其他元数据，也不穿透 Shadow DOM。
先按 `sourceSelectors` 声明顺序收集，每个选择器的命中按 DOM 顺序；节点去重，嵌套源仅保留最外层。
最终保留来源列表顺序，不全局重新按 DOM 排序。
每组一次请求、同一个译文容器，hover 与网页翻译使用相同分组和渲染。

Hover 目标认领既可使用当前 include 正文段落，也可使用有允许 source 正文的已声明 group。
反引号的同步捕获判断必须识别 group，不能仅用 owner 是否命中 include 来决定可翻译性。
组必须至少有一项允许翻译、非空且可见的 source；空、已排除、隐藏、editable 或停止的组
不消费反引号。识别组只决定正文来源与请求归属，不能把 owner 整体扩入 include 或整块提取，
也不重新开启被排除的区域。输入框焦点、编辑区事件来源及输入法组合继续保留打字。
仅译文模式中，可见的组译文仍可认领按键以恢复被扩展隐藏的原文。
交互契约详见 `hover-shortcut-flow.md`。

多个匹配规则按先后应用时，相同 `containerSelector` 的后定义覆盖前定义，
`sourceSelectors` 不做集合合并；`sourceSelectors: []` 可停止对应组。
`placement` 默认 `append`：把译文追加为容器子节点，宿主必须可以显示新增节点，
Shadow DOM 宿主未指定 `slot` 时需有可见 default slot；可通过 `slot` 指定宿主已有的 named slot。
`slot` 为非空白字符串，且只用于 `append`；`after` 在组容器之后插入译文，不能同时提供 `slot`。
插入位置只决定译文位置，译文样式继续遵循读者设置。

## X

采用陪读蛙细分的正文范围、用户名／侧栏／视频排除、链接保留和解除正文截断。
Readomi 的整条 tweetText 保持一个块级段落并独立展示译文；引用条等样式继续
跟随「网页阅读」设置。流式与完成状态沿用 `Page-X-Tweet-Streaming.html`
和 `Page-X-Tweet-Ready.html`，避免流式结束后与正文混排。

## Threads 与 Reddit

Threads 的本地兼容处理沿用「适配 Threads 首页翻译」会话的最终规则：
只解除包住帖子正文的误排除，保留导航与操作区域过滤，识别整帖正文容器。
正文中的多段 `div` 按一个帖子发起一次请求，但提取时保留真实块级段落边界；
译文在原文末尾的同一个块中保留对应段落，继续使用读者选择的竖线等样式。
流式输出与完成态都保留换行，不在完成时增加额外一行空白。
对应 `Page-Threads-Multi-Paragraph-Streaming.html` 和
`Page-Threads-Multi-Paragraph-Ready.html`；图内文字为原创结构示例。

Reddit 首页普通帖子 `shreddit-post` 与广告帖 `shreddit-ad-post` 均可声明自己的整帖分组。
普通帖来源仍限于标题与摘录/正文；广告帖来源限于直属 `div[slot="title"]`
和可选的 `delegated-link[slot="text-body"] > .md` 正文，不提取广告 owner 的整体文本。
普通帖透明覆盖链接与广告帖直属 `delegated-link[slot="full-post-link"]`
只作为卡片命中入口，不作为正文提取对象。
键盘 hover 从标题、正文或该覆盖链接均进入同一 card group；同步按键认领按该组允许的 source 判断，
无需把整个卡片纳入 include 或正文提取。标题与摘录/正文在一组内保留原有段落，
每帖一次请求，完整原文之后只显示同一个竖线等样式的译文容器，
不再对标题和段落分别插入译文。文字帖顺序为原文→整帖译文→操作栏；
图片帖为原文→整帖译文→媒体→操作栏；Reddit 分组指定 `slot: "text-body"`，
通过现有正文 named slot 展示译文。等待、流式和完成统一位于原文末尾、图片之前，
不在不同阶段使用媒体后的 default slot 导致位置跳动。
普通帖与广告帖均使用 `text-body` named slot，标题图片广告没有正文时也在标题后、媒体前显示译文。
图片、投票、分享、品牌/用户名、`Ad` 标识、`Learn More` 广告 CTA 和其他元数据不参与正文提取；
Ad 与 CTA 保持原文，CTA 位于媒体后，原链接行为保留。
详情本轮保持原设计：标题、正文与实际段落的译文另起并遵循当前竖线等样式。
对应 `Page-Reddit-Reading-Waiting.html`、`Page-Reddit-Reading-Streaming.html`
与 `Page-Reddit-Reading-Ready.html`；三板第一帖为普通帖，第二帖为虚构 QuietNotes 图片广告。

这两项兼容规则随对应内置规则开关停用，用户规则仍最后叠加。
本轮基于引用会话、只读 DOM 和源码实现，实际翻译测试由用户完成；
链接上的鼠标长按仍沿用当前事件限制。

原生视频字幕的来源轨、视频选择、播放器切换和控件避让详见
`video-subtitle-flow.md`。字号默认随视频窗口宽度缩放，保留固定字号可选。
