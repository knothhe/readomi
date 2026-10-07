# Agent 站点适配：网页单面板方案

状态：已按网页单面板方案接入实现，待用户测试。Agent 功能首轮未调整内置库；后续已按引用的 Threads 适配会话补充 Threads 与 Reddit 本地兼容规则，展示目标见 `site-rule-flow.md` 和对应正文画板。提交前使用 `pnpm test`、`pnpm lint` 与 `pnpm type-check` 作自动化验证。真实网站的翻译、导航和交互效果仍待用户完成浏览器验证；自动化检查不代表这些场景已通过。

[当前设计画布](agent-site-rules.html) 聚焦 14 个主流程和必要异常画板；[主画布](index.html) 还登记「更多展开」和「候选更新」补充状态。

## 主流程

在正在阅读的网站打开 Readomi 弹窗，选择「用 Agent 适配此网站」。所有适配操作都在该网页的一个面板内完成：

**复制 agent 指令 → agent 提交最新候选或备用粘贴 → 预览 → 保存。**

面板自动读取当前网站和 URL，问题说明可选。复制指令包含站点、相关规则、阅读设置和文档格式；用户交给支持浏览器操作的 agent。Agent 查看真实 DOM 后，在面板的「更多」里提交规则并点击「预览规则」。提交后的最新有效候选替换当前预览，不再有交付动作、设置页审核步骤、显式稿次或默认确认清单。

用户直接查看网页的 hover、网页翻译和段落样式。满意后点击「保存规则」。保存只合并此文档影响的用户规则，保留其他网站和内置开关。成功后面板收起，显示「站点规则已保存」toast，带「撤销」、「查看站点规则」可点击块和关闭按钮。保存提示已按 B 版接入 8 秒自动消失、交互暂停与 Motion 退场，查看规则直达自定义页签，详见 `site-rule-flow.md`。停止预览恢复已保存的有效规则，候选文档保留供继续编辑。

Agent 仍返回同一份可复制规则文档，供普通文本 agent、备份或其他设备使用。用户有文本时通过「已有规则？粘贴配置」打开更多，把文档粘贴后点击预览。预览和保存贯穿同一份规范化文档；复制不会包含会话、服务凭据或全量配置。

## 面板与设置的分工

桌面面板宽 352px，右下停靠；点击入口时展开。标题「适配此网站」，下面显示自动读取的 host。正常预览只保留状态、单行变更摘要、「保存规则」与「停止预览」；默认不展示 JSON、诊断、稿次和勾选任务。面板可折叠成窄条，预览时仍提示尚未保存并可停止。

「更多」使用原生 details，内含候选 JSON、预览按钮、复制规则文档、只读结构化诊断、复制诊断、重新读取和重新复制指令。改动候选文本会立即结束旧预览并禁用保存，直到最新文本成功应用预览；旧成功状态不得继续指向当前输入。错误定位需要 JSON 时可自动展开更多，并保留输入。

窄屏使用底部面板，默认折叠；展开可内部滚动，保留可见正文。扩展面板自身始终排除于翻译及站点规则。

设置页的「站点规则」只管理长期配置：内置规则的启停与查看，自定义规则逐条启停、复制和删除。「更多」中保留完整数组高级 JSON 编辑器。设置页不猜测最近网页、不建立适配会话，只显示：

> 在要适配的网站打开 Readomi 弹窗，选择「用 Agent 适配此网站」。

## 公开文档契约 v1

```json
{
  "format": "readomi-site-rule",
  "version": 1,
  "site": {
    "hosts": [
      "www.reddit.com"
    ]
  },
  "changes": [
    {
      "action": "upsert",
      "rule": {
        "id": "user-reddit-reading",
        "description": "让 Reddit 首页每帖只显示一块分段译文",
        "matches": "https://www.reddit.com/",
        "translationGroups": [
          {
            "containerSelector": "shreddit-post",
            "sourceSelectors": [
              ":scope > a[slot='title']",
              ":scope > [slot='text-body']"
            ],
            "placement": "append",
            "slot": "text-body"
          }
        ]
      }
    }
  ]
}
```

