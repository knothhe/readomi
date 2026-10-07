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

1. Open Readomi Settings. If needed, select English in Appearance → Interface language. Open Translation service, choose Add service (or use the initial editor), then Manual setup. Enter the supplied provider type, API key, model and compatible endpoint URL. Choose Check and add or Check and save, and wait for Connected. Alternatively, use Agent setup, paste the supplied service JSON into Translation service configuration, then choose Check and add or Check and save. A coding agent is not required.
2. In Translation languages, choose Simplified Chinese as Primary language and English as Second language. Other languages translate into the primary language; primary-language content translates into the second language. Choosing Keep original for the second language preserves primary-language text without duplicate output.
3. Open an ordinary English article on an HTTP or HTTPS website. In the popup choose Translate this page (the visible button says Translate). Translations should appear alongside the original. The default shortcut is Alt+E, or Option+E on macOS. Browser-internal pages such as chrome://extensions cannot be translated.
4. Switch web display between Bilingual and Translation only in Settings → Web reading, or press Alt+M (Option+M on macOS). Choose Show original in the popup to restore the page. The compact popup has no display-mode selector.
5. Enable Hover translation in Settings → Web reading. In Shortcuts choose Control as the hover trigger. Point to an untranslated paragraph and hold Control briefly. Only that paragraph should translate; press it again over that paragraph to restore it. Multiple paragraphs can be translated independently. Streaming can be disabled if the review endpoint does not support it.
6. In an ordinary textarea or supported editable field, type “A small habit of reading”, then press Space three times rapidly (no more than 300 milliseconds between presses). Input-field translation is on by default. Wait for the text to be replaced in place; it should not submit the form. Password and read-only fields do not trigger this feature. The feature can be disabled in Settings → Web reading.
7. Open a YouTube video with captions turned on, or an HTML5 video with an active subtitle track. Enable Video subtitle translation in the popup for this page. The popup, shortcut (Alt+V / Option+V) and supported player controls change the same page switch; Settings → Video subtitles controls the default for new pages. Readomi displays original and translated captions, without audio transcription. Configure subtitle display mode, video-relative or fixed size, original/translation size ratio, background and position in Settings.
8. On an ordinary website, turn on Disable extension on this site in the popup. Translation and reading features should pause across that hostname’s open pages and translated content should restore. Turn it off to resume availability; feature selections and service/language settings are preserved. Start page translation again explicitly if needed.
9. After translating, use Clear translation cache in the popup. It clears web translations for that hostname plus subtitles and summaries for the current page, while keeping displayed translations. Settings → Translation cache → Clear all caches removes all translation and summary caches. To request fresh visible results, choose Retranslate this page in the page-translation controls.
10. If a second review service is supplied, add it and switch from the popup footer. New requests should use the selected service while existing translations remain visible. Services can be reordered in Settings. In Appearance, change the theme or accent color to check interface and translation-marker styling.
11. To test connection errors, edit a service, enter an invalid test key or model, then choose Check and save. The editor should show a failure and keep the saved service. Cancel or restore the working test configuration before continuing. Optional site adaptation is under Translation problems? → Adapt this site with an agent; it copies instructions, accepts validated site-rule JSON and provides a preview before saving, without automatically contacting an agent.

Privacy notes: requests go directly to the configured service and include applicable credentials and processed text. There is no separate language-detection request on page load; enabled page translation can continue after navigation or content changes. Web titles are included when available. Article context is off by default; enabling it sends the title and the first 2,000 article characters for a summary. Input and subtitle requests omit webpage background. Hover and subtitle translation are off by default; input-field translation is on by default. Settings and caches are local. Full backups contain API keys, headers and body parameters; service exports mask only the dedicated API key field. There is no developer-operated telemetry or remotely hosted executable extension code.

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

若提供商不是兼容接口，按实际类型使用 `openai`、`anthropic`、`gemini` 或 `deepseek`。填值后先在最终构建中验证连接、批量翻译、双语言规则、输入框翻译和字幕翻译，再提交审核。
