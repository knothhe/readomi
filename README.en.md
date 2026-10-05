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

For development, install builds into a stable local directory:

```bash
cp .install-local.example.json .install-local.json
# Edit .install-local.json with each browser's parent directory and the plugin name
pnpm install:local           # Configured browser, defaulting to Chrome
pnpm install:local chrome
pnpm install:local firefox
pnpm install:local edge
# Override the configured directory
pnpm install:local --browser chrome --dir "~/Extensions/chrome" --name readomi
```

Git ignores `.install-local.json`. Set `browser`, `name` and `directories` as shown in
[.install-local.example.json](./.install-local.example.json). Paths support `~/`;
relative paths resolve from the repository root. Use `--config <file>` to select another config.
`directories` and `--dir` specify the **parent directory**. `name` is the plugin subdirectory name, defaults to `readomi`, and can be overridden with `--name`.
For example, parent `~/Extensions/chrome` and name `readomi` install to `~/Extensions/chrome/readomi/`, preserving other files and plugins in the parent.
The command builds the selected browser's MV3 extension, updates only that plugin subdirectory and removes obsolete build files inside it.
If the existing plugin subdirectory belongs to another installation or browser, it shows the full path and asks whether to overwrite **that plugin subdirectory** with `Y/n`.
Enter or `Y` confirms; `n` or closed input cancels without building or changing files. Subsequent updates for the same project and browser need no further confirmation.
The plugin subdirectory cannot overlap the repository or `.output/`. Files installed directly into the parent by the old command are preserved, without automatic deletion or migration.
Load the plugin subdirectory in the browser once (its `manifest.json` in Firefox), then reload the extension after updates.
Firefox loading is temporary and must be repeated after restarting the browser.

In Settings → Translation service, enter and test your service manually, or copy the instructions for an agent and paste its verified configuration. See the [setup guide](./docs/agent-setup.md) and optional [readomi-setup skill](./skills/readomi-setup/SKILL.md). Click "Translate this page" or press `Alt+E` (`Option+E` on Mac); repeat to restore the original.

New installations translate other languages into Simplified Chinese and preserve Chinese originals; existing language settings are kept. Retry failed paragraphs or retranslate the page from the popup. The trash icon clears only the current page’s cache, with an explanation on hover. Clear all text, subtitle and summary caches in Settings → Backup & cache. Article context is in Settings → Translation quality, and site repair is under “Translation problems?” in the popup.

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
