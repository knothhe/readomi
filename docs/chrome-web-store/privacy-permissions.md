# Readomi 隐私与权限填写说明

这份说明对应当前工作区代码与 `wxt.config.ts`，核对日期为 2026 年 10 月 8 日，`package.json` 版本为 1.2.6。英文段落可复制到 Chrome 商店 Privacy practices 相应字段。声明需要由发布者结合最终构建和当前后台确认，不能因“开发者没有收到数据”就勾选“完全不处理用户数据”。本文记录代码行为与填写建议，不代表后台字段已保存或扩展已通过审核。

## 单一用途

Readomi helps users understand and write text on web pages through translation of page content, individual paragraphs, existing video subtitles and text in editable fields. Related controls adjust translation display, subtitle appearance, reading preferences and site-specific translation rules. Users choose and configure their own model service.

## 权限理由

### storage

Stores user-configured translation services, API keys, custom request headers and body parameters, prompts, language and appearance preferences, feature settings, disabled-site hostnames and site-specific rules locally. It also stores connection-check results and learned request pacing and batch limits. Temporary session storage keeps each tab's translation and subtitle switches and site scope, plus site-rule editing and preview sessions. No settings are synced to a developer server.

### tabs

Identifies the active tab, associates translation progress with that tab, and updates the toolbar icon and popup state. Readomi uses tab URLs to scope translation state to the current site, scope web text caches to the current hostname and subtitle and summary caches to the current page, and prepare and validate site-specific rule previews. It does not build a chronological browsing-history log or send tab URLs to a developer server.

### alarms

Schedules periodic cleanup of local translation and article-summary caches. Entries older than seven days are eligible for cleanup, with checks approximately once a day while the extension can run. No alarm sends analytics or browsing data to the developer.

### scripting

Injects packaged translation scripts into eligible page frames, including dynamically loaded embedded documents, so page and input-field translation can work in those frames. The packaged input editor bridge runs in the page's main world to replace translated text in supported editors; translation handling runs in the isolated extension world. Injection uses code bundled with the extension, not downloaded executable code.

### webNavigation

Finds the page's frames and responds to navigation so translation and script injection remain associated with the right document, including embedded reading content and newly loaded frames. It resets translation state when the tab leaves its site scope and invalidates site-rule preview confirmations when the document changes. No navigation history is sent to the developer.

### declarativeNetRequestWithHostAccess

Sets the User-Agent header on Readomi's own HTTP and HTTPS model-service requests to Readomi/ followed by the current extension version. Chromium does not reliably apply a User-Agent set through fetch headers, so Readomi installs a dynamic modifyHeaders rule restricted to requests initiated by this extension and the xmlhttprequest resource type. The rule does not change ordinary webpage requests or the YouTube page bridge's requests, block requests or redirect them to another service. This identifies the client to the user's configured provider; it is not used for analytics or browsing tracking.

该权限出现在 Chrome / Edge 构建中，Firefox 不申请。规则由 `src/utils/providers/fetch.ts` 在首次模型服务请求前创建，使用 `initiatorDomains: [browser.runtime.id]`、`resourceTypes: ["xmlhttprequest"]` 和 `regexFilter: "^https?://"` 限定范围，仅设置 `user-agent`；版本值来自 `src/utils/constants/app.ts`。它是动态规则，不需要 manifest 中的静态 ruleset 文件。

### Host permissions

Host pattern: `*://*/*`.

Readomi translates content on the HTTP and HTTPS pages users read, including supported embedded frames and editable fields. Access across sites allows packaged scripts to display translations, replace text after an input-translation trigger and apply site-specific translation rules. Host access also allows direct requests to model services and custom compatible endpoints chosen by the user; their domains cannot be predetermined. Text and any applicable page context are sent to the configured endpoint for translation and optional article summaries. Source language is determined within translation requests rather than through a separate page-load detection request. No page data is sent to a Readomi-operated server.

全站访问对应真实翻译功能，不能将理由写成“未来可能使用”。`host_permissions` 的上述匹配模式覆盖 HTTP/HTTPS；页面与输入框 content scripts 还声明了 `file:///*` 匹配，Chrome 本地文件访问仍需用户在扩展详情中允许并以最终构建为准。Chrome 内部页及其他受浏览器限制的页面不能注入翻译界面。

## 远程代码

后台建议选择：No, I am not using remote code.

说明：

All executable extension JavaScript is packaged with the extension, including the page editor and YouTube subtitle bridges. Model APIs return text or structured response data used for translation, article summaries and model discovery. Imported site-specific rules contain validated selectors, configuration and CSS, not executable JavaScript. Readomi does not download or execute remote JavaScript or WebAssembly as extension code.

依据为 `wxt.config.ts`、content script 入口、`src/utils/providers/request.ts`、`stream.ts` 和站点规则解析与渲染流程。YouTube 使用扩展自带的 `youtube-bridge.js` 读取已有字幕响应，必要时向 YouTube 的 `/api/timedtext` 获取字幕；这是数据请求。站点规则 CSS 会拒绝 `@import`、资源加载函数及可执行声明。最终上传包仍需核对，不能仅凭源码推断打包结果。

