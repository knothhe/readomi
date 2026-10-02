import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import { it } from "node:test"
import { installLocal } from "../install-local.mjs"

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(tmpdir(), "readomi-install-test-"))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const root = path.join(folder, "project")
  const directory = path.join(folder, "extensions with spaces", "chrome")
  const destination = path.join(directory, "readomi")
  fs.mkdirSync(root)
  const calls = []
  const runBuild = (browser) => {
    calls.push(browser)
    const source = path.join(root, ".output", `${browser}-mv3`)
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ manifest_version: 3, version: "1.2.1", name: `Readomi ${browser}` }))
    fs.mkdirSync(path.join(source, "assets"), { recursive: true })
    fs.writeFileSync(path.join(source, "assets", "app.js"), browser)
  }
  const config = (value) => {
    fs.writeFileSync(path.join(root, ".install-local.json"), JSON.stringify(value))
  }
  const install = (...argv) => installLocal(argv, { root, runBuild, confirmReplacement: () => false })
  return { folder, root, directory, destination, calls, runBuild, config, install }
}

function cliFixture(t) {
  const f = fixture(t)
  const scripts = path.join(f.root, "scripts")
  fs.mkdirSync(scripts)
  fs.copyFileSync(new URL("../install-local.mjs", import.meta.url), path.join(scripts, "install-local.mjs"))
  fs.writeFileSync(path.join(f.root, "build.mjs"), `
      import fs from "node:fs";
      const browser = process.argv[2];
      const output = '.output/' + browser + '-mv3';
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(output + '/manifest.json', JSON.stringify({ manifest_version: 3, version: '1.2.1' }));
      fs.writeFileSync('built-browser', browser);
    `)
  fs.writeFileSync(path.join(f.root, "package.json"), JSON.stringify({ scripts: {
    "build": "node build.mjs chrome",
    "build:firefox": "node build.mjs firefox",
    "build:edge": "node build.mjs edge",
  } }))
  const cli = (browser = "chrome", input = "") => spawnSync(process.execPath, [path.join(scripts, "install-local.mjs"), browser, "--dir", f.directory], { cwd: f.folder, encoding: "utf8", input, timeout: 10000 })
  return { ...f, cli }
}

for (const browser of ["chrome", "firefox", "edge"]) {
  it(`builds and installs ${browser} to its configured directory`, async (t) => {
    const f = fixture(t)
    f.config({ browser, directories: { [browser]: f.directory } })
    assert.deepEqual(await f.install(), { browser, destination: f.destination, version: "1.2.1" })
    assert.deepEqual(f.calls, [browser])
    assert.equal(fs.readFileSync(path.join(f.destination, "assets", "app.js"), "utf8"), browser)
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination, ".readomi-install.json"))).browser, browser)
  })

  it(`CLI runs the actual ${browser} build script and reports how to load it`, (t) => {
    const f = cliFixture(t)
    const result = f.cli(browser)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readFileSync(path.join(f.root, "built-browser"), "utf8"), browser)
    assert.match(result.stdout, /Installed Readomi 1\.2\.1/)
    assert.ok(result.stdout.includes(browser === "firefox" ? "about:debugging" : `${browser}://extensions`))
    assert.ok(fs.existsSync(path.join(f.destination, "manifest.json")))
  })
}

it("CLI options override config and relative paths resolve from the repository", async (t) => {
  const f = fixture(t)
  f.config({ browser: "firefox", directories: { firefox: "/unused", edge: "/unused" } })
  const result = await f.install("--browser", "edge", "--dir", "../local-extension")
  assert.equal(result.destination, path.join(f.folder, "local-extension", "readomi"))
  assert.deepEqual(f.calls, ["edge"])
})

it("accepts an alternate config and a positional browser", async (t) => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, "custom.json"), JSON.stringify({ browser: "chrome", directories: { edge: f.directory } }))
  assert.equal((await f.install("edge", "--config", "custom.json")).browser, "edge")
})

it("defaults to Chrome without a config when --dir is provided", async (t) => {
  const f = fixture(t)
  assert.equal((await f.install("--", "--dir", f.directory)).browser, "chrome")
})

it("replaces a managed installation and removes obsolete assets", async (t) => {
  const f = fixture(t)
  await f.install("--dir", f.directory)
  fs.writeFileSync(path.join(f.destination, "assets", "obsolete.js"), "old")
  await f.install("chrome", "--dir", f.directory)
  assert.equal(fs.existsSync(path.join(f.destination, "assets", "obsolete.js")), false)
  assert.equal(fs.readFileSync(path.join(f.destination, "assets", "app.js"), "utf8"), "chrome")
  assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), ["readomi"])
})

