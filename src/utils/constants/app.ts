import { browser } from "#imports"

export const APP_NAME = "Readomi"
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
export const APP_USER_AGENT = `${APP_NAME}/${EXTENSION_VERSION}`