## 实际数据流与保存范围

- **网页与段落翻译**：待处理文本、提示词、语言规则、模型及请求参数直接发送到用户配置的服务。可用的网页标题自动加入翻译背景；开启“结合文章上下文”后，还会发送标题及提取正文的前 2,000 个字符生成摘要，并把摘要加入翻译请求。自定义提示词可引用页面描述和这段截断正文。正文提取失败时回退到页面 body 文本，再按相同上限截断。
- **语言方向**：模型在每个翻译句段内判断源语言并按主要语言 / 第二语言规则输出，代码也使用有限的本地中英文判断来约束结果。当前没有打开页面时额外发送最多 500 字符样本的语言识别流程，也不再保存检测语言。翻译已开启的页面在同站点导航、加载新内容或恢复翻译时仍可能继续发送翻译请求；“保持原文”的设置也不表示文本绝不发送到服务。
- **输入框翻译**：默认开启。在同一已聚焦编辑框连续按三次独立空格、相邻间隔不超过 300 毫秒时，将该框当前文本发送到所选服务；使用共用提示词与语言规则，不附加网页背景或生成摘要。支持普通文本框、textarea 与可编辑富文本；密码、禁用、只读字段及输入法组合不触发。它不逐键上传输入，成功后只替换框内文本，不自动提交网页表单。取消或失焦会阻止应用旧结果，但已发出的请求不能据此视为未传输。
- **已有字幕**：YouTube 字幕或 HTML5 字幕轨道中的句段发送到所选模型服务，不发送视频音频，不包含无字幕视频语音识别，也不生成完整视频摘要。YouTube 桥接脚本可在页面上下文以 `credentials: "include"` 获取受限定的 YouTube 字幕地址；该请求由浏览器按网站规则携带凭证，模型 API Key 不传入此桥接流程。
- **服务配置操作**：检查连接使用短文本 `Hi` 发起翻译请求；获取模型查询配置端点的 `/models`。两者带上适用的 API Key、自定义请求头与 `Readomi/<版本>` User-Agent，服务商也能接收 IP 等常规网络信息。自定义请求体可添加或覆盖模型请求字段，应按实际配置确认发送内容。
- **本地持久数据**：配置包含服务地址、密钥、请求头与请求体、连接检查结果、提示词、外观、语言、开关、停用站点的主机名和用户站点规则。另存每个服务 / 模型学得的请求速率与批次限制；读取该存储时会过滤超过 90 天未更新的记录。API Key 保存在浏览器扩展存储中，不是单独加密的密钥保险库。
- **缓存与会话**：IndexedDB 保存网页、段落、输入框与字幕的译文或保留原文标记，以及文章摘要、创建时间和用于归属的主机名或页面 URL 哈希；网页文字按主机名复用，字幕和摘要按页面保存。七天清理范围适用于这两类缓存，不适用于设置、密钥或服务限制。弹窗清除当前域名网页译文及当前页字幕、摘要，保留已显示译文；设置页可清空全部翻译缓存。会话存储保存翻译与单页字幕开关 / 站点范围，以及站点适配的 URL、规则草稿、预览状态与撤销信息；关闭标签页清理对应会话。没有持久的按时间排列的浏览历史，也没有开发者服务器同步。
- **用户创建的副本**：完整配置备份含原始 API Key、自定义请求头和请求体。服务配置导出 / agent 说明仅遮蔽专门的 `apiKey` 字段，`headers` 和 `body` 不会自动脱敏。站点适配说明包含当前完整 URL、用户填写的问题、相关规则与阅读设置，不包含服务配置。扩展只生成或复制这些内容，不自动发送给 agent；用户自行分享后由接收应用处理。卸载扩展不会删除导出的文件或已分享副本。

## 数据类型建议

下面是依据代码作出的填写建议，不是后台已经保存的声明。公开隐私政策、产品内说明、后台字段与实际行为必须一致。

| 类型 | 建议 | 实际处理 |
| --- | --- | --- |
| Website content | 勾选 | 页面、段落、输入框文本、已有字幕，以及适用的标题、页面描述、截断正文与摘要；文本直达用户配置的服务，无独立语言识别样本请求 |
| Authentication information | 勾选 | API Key、可选认证请求头或请求体字段保存在本地，并随适用请求发给配置的服务；完整备份含原始值，服务配置导出只遮蔽 `apiKey` 字段 |
| Web history | 建议保守勾选并说明范围 | 读取标签页 URL；会话保存站点范围和站点适配 URL；持久缓存保存主机名或页面 URL 哈希。不是按时间排列的浏览历史，不上传开发者。复制的适配说明含完整 URL，最终按后台定义核对 |
| Personally identifiable information | 不作为单独收集功能 | 没有姓名、邮箱、账号注册。用户选择处理的网页内容可能包含个人信息，不能声称输入文本绝不含个人信息 |
| Financial and payment information | 不作为单独收集功能 | 没有付款或账单收集；模型费用由服务商处理 |
| Health information | 不作为单独收集功能 | 没有健康数据功能；网页内容可能包含相关信息 |
| Personal communications | 按实际处理范围核对 | 没有独立通信账户读取功能；翻译邮件、消息网页或编辑框内的通信草稿时，内容会发送给所选服务，不能据此一概排除该类别 |
| Location | 不请求位置 | 无定位权限、定位功能。服务商可以看到请求 IP 等常规网络信息 |
| User activity | 不用于行为跟踪 | 无点击分析、鼠标轨迹记录或遥测；悬停、快捷键和输入框空格事件用于触发功能；请求速率与批次限制仅用于本地请求调度 |

