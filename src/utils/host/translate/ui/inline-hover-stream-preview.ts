import type { CSSProperties } from "react"
import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import customTranslationNodeCss from "@/assets/styles/custom-translation-node.css?raw"
import translationNodePresetCss from "@/assets/styles/translation-node-preset.css?raw"
import { BLOCK_CONTENT_CLASS, CONTENT_WRAPPER_CLASS, NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import { getLanguageDirectionAndLang } from "@/utils/content/language-direction"
import { setTranslationDirAndLang } from "../translation-attributes"
import { SmoothPreviewText } from "./smooth-preview-text"

/** Reveal in the paragraph, reserving space in line groups. */
export function createInlineHoverStreamPreview(anchor: HTMLElement, config: Config, cancel: () => void) {
  const doc = anchor.ownerDocument
  const view = doc.defaultView!
  const computed = view.getComputedStyle(anchor)
  // A box with no independent block layout cannot safely reserve its own height.
  if (!["block", "list-item", "flow-root"].includes(computed.display))
    return undefined
  const only = config.translate.mode === "translationOnly"
  const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)").matches
  let lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.65
  const inset = computed.boxSizing === "border-box" ? 0 : Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom) + Number.parseFloat(computed.borderTopWidth) + Number.parseFloat(computed.borderBottomWidth)
  const originalHeight = anchor.getBoundingClientRect().height
  const sourceText = anchor.textContent
  const host = doc.createElement("span")
  host.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
  host.dataset.readomiInlinePreview = "true"
  host.style.cssText = `all:initial!important;display:block!important;position:${only ? "absolute" : "relative"}!important;visibility:visible!important;font:inherit!important;color:inherit!important;overflow:hidden!important;box-sizing:border-box!important;height:0px!important;transition:height ${reducedMotion ? 0 : 280}ms cubic-bezier(.2,.7,.2,1)!important;`
  if (only) {
    host.style.setProperty("left", computed.paddingLeft, "important")
    host.style.setProperty("right", computed.paddingRight, "important")
    host.style.setProperty("top", computed.paddingTop, "important")
  }
  else {
    host.style.setProperty("margin", "8px 0", "important")
  }
  setTranslationDirAndLang(host, config)
  const shadow = host.attachShadow({ mode: "open" })
  const style = doc.createElement("style")
  const styleConfig = config.translate.translationNodeStyle
  const translationCSS = only ? "" : styleConfig?.isCustom && styleConfig.customCSS ? styleConfig.customCSS : customTranslationNodeCss.replace(/@import[^;]+;/g, "")
  style.textContent = `${translationNodePresetCss + translationCSS}:host{color:inherit;font:inherit}.content{position:absolute!important;top:0;left:0;right:0}.preview-translation{display:block!important;margin:0!important;box-sizing:border-box;overflow-wrap:anywhere;white-space:pre-wrap}.preview-group+.preview-group{margin-top:16px}.group:empty{display:none}`
  const content = doc.createElement("div")
  content.className = "content"
  setTranslationDirAndLang(content, config)
  shadow.append(style, content)
  const root = createRoot(content)
  const groups = new Map<number, string>()
  const groupTypography = new Map<number, CSSProperties>()
  const groupLanguages = new Map<number, ReturnType<typeof getLanguageDirectionAndLang>>()
  const completedGroups = new Set<number>()
  const progressCallbacks = new Map<number, (length: number) => void>()
  const completionCallbacks = new Map<number, () => void>()
  const ownedStyles = new Map<HTMLElement, Map<string, { value: string, priority: string, owned: string }>>()
  let sourceHidden = false
  let mounted = false
  let disposed = false
  let committing = false
  let done = false
  let frame = 0
  let resizeFrame = 0
  let reserved = 0
  let resolveFinished: ((apply: boolean) => void) | undefined
  const setAnchorStyle = (name: string, value: string, node = anchor) => {
    let styles = ownedStyles.get(node)
    if (!styles) {
      styles = new Map()
      ownedStyles.set(node, styles)
    }
    if (!styles.has(name))
      styles.set(name, { value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name), owned: value })
    node.style.setProperty(name, value, "important")
    styles.get(name)!.owned = node.style.getPropertyValue(name)
  }
  const restoreAnchorStyles = () => {
    for (const [node, styles] of ownedStyles) {
      for (const [name, previous] of styles) {
        if (node.style.getPropertyValue(name) !== previous.owned)
          continue
        if (previous.value)
          node.style.setProperty(name, previous.value, previous.priority)
        else
          node.style.removeProperty(name)
      }
    }
    ownedStyles.clear()
  }
  const reserveHeight = () => {
    resizeFrame = 0
    if (disposed || !mounted || committing)
      return
    const natural = content.getBoundingClientRect().height
    // One line of read-ahead lets the height transition finish before new text
    // reaches the edge. Grow in three-line steps and never shrink mid-stream.
    const quantum = lineHeight * 3
    const next = Math.max(reserved, originalHeight, Math.ceil((natural + lineHeight) / quantum) * quantum)
    if (next <= reserved)
      return
    reserved = next
    host.style.setProperty("height", `${reserved}px`, "important")
    if (only) {
      // Animate the paragraph's flow box as well as the overlay containing text.
      setAnchorStyle("transition", `height ${reducedMotion ? 0 : 280}ms cubic-bezier(.2,.7,.2,1)`)
      setAnchorStyle("height", `${Math.max(0, reserved - inset)}px`)
    }
  }
  const scheduleHeight = () => {
    if (!resizeFrame)
      resizeFrame = view.requestAnimationFrame(reserveHeight)
  }
  const resizeObserver = new view.ResizeObserver(scheduleHeight)
  resizeObserver.observe(content)
  const render = () => {
    frame = 0
    if (disposed)
      return
    root.render([...groups.entries()].map(([key, partial]) => {
      const template = doc.createElement("template")
      template.innerHTML = partial.replace(/&(?:#x?[\da-f]*|[a-z]*)$/i, "").trimStart()
      const text = (template.content.textContent ?? "").trimStart()
      return createElement("div", { key, className: "preview-group", style: { ...groupTypography.get(key), display: text ? "block" : "none" } },
        createElement("div", {
          "className": `preview-translation ${CONTENT_WRAPPER_CLASS} ${only ? "" : BLOCK_CONTENT_CLASS}`,
          "lang": groupLanguages.get(key)?.lang ?? content.lang,
          "dir": groupLanguages.get(key)?.dir ?? content.dir,
          "data-readomi-custom-translation-style": only ? undefined : styleConfig?.isCustom ? "custom" : styleConfig?.preset ?? "line",
        }, createElement(SmoothPreviewText, { content: text, done, onProgress: progressCallbacks.get(key), onComplete: completionCallbacks.get(key) })))
    }))
  }
  const schedule = () => {
    if (!frame)
      frame = view.requestAnimationFrame(render)
  }
  const mount = () => {
    if (mounted || disposed)
      return
    mounted = true
    if (only && computed.position === "static")
      setAnchorStyle("position", "relative")
    anchor.append(host)
    scheduleHeight()
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape")
      cancel()
  }
  const observer = new view.MutationObserver(() => {
    if (!anchor.isConnected || (!committing && anchor.textContent !== sourceText) || (mounted && !host.isConnected && !committing))
      cancel()
  })
  observer.observe(doc.documentElement, { childList: true, characterData: true, subtree: true })
  doc.addEventListener("keydown", escape, true)
  view.addEventListener("resize", scheduleHeight)
  return {
    register(typographyElement = anchor, onTextVisible?: () => void) {
      const key = groups.size
      let revealed = false
      groups.set(key, "")
      // Keep the flow box on the anchor, but inherit each group's typography
      // from the final renderer's insertion container. Sites such as YouTube
      // give that inner text container a different size from the outer block.
      const typography = view.getComputedStyle(typographyElement)
      groupTypography.set(key, {
        fontFamily: typography.fontFamily,
        fontSize: typography.fontSize,
        fontWeight: typography.fontWeight,
        fontStyle: typography.fontStyle,
        fontStretch: typography.fontStretch,
        fontVariant: typography.fontVariant,
        lineHeight: typography.lineHeight,
        letterSpacing: typography.letterSpacing,
        wordSpacing: typography.wordSpacing,
        textTransform: typography.textTransform,
        color: typography.color,
      })
      lineHeight = Math.max(lineHeight, Number.parseFloat(typography.lineHeight) || Number.parseFloat(typography.fontSize) * 1.65)
      progressCallbacks.set(key, (length) => {
        if (length && !disposed && !committing && !revealed) {
          revealed = true
          // SmoothPreviewText has written the first visible text, before paint.
          // Keep the page renderer's waiting dot until that point.
          onTextVisible?.()
        }
        if (length && only && !disposed && !committing && !sourceHidden) {
          sourceHidden = true
          setAnchorStyle("visibility", "hidden")
          // Explicitly visible descendants override inherited visibility.
          for (const child of anchor.querySelectorAll<HTMLElement>("*")) {
            if (child !== host && view.getComputedStyle(child).visibility === "visible")
              setAnchorStyle("visibility", "hidden", child)
          }
        }
      })
      completionCallbacks.set(key, () => {
        completedGroups.add(key)
        if (done && completedGroups.size === groups.size) {
          resolveFinished?.(true)
          resolveFinished = undefined
        }
      })
      const update = (partial: string) => {
        if (disposed)
          return
        groups.set(key, partial)
        if (partial)
          mount()
        schedule()
      }
      return Object.assign(update, {
        setTargetLanguage(code: LangCodeISO6393) {
          if (disposed)
            return
          groupLanguages.set(key, getLanguageDirectionAndLang(code))
          schedule()
        },
      })
    },
    finish(finalTexts: string[]): Promise<boolean> {
      if (disposed)
        return Promise.resolve(false)
      if (!mounted)
        return Promise.resolve(true)
      finalTexts.forEach((value, key) => {
        if (groups.get(key)?.trim() !== value.trim())
          groups.set(key, value)
      })
      done = true
      schedule()
      return new Promise(resolve => resolveFinished = resolve)
    },
    async commitToPage(commit: () => Promise<void>) {
      committing = true
      const before = anchor.getBoundingClientRect().height
      // Remove the reserved preview space in the same frame as the final
      // renderer writes. Keeping the styles until afterward avoids a flash of
      // the original during replacement.
      host.remove()
      await commit()
      restoreAnchorStyles()
      if (disposed || !mounted || reducedMotion)
        return
      const after = anchor.getBoundingClientRect().height
      if (Math.abs(before - after) > 1) {
        const animation = anchor.animate([
          { height: `${Math.max(0, before - inset)}px`, overflow: "hidden" },
          { height: `${Math.max(0, after - inset)}px`, overflow: "hidden" },
        ], { duration: 280, easing: "cubic-bezier(.2,.7,.2,1)" })
        await animation.finished.catch(() => {})
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      resolveFinished?.(false)
      resolveFinished = undefined
      root.unmount()
      resizeObserver.disconnect()
      observer.disconnect()
      doc.removeEventListener("keydown", escape, true)
      view.removeEventListener("resize", scheduleHeight)
      view.cancelAnimationFrame(frame)
      view.cancelAnimationFrame(resizeFrame)
      host.remove()
      restoreAnchorStyles()
    },
  }
}
