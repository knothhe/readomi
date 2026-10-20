#!/usr/bin/env node
// Read-only notes for an existing local tag; no gh or remote access.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import process from "node:process"
import { parse, releaseNotes } from "./release.mjs"

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(result.stderr.trim())
  return result.stdout.trim()
}

try {
  const args = process.argv.slice(2)
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: make --silent release-notes RELEASE_REPO=owner/repo RELEASE_TAG=<tag>\nReads tag_prefix from .release.json (default: v). Writes Markdown to stdout only.")
  }
  else {
    const [repo, tag] = args
    if (args.length !== 2 || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? ""))
      throw new Error("Expected <owner/repo> <tag>. Use --help for usage.")
    process.chdir(git("rev-parse", "--show-toplevel"))
    const config = fs.existsSync(".release.json") ? JSON.parse(fs.readFileSync(".release.json", "utf8")) : {}
    if (config === null || typeof config !== "object" || Array.isArray(config))
      throw new Error(".release.json must contain an object.")
    const prefix = config.tag_prefix === undefined ? "v" : config.tag_prefix
    if (typeof prefix !== "string" || prefix.startsWith("-") || !tag.startsWith(prefix))
      throw new Error("Tag must match the configured tag_prefix.")
    const version = tag.slice(prefix.length)
    parse(version)
    git("check-ref-format", `refs/tags/${tag}`)
    const sourceHead = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`)
    process.stdout.write(releaseNotes(repo, prefix, version, sourceHead, tag))
  }
}
catch (error) {
  console.error(`ERROR: ${error.message}`)
  process.exitCode = 1
}