此样例是设计候选，未证明适配效果。文档规则继续使用现有 `SiteRule` 字段，执行引擎只接收这些字段。`site.hosts` 为精确主机集合，不隐式包含裸域或其他子域；`matches` 可进一步限制路径，但不得扩大到其他网站。一个文档处理一个站点，Reddit 和 Threads 分别生成和保存。

`changes` 首版支持 `upsert`（同 ID 完整替换或新增）与 `disable`（保留已有用户规则，仅设 `enabled:false`）。文档内 ID 唯一；用户规则 ID 不可冒充内置 ID；`disable` 只能指向已有用户规则。更新必须保留仍需生效的完整字段。文档不通过规则操作删除、不调整内置停用列表、不改变阅读样式或服务配置；逐条删除使用设置管理入口。

严格检查版本、未知字段、URL 范围、CSS 选择器、合并后的规则条数和大小。沿用现有规则数量、文档及 CSS 长度上限。不能把无效字段静默丢弃后当作成功预览；格式、范围、匹配和请求错误分别报告。

## 显式正文分组：translationGroups

`SiteRule` 新增 `translationGroups`，每项为 `{ containerSelector, sourceSelectors, placement?, slot? }`。
容器只负责一组；指定的 `sourceSelectors` 相对该容器选择后代 light DOM 正文，支持 `:scope`，
不穿透 Shadow DOM。先按 `sourceSelectors` 数组顺序收集，每个选择器的命中按 querySelectorAll DOM 顺序；
按节点身份去重，嵌套源只保留最外层源，避免其后代文本重复。最终保留来源列表顺序，不全局重排 DOM 顺序。
提取时保留标题、正文和正文内部的段落边界；一组一次请求，生成一个译文容器。
源选择器只选实际文字，不把图片、投票、分享、用户名及其他元数据拼入正文。

`placement` 可为 `append` 或 `after`，省略时为 `append`。`append` 将译文作为容器新增子节点，
宿主必须能显示它；未指定 `slot` 的 Shadow DOM 宿主需要可见的 default slot。
`slot` 可指定宿主已有 named slot，值必须非空白且只用于 `append`。
`after` 将同一个译文容器插到组容器之后，不能同时提供 `slot`。
选择插入位置不改变用户的竖线等阅读样式，链接行为保持独立。

不同生效规则出现相同 `containerSelector` 时，后规则覆盖前规则，源选择器不做集合合并；
`sourceSelectors: []` 可停止该组。此字段没有 `.add`/`.remove` 形式，不等同于节点/样式强制选择器。
更新用户规则时，应交付仍需生效的完整组定义。

Reddit 首页的最终目标是标题与摘录/正文整帖请求，原文完整保留后显示一个分段译文容器。
文字帖为原文→译文→actions；图片帖为原文→译文→媒体→actions。
Reddit 指定 `slot: "text-body"`，使用现有正文 named slot；标题图帖没有摘录时也使用同一槽。
等待、流式、完成统一插入原文末尾、图片之前，避免流式先在图片下方、完成后再跳回原文下方。
不再分别翻译标题和段落并各插入译文；详情本轮保持既有画板目标。
Threads 同样整帖一次请求、同一译文容器保留多段结构。首页 hover 与网页翻译共用这一分组能力。
上述示例与画板是实现目标，仍需用户做实际翻译测试。

## 首版 agent 操作协议

通过网页面板的可访问表单提供首版自动路径，不要求外部服务器、MCP、Native Messaging 或访问扩展设置 URL。Agent 可以展开更多、填入文本、预览并读取结果；持久保存由用户完成。

| 标识 | 操作 |
| --- | --- |
| `readomi-rule-session-panel` | 展开面板，读取网站与状态 |
| `readomi-rule-problem-input` | 可选问题说明 |
| `readomi-rule-instructions-action` | 复制上下文和指令 |
| `readomi-rule-more` | 展开候选和诊断 |
| `readomi-rule-document-input` | 写入同一份单站点文档 |
| `readomi-rule-preview-action` | 应用最新候选预览 |
| `readomi-rule-report` | 读取当前候选的只读报告 |
| `readomi-rule-stop-action` | 停止临时预览 |
| `readomi-rule-copy-action` | 复制规范化规则文档 |
| `readomi-rule-save-action` | 用户保存当前预览规则 |