页面和输入框文本可能包含个人信息、财务、健康或通信内容。没有专门采集这些数据的功能，不等于实际翻译内容不涉及这些类别；应按最终支持场景与后台定义核对，不能仅照抄上述建议。

## 数据用途认证

当前实现与下列认证一致；发布者在提交前核对后可选择后台对应认证：

- 不出售用户数据，也不向与声明用途无关的第三方转移数据。
- 不将用户数据用于与单一用途无关的目的。
- 不使用或转移用户数据来判断信用状况或用于贷款。

发送到用户配置的模型服务是翻译功能所需的数据传输，应在 Website content、Authentication information、政策与商店长描述里明确；这不等于“没有任何第三方处理数据”。本文的代码核对不能替用户所选服务商认证其数据保留、训练或其他用途。

## 隐私政策与待核对项

建议后台 URL：https://github.com/knothhe/readomi/blob/main/PRIVACY.md。

中文译文位于 `privacy-policy.zh-CN.md`。本次已同步正式英文政策、中文译文及中英文商店长描述，移除独立页面语言识别请求的旧描述，并补充输入框翻译、站点适配会话、单页字幕、站点停用、缓存范围、User-Agent 权限和配置导出的实际脱敏范围。工作区更新不代表公开链接已更新，提交前仍需推送并验证匿名访问。

服务编辑预览已通过 `options.service.sendsTo` 显示目标服务主机。提交前应结合实际产品界面核对是否充分说明待发送文本、可选页面背景、默认开启的输入框翻译触发方式及敏感副本；旧的“补齐页面自动语言识别告知”检查项已不适用。

自定义端点允许 HTTP，包括 localhost 和其他自定义地址，当前代码未将 HTTP 限定为本地端点。不要宣称所有请求强制 HTTPS，也不能把 User-Agent 网络规则当作加密措施；审核与远程服务应使用 HTTPS，并按[官方安全传输要求](https://developer.chrome.com/docs/webstore/program-policies/policies#handling_requirements)核对最终实现。

## 代码与官方依据

- `wxt.config.ts`：当前权限和打包配置。
- `src/entrypoints/host.content/index.tsx`、`input-translation.content/index.ts` 与 `input-injector.content/index.ts`：页面、输入框与本地文件匹配，以及主世界编辑桥接脚本。
- `src/entrypoints/background/iframe-injection.ts`：脚本与 frame 处理。
- `src/entrypoints/background/translation-signal.ts` 与 `page-translation-state.ts`：标签页、origin 和会话状态。
- `src/entrypoints/background/site-rule-sessions.ts` 与 `src/utils/site-rules/document.ts`：适配 URL、草稿 / 预览会话、规则保存与 agent 说明。
- `src/entrypoints/background/translation-queues.ts`、`db-cleanup.ts` 与 `src/utils/db/cache-db.ts`：译文 / 摘要缓存、URL 哈希、7 天缓存与每日清理。
- `src/utils/config/storage.ts` 与 `src/utils/request/service-limits.ts`：本地配置、请求速率 / 批次限制与 90 天记录过滤。
- `src/utils/providers/request.ts`、`stream.ts`、`models.ts`、`test-connection.ts` 与 `fetch.ts`：请求文本、认证头、请求体、连接测试、模型列表及动态 User-Agent 规则。
- `src/utils/host/translate/translate-variants.ts`、`webpage-context.ts`、`webpage-content.ts` 与 `src/utils/prompts/translate.ts`：页面背景、2,000 字符上限、输入框无背景及句段内语言规则。
- `src/entrypoints/host.content/translation-control/input-translation.ts` 与 `src/utils/input-translation/editable.ts`：输入框空格触发、可编辑字段范围及取消行为。
- `src/entrypoints/host.content/subtitles/runtime.ts`、`src/entrypoints/youtube-bootstrap.content.ts` 与 `src/utils/subtitles/youtube-bridge.ts`：字幕文本、打包桥接脚本与 YouTube 字幕请求。
- `src/utils/config/backup.ts`、`setup-document.ts` 与 `setup-agent-instructions.ts`：完整配置备份及仅遮蔽 API Key 字段的服务导出。
- `src/utils/site-rules/css.ts`：站点规则 CSS 资源加载与可执行声明过滤。
- [Chrome 隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/policies)、[用户数据常见问题](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)与[declarativeNetRequest 权限及动态规则](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)。
