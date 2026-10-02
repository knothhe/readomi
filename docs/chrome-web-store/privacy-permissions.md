# Readomi 隐私与权限填写说明

这份说明对应 `wxt.config.ts` 与当前代码。英文段落可复制到 Chrome 商店 Privacy practices 相应字段。声明需要由发布者结合最终构建和当前后台确认，不能因“开发者没有收到数据”就勾选“完全不处理用户数据”。

## 单一用途

Readomi helps users read web content through in-page translation of web pages, individual paragraphs and existing video subtitles, with related controls for translation display, subtitle appearance and reading preferences. Users choose and configure their own model service.

## 权限理由

### storage

Stores user-selected translation services, API keys, prompts, language and appearance preferences locally. Temporary session storage keeps each tab's translation state, site origin and detected language. No settings are synced to a developer server.

### tabs

Identifies the active reading tab, associates translation progress and detected language with that tab, and updates the toolbar icon and popup state. Readomi uses tab URLs to scope translation state to the current site; it does not build a browsing-history log.

### alarms

Schedules periodic cleanup of local translation and article-summary caches. Entries older than seven days are eligible for cleanup, with checks approximately once a day while the extension can run. No alarm sends analytics or browsing data to the developer.

### scripting

Injects the packaged translation content script into eligible page frames so translated text can be displayed within the user's current page. Injection uses code bundled with the extension, not downloaded executable code.

### webNavigation

Finds the page's frames and responds to navigation so translation remains associated with the right document, including embedded reading content and newly loaded frames. It also resets state as the page changes; no navigation history is sent to the developer.

### Host permissions

Host pattern: `*://*/*`.

Readomi translates text on the HTTP and HTTPS pages users read, including embedded frames. Access across sites allows its packaged content script to display translations in those pages. Host access also allows direct requests to model services and custom compatible endpoints chosen by the user; their domains cannot be predetermined. Page text is sent to the configured endpoint for translation and source-language detection. No page data is sent to a Readomi-operated server.

全站访问对应真实翻译功能，但商店仍会审核权限必要性。不能将理由写成“未来可能使用”。匹配模式覆盖 HTTP/HTTPS，不能据此声称所有 Chrome 内部页或文件页都支持。

## 远程代码

后台建议选择：No, I am not using remote code.

说明：

All executable extension JavaScript is packaged with the extension. Requests to model APIs return text or structured response data used for translation, language detection and model discovery. Readomi does not download or execute remote JavaScript or WebAssembly as extension code.

依据为打包后的 manifest/content scripts、`src/utils/providers/request.ts` 和现有渲染流程。最终上传包如加入远程脚本或 SDK，需重新核对。

## 数据类型建议

下面是依据代码作出的填写建议，不是后台已经保存的声明。公开隐私政策、产品内说明、后台字段与实际行为必须一致。

| 类型 | 建议 | 实际处理 |
| --- | --- | --- |
| Website content | 勾选 | 页面、段落、已有字幕、语言识别样本；启用全文上下文时还有标题、文章与摘要。文本直达用户配置的服务 |
| Authentication information | 勾选 | 用户输入的 API Key 与可选自定义认证请求头保存在本地，并随请求发给配置的服务；配置备份含原始值 |
| Web history | 建议保守勾选并说明范围 | 读取当前标签页 URL，并在 session storage 保存站点 origin 与翻译状态；不是持久浏览历史，不上传开发者。最终按后台定义核对 |
| Personally identifiable information | 不作为单独收集功能 | 没有姓名、邮箱、账号注册。用户选择处理的网页内容可能包含个人信息，不能声称输入文本绝不含个人信息 |
| Financial and payment information | 不作为单独收集功能 | 没有付款或账单收集；模型费用由服务商处理 |
| Health information | 不作为单独收集功能 | 没有健康数据功能；网页内容可能包含相关信息 |
| Personal communications | 不作为单独收集功能 | 没有独立通信读取功能；用户翻译邮件或消息网页时，其内容仍属于发送给所选服务的文本 |
| Location | 不请求位置 | 无定位权限、定位功能。服务商可以看到请求 IP 等常规网络信息 |
| User activity | 不用于行为跟踪 | 无点击分析、鼠标行为记录或遥测；悬停与快捷键事件仅用于触发阅读功能 |

若最终分发范围特别涉及邮件、健康或财务网站，应重新评估对应类别和产品内告知，不能仅照抄上述建议。

## 数据用途认证

当前实现与下列认证一致；发布者在提交前核对后可选择后台对应认证：

- 不出售用户数据，也不向与声明用途无关的第三方转移数据。
- 不将用户数据用于与单一用途无关的目的。
- 不使用或转移用户数据来判断信用状况或用于贷款。

发送到用户配置的模型服务是阅读功能所需的数据传输，应在 Website content、Authentication information、政策与商店长描述里明确；这不等于“没有任何第三方处理数据”。

## 隐私政策与待核对项

建议后台 URL：https://github.com/knothhe/readomi/blob/main/PRIVACY.md。

本次已经更新仓库政策，但必须先推送并验证匿名访问。中文译文位于 `privacy-policy.zh-CN.md`。

当前模型语言识别会在已配置服务的页面打开或变化时发送短文本样本，而不是只在点击翻译后发生。`src/utils/content/language.ts` 当前将语言识别输入清理为最多 500 字符。现有服务设置界面未找到专门告知这一行为的说明；提交前应补齐产品内告知或调整行为，再重新检查商店声明。

自定义端点允许 HTTP，以兼容 localhost 模型。不要宣称所有请求强制 HTTPS；审核服务使用 HTTPS，最终实现对于非本地 HTTP 的处理也应核对官方安全传输要求。

## 代码与官方依据

- `wxt.config.ts`：当前权限和打包配置。
- `src/entrypoints/background/iframe-injection.ts`：脚本与 frame 处理。
- `src/entrypoints/background/translation-signal.ts` 与 `page-translation-state.ts`：标签页、origin 和会话状态。
- `src/entrypoints/background/db-cleanup.ts`：7 天缓存与每日清理。
- `src/utils/providers/request.ts`：请求文本与认证头。
- `src/utils/content/language.ts`：语言识别请求。
- `src/utils/config/backup.ts`：完整配置备份。
- [Chrome 隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)与[用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/policies)。
