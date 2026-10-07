# Readomi English store listing

Copy the fields below into the English listing. Use the screenshots in `assets/en/`. Choose a reading or language category under Productivity if offered by the current dashboard.

## Name

Readomi

## Short description

A reading companion with web, paragraph and subtitle translation.

This matches `extDescription` in `src/locales/en.yml`. The name and short description come from the localized manifest in the uploaded package.

## Detailed description

Readomi is a browser reading companion focused on translation. Translations appear in the page you are reading, in bilingual or translation-only mode, so you can keep reading in place.

TRANSLATION BUILT AROUND READING
• Translate web pages while preserving their layout and prioritizing visible content.
• Switch between bilingual and translation-only views, or restore the original text.
• Optionally translate one paragraph by pointing to it and pressing your configured trigger key.
• Translate enabled YouTube captions and HTML5 subtitle tracks. Adjust subtitle size, style and position.
• Translate a draft in place by pressing Space three times in an editable field; the extension does not submit the form.
• Optionally bold the beginnings of English words to suit your reading preference.

CHOOSE YOUR OWN SERVICE
Use OpenAI, Anthropic, Gemini, DeepSeek, a compatible API or a local model. Configure and test the service manually, or copy the setup instructions for your coding agent to verify a service and prepare its configuration. Add and reorder multiple services and switch from the popup. Existing translations remain visible; new requests use the selected service. Discover models and customize prompts and request parameters.

MAKE IT YOURS
Choose a primary and second language: other languages translate into your primary language, while primary-language text can translate into your second language or stay unchanged. Toggle subtitles for the current page, disable the extension on a specific site, and use built-in site rules or preview and save rules prepared by your agent. Clear web translations for the current domain and subtitles and summaries for the current page from the popup, or clear all translation caches in Settings. Configure shortcuts and page translation styles. Choose light, dark or system appearance and one of four accent colors. The interface supports several languages, including English and Simplified Chinese. Import and export settings locally.

BEFORE YOU START
Readomi does not include a hosted translation service. You need your own model service and API key, or a working local model endpoint. Third-party providers may charge for usage and process requests under their own policies. Readomi does not supply credits or guarantee compatibility with every custom endpoint.

Page, paragraph, editable-field and existing subtitle text goes directly to your configured service. Source language is determined within translation requests, without a separate detection request on page load. Once page translation is enabled, new content and navigation within the same site can cause further requests. Web translation includes the page title when available. Enabling article context sends the title and the first 2,000 characters of article text for a summary; custom prompts can also include the page description or truncated text. Input and subtitle translation omit webpage background. Review the privacy policy and your provider's policy.

Settings, API keys and caches stay in your browser and are not synced to a developer server. Readomi has no account system, analytics or telemetry. Full backups contain API keys, custom headers and body parameters. Service exports and agent setup instructions mask only the dedicated API key field, so keep these copies private.

Hover and video subtitle translation are off by default. Input-field translation is on by default and can be disabled in Settings. Video translation requires existing captions and does not transcribe videos without subtitles. Chrome internal pages and other browser-restricted pages cannot display injected translations.

ORIGINS AND CUSTOMIZATION
Readomi is adapted from Xuanwo/jiandao and mengxi-ream/read-frog. It primarily removes Read Frog's floating toolbar, text-to-speech, custom AI actions, hosted accounts, configuration sync, analytics and other features, while adding features I need on top of jiandao. I want to keep the features as simple as possible and provide a localized user experience, so I have customized it around my own experience.

Another important reason is that I believe, in the AI era, anyone can customize basic capabilities such as translation to suit their needs. If you like the streamlined features Readomi currently offers, you are welcome to use it. If you need features that Readomi intentionally removed from Read Frog, you can use Read Frog or other similar products.

Thank you to Read Frog and jiandao for their open-source contributions. Without them, there would be no Readomi.

Readomi is independently maintained. It is not affiliated with or officially partnered with either upstream team.

Source and support: https://github.com/knothhe/readomi
Privacy policy: https://github.com/knothhe/readomi/blob/main/PRIVACY.md

## Links and distribution notes

| Field | Suggested value |
| --- | --- |
| Homepage | https://github.com/knothhe/readomi |
| Support | https://github.com/knothhe/readomi/issues |
| Privacy policy | https://github.com/knothhe/readomi/blob/main/PRIVACY.md |
| Setup guide | https://github.com/knothhe/readomi/blob/main/docs/agent-setup.md |
| Price | Extension is free; users pay any charges from their chosen model provider |

The updated privacy policy must be pushed to the public repository before its URL represents this version. A GitHub repository link is not proof of verified domain ownership. Choose countries and visibility in the dashboard before submission.