it("keeps the installed version when a build fails or produces an invalid manifest", async (t) => {
  const f = fixture(t)
  await f.install("--dir", f.directory)
  const oldManifest = fs.readFileSync(path.join(f.destination, "manifest.json"), "utf8")
  await assert.rejects(() => installLocal(["--dir", f.directory], {
    root: f.root,
    runBuild: () => {
      throw new Error("build failed")
    },
  }), /build failed/)
  fs.writeFileSync(path.join(f.root, ".output", "chrome-mv3", "manifest.json"), "{}")
  await assert.rejects(() => installLocal(["--dir", f.directory], { root: f.root, runBuild: () => {} }), /valid MV3/)
  assert.equal(fs.readFileSync(path.join(f.destination, "manifest.json"), "utf8"), oldManifest)
})

it("cancels overwrite without building or changing existing files", async (t) => {
  const f = fixture(t)
  fs.mkdirSync(f.destination, { recursive: true })
  const personalFile = path.join(f.destination, "keep.txt")
  fs.writeFileSync(personalFile, "personal file")
  assert.equal(await f.install("--dir", f.directory), null)
  assert.equal(fs.readFileSync(personalFile, "utf8"), "personal file")
  assert.deepEqual(f.calls, [])
})

it("rejects repository overlap, build paths and symlink plugin directories", async (t) => {
  const f = fixture(t)
  for (const destination of [f.root, path.join(f.root, ".output"), path.join(f.root, ".output", "chrome-mv3", "nested")])
    await assert.rejects(() => f.install("--dir", destination), /repository|overlap/)
  await assert.rejects(() => f.install("--dir", f.folder, "--name", "project"), /repository|overlap/)
  const alias = path.join(f.folder, "project-alias")
  fs.symlinkSync(f.root, alias, "dir")
  await assert.rejects(() => f.install("--dir", path.join(alias, ".output", "chrome-mv3")), /overlap/)
  const external = path.join(f.folder, "external")
  fs.mkdirSync(external)
  fs.mkdirSync(f.directory, { recursive: true })
  const link = f.destination
  fs.symlinkSync(external, link, "dir")
  await assert.rejects(() => f.install("--dir", f.directory), /symlink/)
  assert.deepEqual(f.calls, [])
})

it("preserves existing parent files and other plugins on installation and updates", async (t) => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.directory, "other-plugin"), { recursive: true })
  const parentFiles = {
    "notes.txt": "personal notes",
    "manifest.json": "old flat installation",
    ".readomi-install.json": JSON.stringify({ installer: "readomi-install-local", schema: 1 }),
    "other-plugin/manifest.json": "another plugin",
  }
  for (const [file, content] of Object.entries(parentFiles))
    fs.writeFileSync(path.join(f.directory, file), content)
  const noConfirmation = () => {
    assert.fail("Existing parent files must not trigger overwrite confirmation")
  }
  const install = () => installLocal(["--dir", f.directory], { root: f.root, runBuild: f.runBuild, confirmReplacement: noConfirmation })
  const installed = await install()
  assert.equal(installed.destination, f.destination)
  fs.writeFileSync(path.join(f.destination, "obsolete.js"), "old asset")
  await install()
  assert.equal(fs.existsSync(path.join(f.destination, "obsolete.js")), false)
  for (const [file, content] of Object.entries(parentFiles))
    assert.equal(fs.readFileSync(path.join(f.directory, file), "utf8"), content)
  assert.deepEqual(fs.readdirSync(f.directory).sort(), [".readomi-install.json", "manifest.json", "notes.txt", "other-plugin", "readomi"])
})

it("uses the configured name and allows --name to override it", async (t) => {
  const f = fixture(t)
  f.config({ name: "configured-name", directories: { chrome: f.directory } })
  assert.equal((await f.install()).destination, path.join(f.directory, "configured-name"))
  assert.equal((await f.install("--name", "我的 Readomi")).destination, path.join(f.directory, "我的 Readomi"))
  assert.deepEqual(fs.readdirSync(f.directory).sort(), ["configured-name", "我的 Readomi"])
})

it("isolates browser builds with different plugin names in a shared parent", async (t) => {
  const f = fixture(t)
  for (const browser of ["chrome", "firefox", "edge"])
    await f.install(browser, "--dir", f.directory, "--name", `readomi-${browser}`)
  for (const browser of ["chrome", "firefox", "edge"])
    assert.equal(fs.readFileSync(path.join(f.directory, `readomi-${browser}`, "assets", "app.js"), "utf8"), browser)
})

it("confirms changing browsers only for the named plugin subdirectory", async (t) => {
  const f = fixture(t)
  await f.install("--dir", f.directory)
  fs.writeFileSync(path.join(f.directory, "keep.txt"), "keep")
  assert.equal(await f.install("firefox", "--dir", f.directory), null)
  assert.equal(fs.readFileSync(path.join(f.destination, "assets", "app.js"), "utf8"), "chrome")
  const prompted = []
  await installLocal(["firefox", "--dir", f.directory], {
    root: f.root,
    runBuild: f.runBuild,
    confirmReplacement: (destination) => {
      prompted.push(destination)
      return true
    },
  })
  assert.deepEqual(prompted, [f.destination])
  assert.equal(fs.readFileSync(path.join(f.destination, "assets", "app.js"), "utf8"), "firefox")
  assert.equal(fs.readFileSync(path.join(f.directory, "keep.txt"), "utf8"), "keep")
})

