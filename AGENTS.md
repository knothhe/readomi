# AGENTS.md

## Design First

`design/` is the source of truth for everything a reader sees or does: the
popup, the in-page translation UI, the settings page, and the agent setup flow
including the setup document. Each board is a self-contained HTML file at its
designed size; `canvas.js` places the boards on one canvas, and
`design/index.html` shows that canvas. Open `design/index.html` in a browser;
nothing needs to be installed or served. Shared images, such as the logo, live
in `design/assets/`.

- Every change lands in `design/` first, then the implementation is changed to
  match it. This covers layout, states, copy, interaction flow and the setup
  document. Changes with no visible effect, such as internal refactors, tests,
  CI or dependencies, need no design change but must not make the
  implementation diverge from the design.
- A new board is a new HTML file plus its entry in `design/canvas.js`. Keep
  boards to plain HTML and CSS with no external requests, so they open the
  same way everywhere.
- The design change goes in the same pull request as the implementation, in an
  earlier commit.
- Draw real states with the real copy. Text in an artboard matches
  `src/locales/zh-CN.yml` after implementation; a new state gets its own
  artboard instead of a note.
- When the implementation and the design disagree, the design wins: change the
  implementation, or, if the design is wrong, change the design first.

### Previewing the design

- Locally, open `design/index.html`. Where a page opened from `file://` cannot
  load scripts, such as an embedded preview pane, serve the directory instead:
  `python3 -m http.server 4780 --bind 127.0.0.1 --directory design`.
- To let someone else look without a deploy, keep that server running and start
  a Cloudflare Quick Tunnel (https://try.cloudflare.com/):
  `cloudflared tunnel --url http://localhost:4780`. It prints a temporary
  `https://<random>.trycloudflare.com` address and needs no account. Anyone with
  the address can open it, so share it only with the reviewer and stop
  `cloudflared` when the review is done; the address stops working then.

## Testing Notes

- Run the local test suite with `pnpm test`.
- Locale changes also require `pnpm lint`; tests do not check YAML formatting.
  Normalize locale formatting with `pnpm exec eslint src/locales/*.yml --fix`
  and verify that the parsed message values stay unchanged.

## Version Management

- `package.json` is the version source of truth. Follow `RELEASING.md` and
  `.release.json`; use `pnpm release patch|minor|major` or an exact version to
  preview. Add `--apply` only when an actual release is requested.
- The release command runs checks, commits the version, creates an annotated
  `v<version>` tag, and atomically pushes `main` and that tag. Existing CI creates
  the GitHub Release and uploads extension archives.
- Version-management tests run with `pnpm test:release` using temporary local
  repositories. `pnpm release:chrome` only uploads to an existing Release.
