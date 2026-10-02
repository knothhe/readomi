# Readomi 审核测试说明

以下英文步骤用于 Chrome 商店 Test instructions。测试服务待发布者补充；不要将占位符当作可用配置提交。测试 API Key、地址和模型只填后台私有测试字段，不写入本文件、公开截图或 Release 附件。

## 需要补充的私有测试配置

| 项目 | 当前状态 |
| --- | --- |
| 服务提供商或兼容接口类型 | 待定 |
| 公网 HTTPS base URL | 待定；localhost 素材生成服务无法供 Google 审核访问 |
| 可用模型 ID | 待定 |
| 专用测试 API Key | 待定；需覆盖审核期，并限制额度 |
| 额外请求头或参数 | 如服务需要，再提供 |
| 有效期与额度 | 待定；不要给出无法保证的有效期 |

若选择审核人员自行提供服务，请在后台明确这一前提。审核人员是否愿意或能够提供付费凭证无法保证；专用测试服务更容易复现。

## 可复制的英文说明

Readomi is a bring-your-own-service reading extension. It has no Readomi login and no hosted translation credits. For a reproducible review, use the dedicated test service configuration provided separately in this private Test instructions field. Do not use the loopback demo service shown in the public screenshots.

1. Open Readomi Settings. If needed, select English in Settings → Appearance → Interface language. Open Translation service → Manual setup. Choose the specified provider type, enter the supplied API key and model, and the base URL for a compatible endpoint. Choose Test and save and wait for Connected. Alternatively, paste the supplied service JSON into the Agent setup configuration field and choose Apply; a coding agent is not required to use the extension.
2. Open an ordinary English article on an HTTP or HTTPS website. Open the Readomi popup, select Simplified Chinese as the target language if needed, and choose Translate this page. Translated blocks should appear next to the original text. The default shortcut is Alt+E, or Option+E on macOS.
3. In the popup, switch the Web text display mode between Bilingual and Translation only. Choose Show original to restore the page. Browser-internal pages such as chrome://extensions cannot be translated.
4. Enable Hover translation in Settings → Web reading. Select a trigger in Settings → Shortcuts; Control is suitable for this test. On the article, point to a paragraph and hold the selected key briefly. Only that paragraph should be translated. Press the trigger again over the paragraph to restore it.
5. Enable Video subtitle translation in Settings → Video subtitles. Open a YouTube video with available captions and turn its captions on, or an HTML5 video with an active subtitle track. Play the video. Readomi should show original and translated captions. The extension does not transcribe audio or create subtitles for videos without an existing track. Subtitle display mode is separate from web text display mode; size, style and position are configurable.
6. In Settings → Appearance, change the accent color or light/dark appearance. These changes affect the interface and translation markers. No service account is needed for appearance controls.
7. To test errors, enter an invalid test key or model in the service editor and choose Test and save. Readomi should display a connection failure and keep the previously saved service. Restore the working test configuration before continuing.

Privacy notes: requests go directly from the browser to the configured model service. They include the API key and text needed for translation. After configuration, page opens or navigation can also send a short text sample for source-language detection before the user clicks Translate. Page context is off by default; enabling it sends the title and main article content for a summary. Hover and subtitle translation are off by default. Settings and caches are local, and exported backups contain keys. There is no developer-operated analytics or telemetry service and no remotely hosted executable extension code.

The store screenshots use the actual built extension interface with original sample content and a deterministic local test service. They illustrate features rather than a specific provider's translation quality. The caption scene is an HTML5 sample with an existing English subtitle track.

## 后台私有配置模板

填真实值后只放入 Test instructions。这里的值均不可直接使用：

```json
{
  "type": "openai-compatible",
  "name": "Readomi review service",
  "baseURL": "https://REPLACE_WITH_REVIEW_HOST/v1",
  "apiKey": "REPLACE_WITH_REVIEW_ONLY_KEY",
  "model": "REPLACE_WITH_VERIFIED_MODEL"
}
```

若提供商不是兼容接口，按实际类型使用 `openai`、`anthropic`、`gemini` 或 `deepseek`。填值后先在最终构建中验证连接、批量翻译、语言识别和字幕翻译，再提交审核。
