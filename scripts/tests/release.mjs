import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { it } from "node:test"
import { fileURLToPath } from "node:url"
import { nextVersion } from "../release.mjs"

const releaseScript = fileURLToPath(new URL("../release.mjs", import.meta.url))
const releaseNotesScript = fileURLToPath(new URL("../release-notes.mjs", import.meta.url))
const chromeScript = fileURLToPath(new URL("../release-chrome.sh", import.meta.url))
const projectConfig = JSON.parse(readFileSync(new URL("../../.release.json", import.meta.url), "utf8"))

function fixture(t, checks = []) {
  const folder = mkdtempSync(join(tmpdir(), "readomi-release-"))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const work = join(folder, "work")
  const remote = join(folder, "remote.git")
  mkdirSync(work)
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Release Test",
    GIT_AUTHOR_EMAIL: "release@example.com",
    GIT_COMMITTER_NAME: "Release Test",
    GIT_COMMITTER_EMAIL: "release@example.com",
  }
  function run(command, args, ok = true) {
    const result = spawnSync(command, args, { cwd: work, env, encoding: "utf8" })
    if (result.error)
      throw result.error
    if (ok)
      assert.equal(result.status, 0, result.stdout + result.stderr)
    return result
  }
  const git = (...args) => run("git", args).stdout.trim()
  const release = (...args) => run(process.execPath, [releaseScript, ...args], false)
  const version = () => JSON.parse(readFileSync(join(work, "package.json"), "utf8")).version
  const remoteRef = ref => git("--git-dir", remote, "rev-parse", ref)

  git("init", "--bare", remote)
  git("init", "-b", projectConfig.branch)
  git("config", "commit.gpgSign", "false")
  git("config", "tag.gpgSign", "false")
  git("config", "core.hooksPath", "/dev/null")
  writeFileSync(join(work, "package.json"), `${JSON.stringify({ name: "release-fixture", version: "1.2.0", private: true }, null, 2)}\n`)
  writeFileSync(join(work, ".release.json"), `${JSON.stringify({ ...projectConfig, checks }, null, 2)}\n`)
  writeFileSync(join(work, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  writeFileSync(join(work, ".gitignore"), ".output/\n")
  mkdirSync(join(work, "scripts"))
  copyFileSync(chromeScript, join(work, "scripts/release-chrome.sh"))
  git("add", "--", "package.json", ".release.json", "pnpm-lock.yaml", ".gitignore", "scripts/release-chrome.sh")
  git("commit", "-m", "fixture")
  git("remote", "add", projectConfig.remote, remote)
  git("push", "-u", projectConfig.remote, projectConfig.branch)
  const initial = git("rev-parse", "HEAD")
  return { folder, work, remote, env, run, git, release, version, remoteRef, initial }
}

it("release notes list commits between reachable version tags and exclude release and merge commits", (t) => {
  const f = fixture(t)
  f.git("tag", "v1.2.0")
  f.git("checkout", "-b", "feature")
  f.git("commit", "--allow-empty", "-m", "feat: translate [subtitles]")
  const featureHash = f.git("rev-parse", "--short", "HEAD")
  f.git("checkout", projectConfig.branch)
  f.git("merge", "--no-ff", "feature", "-m", "Merge feature")
  f.git("commit", "--allow-empty", "-m", "fix: preserve layout")
  const fixHash = f.git("rev-parse", "--short", "HEAD")
  f.git("commit", "--allow-empty", "-m", "chore(release): v1.2.1")
  f.git("tag", "v1.2.1")
  f.git("commit", "--allow-empty", "-m", "future change")
  f.git("tag", "v2.0.0")
  const result = f.run(process.execPath, [releaseNotesScript, "example/fixture", "v1.2.1"])
  assert.match(result.stdout, /compare\/v1\.2\.0\.\.\.v1\.2\.1/)
  assert.ok(result.stdout.includes(`- feat: translate \\[subtitles\\] (\`${featureHash}\`)`))
  assert.ok(result.stdout.includes(`- fix: preserve layout (\`${fixHash}\`)`))
  assert.doesNotMatch(result.stdout, /fixture \(|chore\(release\)|Merge feature|future change/)
})

it("release notes include history on the first release and describe an empty release", (t) => {
  const f = fixture(t)
  f.git("commit", "--allow-empty", "-m", "chore(release): v1.2.0")
  f.git("tag", "v1.2.0")
  const first = f.run(process.execPath, [releaseNotesScript, "example/fixture", "v1.2.0"])
  assert.match(first.stdout, /commits\/v1\.2\.0/)
  assert.match(first.stdout, /- fixture \(`/)
  assert.doesNotMatch(first.stdout, /chore\(release\)/)
  f.git("commit", "--allow-empty", "-m", "chore(release): v1.2.1")
  f.git("tag", "v1.2.1")
  const empty = f.run(process.execPath, [releaseNotesScript, "example/fixture", "v1.2.1"])
  assert.match(empty.stdout, /No changes since the previous release/)
})

it("previews without changing files, running checks or creating refs", (t) => {
  const f = fixture(t, [[process.execPath, "-e", "process.exit(3)"]])
  const result = f.release("patch")
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, "preview")
  assert.equal(plan.target, "1.2.1")
  assert.equal(plan.github_release, false)
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
  assert.equal(f.git("status", "--porcelain"), "")
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("allows pnpm configuration without workspace packages", (t) => {
  const f = fixture(t)
  const config = "allowBuilds:\n  esbuild: true\n  msw: false\n"
  writeFileSync(join(f.work, "pnpm-workspace.yaml"), config)
  f.git("add", "pnpm-workspace.yaml")
  f.git("commit", "-m", "configure dependency builds")
  const result = f.release("patch", "--apply", "--no-push", "--no-github-release")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.version(), "1.2.1")
  assert.equal(readFileSync(join(f.work, "pnpm-workspace.yaml"), "utf8"), config)
  assert.equal(f.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), "package.json")
})

it("rejects multi-package workspaces before changing versions or refs", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.work, "pnpm-workspace.yaml"), "packages:\n  - packages/*\nallowBuilds:\n  esbuild: true\n")
  f.git("add", "pnpm-workspace.yaml")
  f.git("commit", "-m", "configure workspace packages")
  const head = f.git("rev-parse", "HEAD")
  const result = f.release("patch", "--apply", "--no-push", "--no-github-release")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Workspace\/monorepo detected/)
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("rev-parse", "HEAD"), head)
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("commits only the version, creates an annotated tag and atomically pushes both refs", (t) => {
  const f = fixture(t, [[process.execPath, "-e", "if (require('./package.json').version !== '1.2.0') process.exit(3); console.log('Release check ran before bump')"]])
  const result = f.release("minor", "--apply")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Release check ran before bump/)
  assert.equal(f.version(), "1.3.0")
  assert.equal(f.git("log", "-1", "--format=%s"), "chore(release): v1.3.0")
  assert.equal(f.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), "package.json")
  assert.equal(f.git("cat-file", "-t", "v1.3.0"), "tag")
  assert.equal(f.remoteRef("v1.3.0^{commit}"), f.git("rev-parse", "HEAD"))
  assert.equal(f.remoteRef(projectConfig.branch), f.git("rev-parse", "HEAD"))
  assert.equal(f.git("status", "--porcelain"), "")
  assert.equal(readFileSync(join(f.work, "pnpm-lock.yaml"), "utf8"), "lockfileVersion: '9.0'\n")
})

it("rejects untracked work and a different branch before changing the version", (t) => {
  const f = fixture(t)
  const untracked = join(f.work, "unfinished.txt")
  writeFileSync(untracked, "keep this work")
  assert.match(f.release("patch", "--apply").stderr, /Working tree must be clean/)
  assert.equal(readFileSync(untracked, "utf8"), "keep this work")
  rmSync(untracked)
  f.git("checkout", "-b", "feature")
  assert.match(f.release("patch", "--apply").stderr, /Release must run on branch main/)
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("stops a failed check before changing the version, commit, tag or remote", (t) => {
  const f = fixture(t, [[process.execPath, "-e", "process.exit(3)"]])
  const originalPackage = readFileSync(join(f.work, "package.json"), "utf8")
  const result = f.release("patch", "--apply")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Check failed/)
  assert.equal(f.version(), "1.2.0")
  assert.equal(readFileSync(join(f.work, "package.json"), "utf8"), originalPackage)
  assert.equal(f.git("status", "--porcelain"), "")
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("preserves unexpected files from a successful check and stops before bumping", (t) => {
  const f = fixture(t, [[process.execPath, "-e", "require('node:fs').writeFileSync('check-output.txt', 'keep this output')"]])
  const result = f.release("patch", "--apply")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Checks changed the working tree/)
  assert.equal(readFileSync(join(f.work, "check-output.txt"), "utf8"), "keep this output")
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("preserves version-file edits made by a check without overwriting them with a bump", (t) => {
  const f = fixture(t, [[process.execPath, "-e", "const fs = require('node:fs'); const pkg = require('./package.json'); pkg.checkOutput = 'keep'; fs.writeFileSync('package.json', JSON.stringify(pkg))"]])
  const result = f.release("patch", "--apply")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /A check changed version files/)
  assert.equal(f.version(), "1.2.0")
  assert.equal(JSON.parse(readFileSync(join(f.work, "package.json"), "utf8")).checkOutput, "keep")
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("preserves changes staged by a check and stops before bumping", (t) => {
  const f = fixture(t, [
    [process.execPath, "-e", "require('node:fs').appendFileSync('.gitignore', 'check-output/\\n')"],
    ["git", "add", ".gitignore"],
  ])
  const result = f.release("patch", "--apply")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /A check staged changes/)
  assert.equal(f.git("diff", "--cached", "--name-only"), ".gitignore")
  assert.match(readFileSync(join(f.work, ".gitignore"), "utf8"), /check-output\//)
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("preserves a commit created by a check and stops before bumping", (t) => {
  const f = fixture(t, [["git", "commit", "--allow-empty", "-m", "check side effect"]])
  const result = f.release("patch", "--apply")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /A check changed HEAD/)
  assert.equal(f.git("log", "-1", "--format=%s"), "check side effect")
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("preserves a branch selected by a check and stops before bumping", (t) => {
  const f = fixture(t, [["git", "checkout", "-b", "check-branch"]])
  const result = f.release("patch", "--apply")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /A check changed branches/)
  assert.equal(f.git("branch", "--show-current"), "check-branch")
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
  assert.equal(f.git("tag"), "")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
})

it("refuses a conflicting remote tag without updating the version", (t) => {
  const f = fixture(t)
  f.git("tag", "-a", "v1.2.1", "-m", "existing release")
  f.git("push", projectConfig.remote, "refs/tags/v1.2.1")
  const originalTag = f.remoteRef("refs/tags/v1.2.1")
  f.git("tag", "-d", "v1.2.1")
  assert.match(f.release("patch", "--apply").stderr, /Remote tag already exists/)
  assert.equal(f.version(), "1.2.0")
  assert.equal(f.remoteRef("refs/tags/v1.2.1"), originalTag)
})

it("resumes the exact release after atomic push rejection without a second bump", (t) => {
  const f = fixture(t, [[process.execPath, "-e", "if (require('./package.json').version !== '1.2.0') process.exit(3)"]])
  const hook = join(f.remote, "hooks/pre-receive")
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 })
  assert.notEqual(f.release("patch", "--apply").status, 0)
  assert.equal(f.version(), "1.2.1")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
  assert.equal(f.git("--git-dir", f.remote, "tag"), "")
  const head = f.git("rev-parse", "HEAD")
  rmSync(hook)
  const result = f.release("1.2.1", "--resume", "--apply")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.git("rev-parse", "HEAD"), head)
  assert.equal(f.remoteRef(projectConfig.branch), head)
  assert.equal(f.remoteRef("v1.2.1^{commit}"), head)
})

it("creates a local release and later resumes its push", (t) => {
  const f = fixture(t)
  const local = f.release("major", "--apply", "--no-push", "--no-github-release")
  assert.equal(local.status, 0, local.stderr)
  assert.equal(f.version(), "2.0.0")
  assert.equal(f.remoteRef(projectConfig.branch), f.initial)
  const pushed = f.release("2.0.0", "--resume", "--apply")
  assert.equal(pushed.status, 0, pushed.stderr)
  assert.equal(f.remoteRef("v2.0.0^{commit}"), f.git("rev-parse", "HEAD"))
})

it("rejects a lower, identical or metadata-only version", () => {
  for (const target of ["1.1.0", "1.2.0", "1.2.0+build"])
    assert.throws(() => nextVersion("1.2.0", target), /greater SemVer precedence/)
  assert.equal(nextVersion("1.3.0-rc.1", "1.3.0"), "1.3.0")
})

it("Chrome upload stops before building when the matching release does not exist", (t) => {
  const f = fixture(t)
  f.git("tag", "-a", "v1.2.0", "-m", "Release v1.2.0")
  const bin = join(f.folder, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "gh"), "#!/bin/sh\ncase \"$1 $2\" in\n  'auth status') exit 0 ;;\n  'repo view') echo example/fixture ;;\n  'release view') exit 1 ;;\n  *) echo 'Unexpected GitHub write' >&2; exit 99 ;;\nesac\n", { mode: 0o755 })
  writeFileSync(join(bin, "pnpm"), "#!/bin/sh\necho 'Build must not run' >&2\nexit 99\n", { mode: 0o755 })
  f.env.PATH = `${bin}:${f.env.PATH}`
  const result = f.run("bash", [join(f.work, "scripts/release-chrome.sh")], false)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GitHub Release 'v1.2.0' is not available/)
  assert.doesNotMatch(result.stderr, /Build must not run|Unexpected GitHub write/)
  assert.equal(f.git("rev-parse", "HEAD"), f.initial)
})

it("Chrome upload uses the readomi ZIP even when a legacy ZIP exists", (t) => {
  const f = fixture(t)
  f.git("tag", "-a", "v1.2.0", "-m", "Release v1.2.0")
  const bin = join(f.folder, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "gh"), `#!/bin/sh
case "$1 $2" in
  'auth status'|'release view') exit 0 ;;
  'repo view') echo example/fixture ;;
  'release upload') printf '%s\\n' "$@" > .output/upload-args.txt ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 })
  writeFileSync(join(bin, "pnpm"), `#!/bin/sh
mkdir -p .output
touch .output/readomi-1.2.0-chrome.zip .output/readomiextension-1.2.0-chrome.zip
`, { mode: 0o755 })
  f.env.PATH = `${bin}:${f.env.PATH}`
  f.run("bash", [join(f.work, "scripts/release-chrome.sh")])
  assert.equal(readFileSync(join(f.work, ".output/upload-args.txt"), "utf8"), "release\nupload\nv1.2.0\n.output/readomi-1.2.0-chrome.zip\n--repo\nexample/fixture\n--clobber\n")
  assert.equal(f.git("status", "--porcelain"), "")
})
