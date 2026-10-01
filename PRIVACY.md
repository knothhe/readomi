# Privacy Policy

Readomi translates the web page you are reading. It has no server, no account,
no analytics, and no telemetry. The developer receives no data from it.

## What Leaves Your Browser

When you translate a page, paragraph or existing video subtitle, Readomi sends that text to the model provider
you configured, such as OpenAI, DeepSeek, or an OpenAI-compatible endpoint you
entered. If you turn on page summaries, it also sends the page title and main
content so the model can produce a summary for context. Requests go directly
from your browser to that provider, together with the API key you entered for
it. The provider handles this data under its own privacy policy.

Testing a service sends a short test request; fetching models queries the configured
service. Readomi sends no browsing history or analytics to its developer.

## What Stays in Your Browser

Readomi stores the following in the browser's local extension storage and
IndexedDB:

- Your settings, including provider endpoints, API keys, prompts, theme color and
  feature switches.
- Cached translations and page summaries, so the same text is not requested
  twice.

This data is not synced across devices. Removing the extension deletes it.

## Permissions

- `storage`: saves your settings and caches.
- `tabs`, `webNavigation`, `scripting`, and access to all sites: find the page
  you want translated, including its frames, and insert translations into it.
- `alarms`: runs periodic cache cleanup.

## Changes

Changes to this policy are recorded in this file's history at
<https://github.com/knothhe/readomi/commits/main/PRIVACY.md>.

## Contact

Report questions or problems at <https://github.com/knothhe/readomi/issues>.
