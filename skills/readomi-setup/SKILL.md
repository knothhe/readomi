---
name: readomi-setup
description: Configure the Readomi browser extension's translation service for the user. Use when the user asks to set up, change, or fix Readomi's translation service, model or API key, or pastes a Readomi configuration or a Readomi error message.
---

# Readomi setup

Readomi supports manual configuration in settings. In this optional agent flow, you produce a JSON
document that describes the service only, verify it against the real API with
the user's key, and put it on the user's clipboard. The user pastes it into
the add or edit page within "Translation service" and saves after a connection check.
Languages, display and the prompt are the user's own settings in Readomi.

Read the guide for the document format, the recipes and the verification
templates: https://github.com/knothhe/readomi/blob/main/docs/agent-setup.md

## Steps

1. Ask which service (OpenAI, Anthropic, Gemini, DeepSeek, or an
   OpenAI-compatible endpoint such as Ollama, OpenRouter or a gateway) and
   where the API key is. If the user pasted a current configuration, change
   only what they asked.
2. Load the key into a shell variable from a file or environment variable.
   Never print it, never include it in a message.
3. Verify with the guide's `curl` template for that service, using the model
   and the `body` fields you will configure. Readomi sends the same request.
   Adjust until a request succeeds.
4. Build the document with `jq --arg k "$KEY"` and pipe it to the clipboard
   (`pbcopy`, `wl-copy`, `xclip -selection clipboard`, or `clip`). A masked
   key from an export (`sk-…a9f2`) can be returned unchanged when editing that
   service with the same type and endpoint. Adding a service or changing its
   type, endpoint or key requires a full key.
5. Tell the user to open settings → "Translation service" → "Add service",
   paste the configuration and click "Check and add". First setup opens the
   add editor automatically. To change a stored service, choose "Edit" from
   that service's actions menu and click "Check and save" after pasting.
   Readomi previews the change, confirms the connection, saves only if it
   works, and clears the clipboard. A failed check keeps the draft and the
   stored configuration.

Adding creates a separate configuration, including for another model or
account at the same endpoint, and keeps the current service unless "Use this
service after adding" is checked. The first configured service becomes
current automatically. Editing targets the service selected in the menu,
even when it is inactive, and preserves the current selection. Ask the user
to copy agent instructions from that service's editor; the add editor never
includes another service's configuration or key. Switching services affects
subsequent translation requests and keeps existing translations.

## Defaults

- OpenAI: `gpt-6-luna` with `body: { "reasoning": { "effort": "none" } }`.
- Anthropic: `claude-haiku-4-5` with `body: { "thinking": { "type": "disabled" } }`; no `temperature`.
- Gemini: `gemini-3.5-flash-lite` with `body: { "generationConfig": { "thinkingConfig": { "thinkingLevel": "minimal" } } }`.
- DeepSeek: `deepseek-flash` with `body: { "thinking": { "type": "disabled" } }`.
- Ollama / LM Studio / other compatible services: `type: "openai-compatible"`,
  `baseURL` ending in the version path, any non-empty `apiKey`, the model ID
  the service lists. Add `api: "openai-responses"` for a service that only
  speaks the Responses API (xAI).
