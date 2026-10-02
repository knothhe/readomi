# Privacy Policy

Last updated: October 2, 2026

Readomi is a browser reading companion that translates web pages, paragraphs and existing video subtitles. Readomi has no developer-operated translation server, account system, cloud sync, analytics or telemetry. The developer does not receive your page content, API keys or browsing history through the extension.

## Data sent to your configured service

Readomi sends requests directly from your browser to the model provider or compatible endpoint you configure. Supported providers include OpenAI, Anthropic, Google Gemini and DeepSeek, as well as compatible gateways and local models. The recipient is the service endpoint shown in your configuration; a gateway may forward requests to its own upstream providers under its terms.

Translation requests contain the page, paragraph or existing subtitle text being processed, prompts and model settings. The built-in page translation prompt can include the page title and a page summary. If you enable page context, Readomi also sends the page title and main article content to generate that summary. Custom prompts can include page title, description, content or summary according to the tokens you use.

After a service is configured, Readomi can send a short sample of page text to that service to detect the source language when a page opens or changes, even before you click Translate. The current language detection request uses up to 500 characters of cleaned text derived from the page title and page text sample.

Testing a service sends a short test request. Fetching models queries the configured service. Requests include the API key and any custom authentication headers you entered for that service. The provider can also receive ordinary network metadata, such as your IP address.

The provider handles these requests under its own privacy policy and terms. The Readomi developer does not control the provider's retention, training or access practices. Review your chosen service's policy before using it on sensitive content. Official provider endpoints use HTTPS; custom endpoints can use HTTP, including local model endpoints. Use HTTPS for remote services.

## Data kept in your browser

Readomi stores settings, provider endpoints, API keys, custom headers, prompts, language preferences, appearance preferences and feature switches in local extension storage. API keys are stored in browser extension storage, not in a separate encrypted key vault.

Translations and article summaries are cached locally in IndexedDB. Translation and summary cache entries older than seven days are eligible for cleanup, checked approximately once a day while the browser can run the extension. Cleanup can be delayed while the browser is closed or suspended.

Readomi uses temporary session storage for each tab's translation state, site origin and detected language, so it can display the correct state and restore translation on the same site. It does not build a browsing-history log or send this state to the developer. Settings and keys remain until you change them or remove the extension. Data is not synced across devices.

## Copies you choose to create

Exporting a configuration backup creates a local JSON file containing your settings, API keys and custom headers. Removing the extension does not remove exported files. Keep backups private and delete them separately when no longer needed.

The setup flow can copy service configuration or agent instructions to your clipboard. Service configuration exports mask the saved API key. If you share those instructions or a key with a coding agent or another application, that application processes what you share under its own terms. Readomi does not automatically send configuration to an agent.

## Permissions and purpose

Readomi uses storage to save configuration and reading state; tabs to identify the current reading tab and update toolbar state; scripting and webNavigation to support translation in page frames and across navigation; alarms to clean up local caches; and access to HTTP and HTTPS sites to insert translations and reach user-configured services.

These permissions support the single purpose of helping you read web content through translation and related reading controls. Readomi does not use them for advertising, profiling or sale of personal information. Model responses are treated as data; Readomi does not load remotely hosted JavaScript or WebAssembly as extension code.

## Data use and deletion

Readomi's handling of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Readomi does not sell user data or use it for personalized advertising. User content and credentials are transmitted only to the configured service as needed for the reading features described above.

Change saved settings or keys in Settings. Removing the extension removes its browser-managed local data; copies you exported or shared remain where you saved or sent them. To delete data retained by a model provider, follow that provider's procedures. If you voluntarily report a problem on GitHub, the information you submit is handled by GitHub and may be public; exclude keys and private page content.

## Changes and contact

Changes to this policy are recorded at https://github.com/knothhe/readomi/commits/main/PRIVACY.md.

For questions, contact the maintainer through https://github.com/knothhe/readomi/issues. Do not include API keys or other secrets in a public issue.
