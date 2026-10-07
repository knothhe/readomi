# Readomi Chrome 商店上架资料

这套资料用于 Readomi 首次提交 Chrome Web Store，基于当前仓库代码与版本 1.2.6，核对日期为 2026 年 10 月 8 日。文案、权限说明和图片已准备；账号注册、审核测试服务和后台实际字段需要在提交前完成。生成素材不会上传商店或触发发布。

## 文件与用途

| 文件 | 用途 |
| --- | --- |
| [listing.zh-CN.md](listing.zh-CN.md) | 简体中文商店名称、短描述、长描述与链接 |
| [listing.en.md](listing.en.md) | 英文商店文案 |
| [privacy-permissions.md](privacy-permissions.md) | 单一用途、逐项权限理由、数据类型和远程代码说明 |
| [reviewer-instructions.md](reviewer-instructions.md) | 给审核人员的英文测试步骤，及待补的私有测试配置 |
| [privacy-policy.zh-CN.md](privacy-policy.zh-CN.md) | 隐私政策中文译文 |
| [../../PRIVACY.md](../../PRIVACY.md) | 正式英文隐私政策 |
| [assets.md](assets.md) | 图片尺寸、顺序、来源和重新生成方法 |
| [index.html](index.html) | 可离线打开的中英文素材预览 |
| [assets/](assets/) | 可直接上传的 PNG 图片 |

商店文案和隐私政策需随实现变化更新。本次同步了多服务管理、主要语言 / 第二语言规则、输入框翻译、单页字幕、站点停用、站点适配与缓存范围。正式英文政策与中文译文已一起更新。截图的界面来自实际构建的扩展；文章、视频背景与译文是可重复生成的示例，不代表某个模型的翻译质量。

## 提交前还需完成

- [ ] 注册 Chrome 商店开发者账号，完成后台要求的注册费用、联系方式和 Google 两步验证。
- [ ] 上传 Chrome ZIP 创建 Readomi 自己的商店条目，取得 `CHROME_EXTENSION_ID`；不要填上游扩展的 ID。
- [ ] 确认商店分配的 ID 与本地构建 ID 的关系。`wxt.config.ts` 中的公钥用于固定本地 ID，并不是上传凭证；如需本地与商店同 ID，取得商店公钥后再核对。
- [ ] 将本套资料与更新后的隐私政策推送到公开仓库，确认商店使用的隐私链接可匿名访问。
- [ ] 在商店后台填写介绍、类别、语言、支持链接、图片、单一用途、权限说明、数据声明和分发范围。
- [ ] 提供审核用服务：可公网访问的 HTTPS API 地址、可用模型、专用测试 API Key，或明确告知审核人员需要自行配置服务。测试配置仅填入后台 Test instructions 私有字段。
- [ ] 核对服务目标提示、输入框三次空格触发、可选文章上下文与导出副本的产品内告知。当前代码不在打开页面时单独请求语言识别；后台声明、政策和实际界面应一致。
- [ ] 核对自定义远程 HTTP 地址的安全处理。实现允许 HTTP 自定义端点以兼容本地模型；审核配置使用 HTTPS，远程服务的安全传输规则仍需在提交前确认。
- [ ] 用最终提交版本运行检查并实际测试语言规则、页面与输入框翻译、字幕单页开关、站点停用 / 恢复、服务切换、缓存清除、错误提示和密钥保存；重新生成对应版本的截图。
- [ ] 核对当前开发者后台字段与本资料，再提交审核。账号和商店状态未通过本次素材生成验证。

## 自动提交凭证

当前 `.github/workflows/submit.yml` 使用 `wxt submit`，需要以下 GitHub Actions repository secrets：

```text
CHROME_EXTENSION_ID
CHROME_CLIENT_ID
CHROME_CLIENT_SECRET
CHROME_REFRESH_TOKEN
```

它们是发布凭证，不是用于翻译的模型 API Key。准备好商店条目后再配置；首次资料不会由现有 CI 自动填写。Edge 凭证是可选项，Chrome 上架不需要。

按 [RELEASING.md](../../RELEASING.md) 发布版本：先用 `pnpm release patch|minor|major` 预览，实际发布时才加 `--apply`。推送新 tag 后，现有 CI 构建发布包，并在四项 Chrome 凭证齐全时提交商店审核。手动重建 Release 附件不会再次提交商店。

`pnpm release:chrome` 只重建 Chrome ZIP 并上传至既有 GitHub Release，不负责商店上架。`Submit to Stores` 的 `dryRun` 可用于演练命令，但不能证明首次上架字段已填全或审核能通过。

## 官方参考

- [首次发布流程](https://developer.chrome.com/docs/webstore/publish)
- [商店介绍字段](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [图片规范](https://developer.chrome.com/docs/webstore/images)
- [隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [API 前置条件与 OAuth 设置](https://developer.chrome.com/docs/webstore/using-api)
- [用户数据与权限政策](https://developer.chrome.com/docs/webstore/program-policies/policies)

以上链接为核对来源；后台与政策可能变化，提交时以官方当前要求为准。
