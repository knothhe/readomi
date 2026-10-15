# Chrome 商店自动提交凭据

本文说明如何获取 Readomi 自动提交 Chrome Web Store 所需的四个变量，并保存到 GitHub Actions。对应工作流为 [Submit to Stores](../../.github/workflows/submit.yml)，官方资料核对日期为 2026 年 10 月 13 日。

| 变量 | 来源 |
| --- | --- |
| `CHROME_EXTENSION_ID` | Chrome 商店开发者后台中 Readomi 条目的扩展 ID |
| `CHROME_CLIENT_ID` | Google Cloud 中创建的 OAuth 客户端 ID |
| `CHROME_CLIENT_SECRET` | 同一个 OAuth 客户端的密钥 |
| `CHROME_REFRESH_TOKEN` | 使用该客户端，以商店开发者账号授权后取得的刷新令牌 |

## 1. 获取 CHROME_EXTENSION_ID

1. 打开 [Chrome 商店开发者后台](https://chrome.google.com/webstore/devconsole)，登录用于管理 Readomi 的 Google 账号。
2. 如果尚未注册开发者，先完成注册、后台要求的账号信息和 Google 两步验证。
3. 点击「新增条目 / Add new item」，上传 Readomi 的 Chrome ZIP。已有 Readomi 条目时，直接打开原条目，不要重复创建。
4. 从条目中复制「Item ID / 扩展 ID」，保存为 `CHROME_EXTENSION_ID`。它是一个 32 位小写字母串，创建草稿条目后即可取得，不必等待审核通过。

这里使用 Readomi 自己的商店条目 ID。不要填上游扩展的 ID，也不要直接使用本地加载未打包扩展时的 ID；本地 ID 是否与商店 ID 一致，需要另外核对。

参考：[首次上传与发布流程](https://developer.chrome.com/docs/webstore/publish)。

## 2. 获取 CHROME_CLIENT_ID 和 CHROME_CLIENT_SECRET

1. 进入 [Google Cloud Console](https://console.cloud.google.com/)，新建或选择一个项目。
2. 搜索 **Chrome Web Store API**，进入 API 页面并点击「启用 / Enable」。
3. 配置 **OAuth 同意屏幕 / OAuth consent screen**：填写应用名称、用户支持邮箱和开发者联系邮箱；个人账号通常选择 **External（外部）**。如果应用仍处于 **Testing** 状态，将后续用于商店授权的账号加入 **Test users（测试用户）**。
4. 创建 **OAuth 客户端 ID / OAuth client ID**，应用类型选择 **Web application（Web 应用）**，填写一个便于识别的名称，例如 `Readomi Store CI`。
5. 在 **Authorized redirect URIs（已获授权的重定向 URI）** 中添加以下地址，完整保持一致：

   ```text
   https://developers.google.com/oauthplayground
   ```

6. 创建后保存 **Client ID** 和 **Client secret**，分别作为 `CHROME_CLIENT_ID` 和 `CHROME_CLIENT_SECRET`。后续获取 Refresh token 时使用同一个客户端。

这里创建的是供发布流程使用的 Web 应用 OAuth 客户端。参考：[Chrome Web Store API 的 OAuth 设置](https://developer.chrome.com/docs/webstore/using-api#initial-setup)。

用于长期运行的 GitHub Actions 时，应先将 External OAuth 应用的发布状态切换为 **In production**，再执行下一节的授权。如果仍处于 **Testing**，本流程签发的 Refresh token 会在 **7 天后过期**；已经在 Testing 状态生成的令牌，应在切换状态后重新授权获取。OAuth 应用的发布状态与扩展在商店中的审核状态分别管理。参考：[Google 刷新令牌有效期说明](https://developers.google.com/identity/protocols/oauth2#expiration)。

## 3. 获取 CHROME_REFRESH_TOKEN

1. 打开 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)。
2. 点击右上角齿轮，勾选 **Use your own OAuth credentials**。
3. 填入上一节的 **OAuth Client ID** 和 **OAuth Client secret**。
4. 在 **Input your own scopes** 中填入：

   ```text
   https://www.googleapis.com/auth/chromewebstore
   ```

5. 点击 **Authorize APIs**，使用拥有 Readomi 商店条目管理权限的 Google 账号登录并授权。该账号可以与创建 Google Cloud 项目的账号不同。
6. 返回 Playground 后，点击 **Exchange authorization code for tokens**。
7. 复制返回的 **Refresh token**，保存为 `CHROME_REFRESH_TOKEN`。不要复制 Access token；Access token 有较短的有效期，工作流需要用 Refresh token 换取新的 Access token。

参考：[获取访问令牌和刷新令牌](https://developer.chrome.com/docs/webstore/using-api#obtain-access-and-refresh-tokens)。

## 4. 保存到 GitHub Actions

1. 打开 Readomi 的 GitHub 仓库，进入 **Settings → Secrets and variables → Actions**。
2. 点击 **New repository secret**，依次添加以下四项，名称必须与工作流一致：

   ```text
   CHROME_EXTENSION_ID
   CHROME_CLIENT_ID
   CHROME_CLIENT_SECRET
   CHROME_REFRESH_TOKEN
   ```

3. 每项的 Secret 填入对应值并保存。它们应放在 **Secrets** 中，现有工作流通过 `secrets.*` 读取。

Client secret 和 Refresh token 仅保存在私有凭据存储中，不要写入仓库、公开文档、截图或扩展 ZIP。它们是商店发布凭据，与翻译服务的模型 API Key 无关。

凭据配置完成后，仍需在商店后台补全首次上架资料。实际发布按 [RELEASING.md](../../RELEASING.md) 执行；`Submit to Stores` 的 `dryRun` 仅用于演练命令，不能证明 OAuth 凭据有效或首次上架资料完整。

返回：[Chrome 商店上架资料索引](README.md)。
