<p align="center"><img src=".github/assets/logo.png" alt="Readomi icon" width="128"></p>
<h1 align="center">Readomi</h1>
<p align="center">Make text easier to read · <a href="./README.md">简体中文</a></p>

Readomi is a local-first reading companion focused on translation. Translations appear in the page you are reading, in bilingual or translation-only mode, so you can keep reading in place.

## Origins

Fork chain: **[Read Frog](https://github.com/mengxi-ream/read-frog) → [Jiandao](https://github.com/Xuanwo/jiandao) → [Readomi](https://github.com/knothhe/readomi)**.

Readomi directly forks Jiandao, which forks Read Frog. Thanks to the authors and contributors of both upstream projects. Readomi is independently maintained and developed in this repository, with its own product direction, releases and support. It is not affiliated with or officially partnered with either upstream team.

## Features

- **Built around reading:** page translation prioritizes visible paragraphs and preserves layout. Optional paragraph hover translation, existing video subtitle translation and bold English word starts.
- **Your choice of model:** OpenAI, Anthropic, Gemini, DeepSeek, compatible APIs and local models. Requests go directly from your browser to your configured service.
- **Flexible setup:** configure manually or use a coding agent to verify a service. Model discovery, configurable shortcuts, custom prompts and local configuration backups.
- **A distinct identity:** Terra is the default theme. Choose Plum, Amber or Teal in Settings → Appearance; interface accents, translation markers and the toolbar icon change together. Choose Light, Dark or System in Settings → Appearance; System is the default.
- **Local first:** no account, cloud sync or hosted translation service. Settings, keys and caches stay in the browser. See the [privacy policy](./PRIVACY.md).

Video translation uses enabled YouTube captions or HTML5 subtitle tracks; it does not transcribe videos without captions. Hover and subtitle translation are off by default.

## Install and use

Download an available Chrome build from this repository's [Releases](https://github.com/knothhe/readomi/releases), unzip it, enable Developer mode in `chrome://extensions`, and select "Load unpacked". Edge uses `edge://extensions`. Or build from source:

```bash
git clone https://github.com/knothhe/readomi.git
cd readomi
pnpm install
pnpm build           # Chrome
pnpm build:edge      # Edge
pnpm build:firefox   # Firefox
```

Load the corresponding directory under `.output/` in Chrome or Edge. In Firefox, temporarily load its `manifest.json` at `about:debugging#/runtime/this-firefox`.

In Settings → Translation service, enter and test your service manually, or copy the instructions for an agent and paste its verified configuration. See the [setup guide](./docs/agent-setup.md) and optional [readomi-setup skill](./skills/readomi-setup/SKILL.md). Click "Translate this page" or press `Alt+E` (`Option+E` on Mac); repeat to restore the original.

Readomi has its own extension identity and can coexist with upstream installations.

## Development and feedback

```bash
pnpm dev
pnpm test
pnpm type-check
pnpm build
```

`design/` is the UI source of truth; open [design/index.html](./design/index.html) directly. Run browser tests with `pnpm test:e2e`; first install Chromium with `pnpm exec playwright-core install --no-shell chromium`.

Send questions and suggestions to [Readomi Issues](https://github.com/knothhe/readomi/issues). Readomi inherits upstream's GNU GPL v3 license; see [LICENSE](./LICENSE).

## Version management

Use `pnpm release patch` (or `minor` / `major`) to preview a version update. Add
`--apply` to run checks, commit the version, create a tag and push. Existing CI
publishes the GitHub Release and extension archives. See [RELEASING.md](./RELEASING.md)
for version selection, initial setup and recovery instructions (in Chinese).
