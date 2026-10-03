import type { Config } from "@/types/config/config"
import type { WebPagePromptContext } from "@/types/content"
import { getLocalConfig } from "@/utils/config/storage"
import { hasInlineAtomTokens, INLINE_ATOM_TOKEN_SYSTEM_PROMPT } from "@/utils/host/translate/inline-atom-tokens"
import { DEFAULT_CONFIG } from "../constants/config"
import {
  DEFAULT_BATCH_TRANSLATE_PROMPT,
  DEFAULT_TRANSLATE_PROMPT,
  DEFAULT_TRANSLATE_SYSTEM_PROMPT,
  getTokenCellText,
  INPUT,
  TARGET_LANGUAGE,
  WEB_CONTENT,
  WEB_DESCRIPTION,
  WEB_SUMMARY,
  WEB_TITLE,
} from "../constants/prompt"

export interface TranslatePromptOptions<TContext = unknown> {
  isBatch?: boolean
  context?: TContext
}

export interface TranslatePromptResult {
  systemPrompt: string
  prompt: string
}

const CONTEXT_TOKENS = [WEB_TITLE, WEB_DESCRIPTION, WEB_CONTENT, WEB_SUMMARY] as const

/** Render the template before inserting input, so source text is never treated as a template. */
function renderTemplate(template: string, replacements: Record<string, string>) {
  const usedContext = new Set<string>()
  const sourceLines = template.split(/\r?\n/)
  const backgroundHeadings = new Set<string>()
  for (const [index, line] of sourceLines.entries()) {
    if (!/^#{1,6}\s/.test(line))
      continue
    const following = sourceLines.slice(index + 1)
    const nextHeading = following.findIndex(value => /^#{1,6}\s/.test(value))
    const section = nextHeading === -1 ? following : following.slice(0, nextHeading)
    if (section.some(value => CONTEXT_TOKENS.some(token => value.includes(getTokenCellText(token)))))
      backgroundHeadings.add(line)
  }
  const lines = sourceLines.filter((line) => {
    const missingBackground = CONTEXT_TOKENS.some(token => line.includes(getTokenCellText(token)) && !replacements[token])
    // A mixed input/background line must not discard the text to translate.
    if (missingBackground && !line.includes(getTokenCellText(INPUT)))
      return false
    for (const token of CONTEXT_TOKENS) {
      if (line.includes(getTokenCellText(token)) && replacements[token])
        usedContext.add(token)
    }
    return true
  })

  // Remove empty Markdown sections, including the metadata block in older saved prompts.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!backgroundHeadings.has(lines[index]))
      continue
    const nextContent = lines.slice(index + 1).find(line => line.trim())
    if (!nextContent || /^#{1,6}\s/.test(nextContent))
      lines.splice(index, 1)
  }

  const text = lines.join("\n").replace(/\{\{(targetLanguage|input|webTitle|webDescription|webContent|webSummary)\}\}/g, (_match, token: string) => replacements[token]).trim()
  return { text, usedContext }
}

export function getTranslatePromptFromConfig(
  translateConfig: Pick<Config["translate"], "customPromptsConfig">,
  targetLang: string,
  input: string,
  options?: TranslatePromptOptions<WebPagePromptContext>,
): TranslatePromptResult {
  const customPromptsConfig = translateConfig.customPromptsConfig
  const { patterns = [], promptId } = customPromptsConfig

  // Resolve system prompt and user prompt
  let systemPrompt: string
  let prompt: string

  if (!promptId) {
    // Use default prompts from constants
    systemPrompt = DEFAULT_TRANSLATE_SYSTEM_PROMPT
    prompt = DEFAULT_TRANSLATE_PROMPT
  }
  else {
    // Find custom prompt, fallback to default
    const customPrompt = patterns.find(pattern => pattern.id === promptId)
    systemPrompt = customPrompt?.systemPrompt ?? DEFAULT_TRANSLATE_SYSTEM_PROMPT
    prompt = customPrompt?.prompt ?? DEFAULT_TRANSLATE_PROMPT
  }

  const replacements: Record<string, string> = {
    [TARGET_LANGUAGE]: targetLang,
    [INPUT]: input,
    [WEB_TITLE]: options?.context?.webTitle?.trim() ?? "",
    [WEB_DESCRIPTION]: options?.context?.webDescription?.trim() ?? "",
    [WEB_CONTENT]: options?.context?.webContent?.trim() ?? "",
    [WEB_SUMMARY]: options?.context?.webSummary?.trim() ?? "",
  }
  const renderedSystem = renderTemplate(systemPrompt, replacements)
  const renderedPrompt = renderTemplate(prompt, replacements)
  const usedContext = new Set([...renderedSystem.usedContext, ...renderedPrompt.usedContext])

  // Page background is independent of custom translation rules. Legacy templates
  // can still place it explicitly; do not append the same field twice.
  const background: string[] = []
  if (replacements[WEB_TITLE] && !usedContext.has(WEB_TITLE))
    background.push(`Webpage title: ${replacements[WEB_TITLE]}`)
  if (replacements[WEB_SUMMARY] && !usedContext.has(WEB_SUMMARY))
    background.push(`Webpage summary: ${replacements[WEB_SUMMARY]}`)

  const systemParts = [renderedSystem.text]
  if (background.length)
    systemParts.push(`## Webpage context\n${background.join("\n")}`)
  if (options?.isBatch)
    systemParts.push(DEFAULT_BATCH_TRANSLATE_PROMPT)
  if (hasInlineAtomTokens(input))
    systemParts.push(INLINE_ATOM_TOKEN_SYSTEM_PROMPT)

  return { systemPrompt: systemParts.filter(Boolean).join("\n\n"), prompt: renderedPrompt.text }
}

export async function getTranslatePrompt(
  targetLang: string,
  input: string,
  options?: TranslatePromptOptions<WebPagePromptContext>,
): Promise<TranslatePromptResult> {
  const config = await getLocalConfig() ?? DEFAULT_CONFIG
  return getTranslatePromptFromConfig(config.translate, targetLang, input, options)
}
