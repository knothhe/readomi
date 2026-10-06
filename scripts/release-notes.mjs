#!/usr/bin/env node
import process from "node:process"
import { parse, releaseNotes } from "./release.mjs"

try {
  const [repo, tag, ...extra] = process.argv.slice(2)
  if (extra.length || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !tag?.startsWith("v"))
    throw new Error("Usage: node scripts/release-notes.mjs <owner/repo> <v<version>>")
  const version = tag.slice(1)
  parse(version)
  process.stdout.write(releaseNotes(repo, "v", version, tag, tag))
}
catch (error) {
  console.error(`ERROR: ${error.message}`)
  process.exitCode = 1
}
