#!/usr/bin/env node
// Single-package SemVer releases. Node.js 18+, Git; gh only when selected.
// .mjs works in both CommonJS and ESM projects without extra dependencies.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import process from "node:process"
import { pathToFileURL } from "node:url"

function requireThat(condition, message) {
  if (!condition)
    throw new Error(message)
}
function run(args, check = true, inherit = false, input) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: "utf8", stdio: inherit ? "inherit" : "pipe", input,
  })
  if (result.error)
    throw result.error
  if (check && result.status !== 0)
    throw new Error(`Command failed: ${args.join(" ")}\n${(result.stderr ?? "").trim()}`)
  return result
}
const git = (...args) => run(["git", ...args]).stdout.trim()
const read = name => fs.readFileSync(name, "utf8")
const readJSON = name => JSON.parse(read(name))
const object = value => value !== null && typeof value === "object" && !Array.isArray(value)

export function parse(version) {
  const match = typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Z.-]+))?(?:\+([0-9A-Z.-]+))?$/i.exec(version)
  requireThat(match && match[0] === version, `Invalid SemVer: ${version}`)
  const [, major, minor, patch, pre, build] = match
  for (const group of [pre, build]) {
    if (group !== undefined)
      requireThat(group.split(".").every(Boolean), `Empty SemVer identifier: ${version}`)
  }
  if (pre)
    requireThat(pre.split(".").every(x => !/^0\d+$/.test(x)), `Leading zero in prerelease: ${version}`)
  return { core: [major, minor, patch].map(BigInt), pre }
}
function compare(a, b) {
  const left = parse(a)
  const right = parse(b)
  const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0
  for (let i = 0; i < 3; i++) {
    const result = cmp(left.core[i], right.core[i])
    if (result)
      return result
  }
  if (left.pre === undefined || right.pre === undefined)
    return cmp(left.pre === undefined, right.pre === undefined)
  const l = left.pre.split(".")
  const r = right.pre.split(".")
  for (let i = 0; i < Math.min(l.length, r.length); i++) {
    const ln = /^\d+$/.test(l[i])
    const rn = /^\d+$/.test(r[i])
    const result = ln && rn ? cmp(BigInt(l[i]), BigInt(r[i])) : ln !== rn ? (ln ? -1 : 1) : cmp(l[i], r[i])
    if (result)
      return result
  }
  return cmp(l.length, r.length)
}
export function nextVersion(current, bump) {
  const { core, pre } = parse(current)
  const index = ["major", "minor", "patch"].indexOf(bump)
  let target = bump
  if (index !== -1) {
    requireThat(pre === undefined, "For a prerelease, specify the exact next version (for example 1.2.0).")
    core[index] += 1n
    core.fill(0n, index + 1)
    target = core.join(".")
  }
  requireThat(compare(target, current) > 0, "New version must have greater SemVer precedence; build metadata alone is not an upgrade.")
  return target
}
function jsonText(name, data) {
  const indent = /\n([ \t]+)"/.exec(read(name))?.[1] ?? 2
  return `${JSON.stringify(data, null, indent)}\n`
}
function versionFiles(config) {
  const filename = config.version_file ?? (fs.existsSync("package.json") ? "package.json" : "VERSION")
  requireThat(["package.json", "VERSION"].includes(filename), "version_file must be package.json or VERSION.")
  requireThat(fs.existsSync(filename) && fs.lstatSync(filename).isFile(), `Missing or symlinked version file: ${filename}`)
  const pkg = fs.existsSync("package.json") ? readJSON("package.json") : null
  requireThat(!pkg?.workspaces && !fs.existsSync("pnpm-workspace.yaml"), "Workspace/monorepo detected. Use the project release system or adapt explicitly; this helper supports one package.")
  if (filename === "VERSION") {
    requireThat(pkg === null, "For a Node project use package.json as the source of truth, not VERSION.")
    const current = read(filename).trim()
    parse(current)
    return [current, new Map([[filename, null]])]
  }
  const current = pkg.version
  parse(current)
  const files = new Map([[filename, pkg]])
  for (const name of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (!fs.existsSync(name))
      continue
    requireThat(!fs.lstatSync(name).isSymbolicLink(), `Symlink not supported: ${name}`)
    const lock = readJSON(name)
    requireThat(lock.version === current, `${name} version differs from package.json.`)
    requireThat([1, 2, 3].includes(lock.lockfileVersion), `Unsupported lockfile: ${name}`)
    if ([2, 3].includes(lock.lockfileVersion))
      requireThat(lock.packages?.[""]?.version === current, `${name} root package version differs from package.json.`)
    files.set(name, lock)
  }
  return [current, files]
}
function clean() {
  requireThat(!git("status", "--porcelain", "--untracked-files=all"), "Working tree must be clean, including untracked files. Review and commit your changes first.")
}
export function githubRepo(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)
  requireThat(match, "GitHub Release requires a standard github.com remote URL; aliases/Enterprise need explicit adaptation.")
  return match[1]
}
function releaseNotes(repo, prefix, target, sourceHead, tag) {
  const previous = git("tag", "--merged", sourceHead, "--list").split("\n").filter(Boolean).filter(name => name.startsWith(prefix)).filter((name) => {
    try {
      return compare(name.slice(prefix.length), target) < 0
    }
    catch {
      return false
    }
  }).sort((a, b) => compare(b.slice(prefix.length), a.slice(prefix.length)))[0]
  const range = previous ? `${previous}..${sourceHead}` : sourceHead
  const commits = git("log", "--no-merges", "--format=%h%x1f%s", range).split("\n").filter(Boolean).map(line => line.split("\x1F")).filter(([, subject]) => !subject.startsWith("chore(release): "))
  const path = previous
    ? `compare/${encodeURIComponent(previous)}...${encodeURIComponent(tag)}`
    : `commits/${encodeURIComponent(tag)}`
  const entries = commits.length
    ? commits.map(([hash, subject]) => `- ${subject.replace(/[\\`*_{}[\]()#+.!|>~-]/g, "\\$&")} (\`${hash}\`)`).join("\n")
    : "- No changes since the previous release."
  return `**Full Changelog**: https://github.com/${repo}/${path}\n\n### Commits\n\n${entries}\n`
}
function argumentsFor(argv) {
  const args = { apply: false, noPush: false, resume: false }
  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true
    }
    else if (arg === "--no-push") {
      args.noPush = true
    }
    else if (arg === "--resume") {
      args.resume = true
    }
    else if (["--github-release", "--no-github-release"].includes(arg)) {
      const value = arg === "--github-release"
      requireThat(args.github === undefined || args.github === value, "GitHub Release flags are mutually exclusive.")
      args.github = value
    }
    else {
      requireThat(!arg.startsWith("-") && args.version === undefined, `Unexpected argument: ${arg}`)
      args.version = arg
    }
  }
  requireThat(args.version, "Expected major, minor, patch, or exact SemVer. Use --help for usage.")
  return args
}
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node scripts/release.mjs <major|minor|patch|version> [--apply] [--no-push] [--github-release|--no-github-release] [--resume]\nDefaults to preview. --resume requires the exact existing release version.")
    return
  }
  const args = argumentsFor(argv)
  process.chdir(git("rev-parse", "--show-toplevel"))
  const config = fs.existsSync(".release.json") ? readJSON(".release.json") : {}
  requireThat(object(config), ".release.json must contain an object.")
  requireThat(Object.keys(config).every(k => ["version_file", "branch", "remote", "tag_prefix", "checks", "github_release"].includes(k)), "Unknown .release.json field.")
  const { branch = "main", remote = "origin", tag_prefix: prefix = "v", checks = [] } = config
  for (const [name, value] of [["branch", branch], ["remote", remote], ["tag_prefix", prefix]]) {
    requireThat(typeof value === "string" && (value || name === "tag_prefix") && !value.startsWith("-"), `Invalid ${name}.`)
  }
  const github = args.github ?? config.github_release ?? false
  requireThat(typeof github === "boolean", "github_release must be boolean.")
  requireThat(!(github && args.noPush), "GitHub Release requires pushing. Use --no-github-release with --no-push.")
  requireThat(Array.isArray(checks) && checks.every(c => Array.isArray(c) && c.length && c.every(s => typeof s === "string" && s)), "checks must be arrays of command arguments.")
  clean()
  requireThat(git("symbolic-ref", "--quiet", "--short", "HEAD") === branch, `Release must run on branch ${branch}.`)
  const head = git("rev-parse", "HEAD")
  const [current, files] = versionFiles(config)
  for (const name of files.keys()) git("ls-files", "--error-unmatch", "--", name)
  const target = args.resume ? args.version : nextVersion(current, args.version)
  parse(target)
  const tag = prefix + target
  git("check-ref-format", `refs/tags/${tag}`)
  const tagExists = run(["git", "show-ref", "--verify", "--quiet", `refs/tags/${tag}`], false).status === 0
  if (args.resume) {
    requireThat(current === target && tagExists, "Resume requires the exact current version and an existing local tag.")
    requireThat(git("rev-parse", `${tag}^{commit}`) === head, "Resume tag must point to HEAD.")
    requireThat(git("cat-file", "-t", `refs/tags/${tag}`) === "tag", "Resume requires an annotated tag.")
    requireThat(git("log", "-1", "--format=%s") === `chore(release): ${tag}`, "HEAD is not the expected release commit.")
  }
  else {
    requireThat(!tagExists, `Tag already exists: ${tag}. Use --resume with the exact version after a partial release.`)
  }
  let url
  if (!args.noPush) {
    const urls = git("remote", "get-url", "--push", "--all", remote).split("\n")
    requireThat(urls.length === 1 && urls[0], "Exactly one push URL is required.")
    url = urls[0]
    const refs = new Map(git("ls-remote", url, `refs/heads/${branch}`, `refs/tags/${tag}`).split("\n").filter(Boolean).map((line) => {
      const [sha, ref] = line.split(/\s+/)
      return [ref, sha]
    }))
    const remoteHead = refs.get(`refs/heads/${branch}`)
    requireThat(remoteHead, `Remote branch ${branch} is missing; establish the branch before releasing.`)
    requireThat(run(["git", "merge-base", "--is-ancestor", remoteHead, head], false).status === 0, "Remote branch is ahead/diverged or unavailable locally. Fetch and reconcile before releasing.")
    const remoteTag = refs.get(`refs/tags/${tag}`)
    if (remoteTag)
      requireThat(args.resume && remoteTag === git("rev-parse", `refs/tags/${tag}`), "Remote tag already exists with a different release; never overwrite it.")
  }
  const repo = github ? githubRepo(url) : null
  const notes = github ? releaseNotes(repo, prefix, target, args.resume ? `${head}^` : head, tag) : null
  console.log(JSON.stringify({ mode: args.apply ? "execute" : "preview", current, target, branch, remote, tag, files: [...files.keys()], checks: args.resume ? [] : checks, push: !args.noPush, github_release: github, github_repo: repo, release_notes: notes, resume: args.resume }, null, 2))
  if (!args.apply)
    return
  if (github)
    run(["gh", "auth", "status", "--hostname", "github.com"])
  if (!args.resume) {
    const originalVersions = new Map([...files.keys()].map(name => [name, read(name)]))
    for (const command of checks) requireThat(run(command, false, true).status === 0, `Check failed: ${command.join(" ")}. Stopped before updating the version or creating a release commit/tag.`)
    requireThat(git("rev-parse", "HEAD") === head, "A check changed HEAD. Inspect repository before continuing.")
    requireThat(git("symbolic-ref", "--short", "HEAD") === branch, "A check changed branches.")
    requireThat(!git("diff", "--cached", "--name-only"), "A check staged changes. Inspect repository before continuing.")
    requireThat([...originalVersions].every(([name, content]) => fs.existsSync(name) && fs.lstatSync(name).isFile() && read(name) === content), "A check changed version files. Inspect and resolve manually before retrying.")
    requireThat(!git("status", "--porcelain", "--untracked-files=all"), "Checks changed the working tree. Inspect and resolve manually before retrying.")
    for (const [name, data] of files) {
      if (data === null) {
        fs.writeFileSync(name, `${target}\n`)
      }
      else {
        data.version = target
        if (name !== "package.json" && data.packages?.[""])
          data.packages[""].version = target
        fs.writeFileSync(name, jsonText(name, data))
      }
    }
    const changed = git("diff", "--name-only").split("\n").filter(Boolean)
    requireThat(changed.length === files.size && changed.every(name => files.has(name)) && !git("ls-files", "--others", "--exclude-standard"), "Unexpected changes after updating the version. Inspect and resolve manually before retrying.")
    requireThat(versionFiles(config)[0] === target, "Release version differs from the target.")
    git("add", "--", ...files.keys())
    git("commit", "-m", `chore(release): ${tag}`)
    clean()
    requireThat(git("symbolic-ref", "--short", "HEAD") === branch, "A hook changed branches.")
    requireThat(versionFiles(config)[0] === target, "A commit hook changed the version.")
    git("tag", "-a", tag, "-m", `Release ${tag}`)
  }
  if (!args.noPush)
    git("push", "--atomic", remote, `HEAD:refs/heads/${branch}`, `refs/tags/${tag}:refs/tags/${tag}`)
  if (github) {
    const existing = run(["gh", "release", "view", tag, "--repo", repo, "--json", "url"], false)
    if (existing.status === 0) {
      console.log(existing.stdout.trim())
    }
    else {
      const command = ["gh", "release", "create", tag, "--repo", repo, "--verify-tag", "--notes-file", "-", "--title", tag]
      if (parse(target).pre !== undefined)
        command.push("--prerelease")
      console.log(run(command, true, false, notes).stdout.trim())
    }
  }
  console.log(`Release complete: ${tag}${args.noPush ? " (local only)" : ""}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  }
  catch (error) {
    console.error(`ERROR: ${error.message}\nStopped without automatic rollback or force-push. Inspect git status/log/tags. If commit and tag already exist at HEAD, retry with the exact version --resume --apply.`)
    process.exitCode = 1
  }
}