it("rejects names that could escape the parent or replace it", async (t) => {
  const f = fixture(t)
  for (const name of [".", "..", "../outside", "/absolute", "nested/folder", "nested\\folder", "", " leading-space", "trailing-space ", "NUL", "name:invalid"])
    await assert.rejects(() => f.install("--dir", f.directory, "--name", name), /Plugin name|Expected a value/)
  f.config({ name: "../outside", directories: { chrome: f.directory } })
  await assert.rejects(() => f.install(), /Plugin name/)
  assert.deepEqual(f.calls, [])
  assert.equal(fs.existsSync(f.directory), false)
})

it("reports missing directories, malformed config and invalid options before building", async (t) => {
  const f = fixture(t)
  await assert.rejects(() => f.install(), /No installation directory configured/)
  for (const argv of [["safari"], ["--dir"], ["--unexpected"], ["chrome", "edge"], ["--dir", "a", "--dir", "b"]])
    await assert.rejects(() => f.install(...argv))
  for (const config of [null, [], { directory: "typo" }, { directories: { safari: "/tmp/safari" } }, { directories: { chrome: " " } }]) {
    f.config(config)
    await assert.rejects(() => f.install("--dir", f.directory))
  }
  fs.writeFileSync(path.join(f.root, ".install-local.json"), "broken json")
  await assert.rejects(() => f.install("--dir", f.directory), SyntaxError)
  assert.deepEqual(f.calls, [])
})

for (const answer of ["Y\n", "y\n", "yes\n", "\n", "maybe\nY\n"]) {
  it(`CLI confirms replacement with ${JSON.stringify(answer)} and manages future updates`, (t) => {
    const f = cliFixture(t)
    fs.mkdirSync(f.destination, { recursive: true })
    fs.writeFileSync(path.join(f.destination, "old-plugin.js"), "old plugin")
    const result = f.cli("chrome", answer)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(f.destination))
    assert.match(result.stdout, /replace all files.*\nOverwrite this plugin\? \[Y\/n\]/)
    if (answer.startsWith("maybe"))
      assert.match(result.stdout, /Please enter Y or n/)
    assert.equal(fs.existsSync(path.join(f.destination, "old-plugin.js")), false)
    assert.ok(fs.existsSync(path.join(f.destination, ".readomi-install.json")))
    const update = f.cli()
    assert.equal(update.status, 0, update.stderr)
    assert.doesNotMatch(update.stdout, /Overwrite this plugin/)
  })
}

for (const answer of ["n\n", "N\n", "no\n", "", "maybe\n"]) {
  it(`CLI cancels replacement with ${JSON.stringify(answer)} before building`, (t) => {
    const f = cliFixture(t)
    fs.mkdirSync(f.destination, { recursive: true })
    fs.writeFileSync(path.join(f.destination, "old-plugin.js"), "old plugin")
    const result = f.cli("chrome", answer)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installation cancelled/)
    assert.equal(fs.readFileSync(path.join(f.destination, "old-plugin.js"), "utf8"), "old plugin")
    assert.equal(fs.existsSync(path.join(f.root, "built-browser")), false)
    assert.equal(fs.existsSync(path.join(f.destination, ".readomi-install.json")), false)
  })
}

it("keeps a confirmed manual installation intact if its build fails", (t) => {
  const f = cliFixture(t)
  fs.mkdirSync(f.destination, { recursive: true })
  fs.writeFileSync(path.join(f.destination, "old-plugin.js"), "old plugin")
  fs.writeFileSync(path.join(f.root, "build.mjs"), "process.exit(1)")
  const result = f.cli("chrome", "Y\n")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Build failed/)
  assert.equal(fs.readFileSync(path.join(f.destination, "old-plugin.js"), "utf8"), "old plugin")
  assert.equal(fs.existsSync(path.join(f.destination, ".readomi-install.json")), false)
})

it("requires a new confirmation when an unmanaged directory appears during the build", async (t) => {
  const f = fixture(t)
  await assert.rejects(() => installLocal(["--dir", f.directory], {
    root: f.root,
    runBuild: (browser) => {
      f.runBuild(browser)
      fs.mkdirSync(f.destination, { recursive: true })
      fs.writeFileSync(path.join(f.destination, "new-file"), "keep")
    },
  }), /changed during the build/)
  assert.equal(fs.readFileSync(path.join(f.destination, "new-file"), "utf8"), "keep")
})
