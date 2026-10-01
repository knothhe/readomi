import { browser } from "#imports"

export const APP_NAME = "Readomi"
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