移除 `readomi-rule-deliver-action`。正常界面不显示稿次；内部仍保留会话与版本标识，报告可包含内部关联信息供 agent 判断是否读取了当前候选。

诊断包含当前 URL/页面类型、有效匹配范围、正文计数、排除原因、译文块级或行内选择、样式、请求与展示状态及错误。竖线的样式枚举为 `line`。默认诊断不复制网页正文，不包含服务密钥；agent 在授权的网页上自行观察需要的正文。DOM 匹配数不等于翻译效果已验证，静态候选通过不等于整站通过。

复制的指令应包含当前最终 URL、精确 hosts、可选问题、扩展版本、相关内置规则及兼容处理、相关用户规则的完整内容、公开字段参考、当前阅读模式/竖线/触发方式/流式设置，以及以上 UI 控件和规则文档契约。Agent 应使用稳定且已观察的正文容器，不以全局 `span` 或取消所有排除来掩盖误匹配。无法用现有规则表达的 runtime 问题需明确报告，不生成“已修好”的假规则。

## 真实预览与内部保护

临时有效规则为「最新持久配置 + 此会话的局部事务变更」，调用现有规则解析、正文提取、请求与渲染管线。不能先全局写入 `storage.local` 再撤回模拟预览。只影响发起会话的标签页；同标签页首页/详情和动态内容使用相同候选；离站暂停，返回允许站点重新读取并应用。刷新后尝试恢复会话，恢复完成前不得保存。

UI 精简不删除内部保护：

- 对规范化完整文档计算 hash，忽略对象键顺序和空白，保留操作与数组顺序。当前输入、实际预览和保存必须绑定同一 hash。
- 每次候选、语言、路由或有效基础规则改变，都切换 generation；终止旧 hover/整页请求，清理本会话译文、站点 CSS 与修改，忽略旧 generation 的迟到结果。
- 文本编辑立即使旧预览失效，不把迟到结果当作最新候选。保存绑定用户点击时的文档；保存、停止、更新串行处理，不能以停止动作撤销已成功写入的事务。
- 相关 ID 保存前比对基础规则，避免覆盖另一设置页或标签页的修改；无关规则变化在最新列表中保留。合并后整体校验并一次写入，任意条失败均不部分保存。
- `upsert` 按 ID 原位替换，新增按文档顺序追加，`disable` 原位调整 enabled；保留无关顺序与 `disabledBuiltInRules`，不覆盖整个旧数组。
- 保存记录相关 ID 的前后值。撤销仅在当前相关值仍等于本次保存后的值时恢复；存在后来修改则报告冲突，不回滚其他网站或设置。
- 临时 DOM 与 CSS 有明确所有权；清理恢复最新已保存规则的当前页面行为，不恢复一张过时网页快照。

Hover 与网页翻译共用最终渲染逻辑和阅读样式；流式预览结束后不能从块级竖线跳回行内。站点文档不得强制覆盖用户选择的样式；段落识别与块级译文分别配置。

## 同面板的异常恢复

| 情况 | 文案与行为 | 动作 |
| --- | --- | --- |
| 候选无效 | 「候选规则无效」，指出字段，保留输入与已保存配置 | 修改配置、复制诊断 |
| 未匹配正文 | 「当前未匹配到正文」，不显示翻译成功、不允许保存未应用候选 | 重新预览、让 agent 调整 |
| 启动或翻译失败 | 显示实际原因，候选保留；请求失败和范围失败分开 | 重试预览、复制诊断 |
| 基础规则冲突 | 「此网站的规则已在别处更新」，候选保留 | 重新读取规则后预览 |
| 离站 | 「预览已暂停」，当前页面不应用目标站点规则 | 返回原网站、停止预览 |
| 刷新恢复 | 「正在恢复预览」，保存禁用 | 等待、停止预览 |
| 保存失败 | 「保存失败，预览仍然保留」，不显示已保存 toast | 重试保存、复制文档 |
| 撤销冲突 | 「规则已再次修改，无法直接撤销」，保留后来修改 | 管理站点规则 |

异常不跳到独立设置向导。独立画板用于展示同一个网页面板的不同状态。

## 实现范围与用户测试

本轮实现：严格的单站点文档和局部合并，网页面板与 popup 入口，相关上下文指令导出，最新候选预览及诊断，用户保存/撤销，逐条长期管理。保留原有高级 JSON 编辑；内置规则继续独立维护。不新增外部 API、复杂向导、默认确认清单或“交付最终稿”步骤。

实现完成后由用户在 Reddit、Threads 测试：首页 hover、详情竖线、整页翻译、滚动新帖子、同标签页路由、停止/刷新/保存/撤销，以及候选替换与错误恢复。当前候选和画面均未通过这些验证。

本地 Chrome 构建目录为 `.output/chrome-mv3`。在扩展管理页加载或重新加载该目录，再刷新目标网页；打开 Readomi 弹窗并选择「用 Agent 适配此网站」。复制指令交给 agent，或展开「更多」粘贴规则文档，点击「预览规则」。实际检查满意后由用户点击「保存规则」；保存后可立即撤销，也可在设置的「网页阅读 → 站点规则 → 自定义规则」里启停、复制和删除。

已知边界：Reddit 首页覆盖链接作为整帖分组入口，标题与摘录/正文通过 translationGroups 一次请求并展示同一块译文；当前链接/按钮的鼠标长按仍在读取规则前被事件处理跳过，规则本身不能解除。Threads 兼容处理已收窄 `.x6s0dn4.x78zum5` 的误排除并按整帖分组，双语提取同时保留自然段落边界；默认 prompt 要求返回对应段落，应用不猜测句子边界来拆分服务自行合并的输出。画板的竖线和分段是目标排版示意，不等于已完成实际翻译验证。

用户测试通过后，保留规范化文档、验证 URL/场景、限制及必要 DOM 依据，再单独维护内置库。迁入内置时清理会话数据并保留归属说明；不能根据一个页面匹配数自动推广所有用户。

## 当前画板索引

| 场景 | 画板 |
| --- | --- |
| 准备指令 | [Prepare](Page-Site-Rule-Prepare.html) |
| 网页预览 | [Reddit](Page-Site-Rule-Preview-Reddit.html)、[Threads](Page-Site-Rule-Preview-Threads.html) |
| 内置整帖展示 | [Reddit 等待](Page-Reddit-Reading-Waiting.html)、[Reddit 流式](Page-Reddit-Reading-Streaming.html)、[Reddit 完成](Page-Reddit-Reading-Ready.html)、[Threads 流式](Page-Threads-Multi-Paragraph-Streaming.html)、[Threads 完成](Page-Threads-Multi-Paragraph-Ready.html) |
| 更多与最新候选 | [More](Page-Site-Rule-More.html)、[Updated](Page-Site-Rule-Preview-Updated.html) |
| 保存成功 | [Saved](Page-Site-Rule-Saved.html) |
| 无效与零匹配 | [Invalid](Page-Site-Rule-Invalid.html)、[Blocked](Page-Site-Rule-Preview-Blocked.html) |
| 保存和并发 | [Conflict](Page-Site-Rule-Conflict.html)、[Save-Failed](Page-Site-Rule-Save-Failed.html)、[Undo-Conflict](Page-Site-Rule-Undo-Conflict.html) |
| 导航和恢复 | [Paused](Page-Site-Rule-Paused.html)、[Restoring](Page-Site-Rule-Restoring.html) |
| 入口与窄屏 | [Popup](Popup-Site-Rule-Agent.html)、[Mobile](Page-Site-Rule-Preview-Mobile.html) |
| 长期管理 | [Custom-Saved](Settings-Site-Rules-Custom-Saved.html)、[Custom-Empty](Settings-Site-Rules-Custom-Empty.html)、[Built-in](Settings-Site-Rules.html) |
| 指令内容 | [Agent 指令](Site-Rule-Agent-Instructions.html) |

以上文件与 `site-rule-flow.md` 为当前设计来源。
