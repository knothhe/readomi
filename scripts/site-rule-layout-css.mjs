import { readFile, writeFile } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"
import postcss from "postcss"

const wrapper = ".read-frog-translated-content-wrapper"
const owner = "[data-readomi-layout-owner]"
const guard = `:where(${owner}, ${owner} *):has(${wrapper})`
const sizeProperties = new Set(["height", "max-height", "block-size", "max-block-size"])
const overflowProperties = new Set(["overflow", "overflow-x", "overflow-y"])

// Match a positive extension class in the selector's main chain, rather than
// inside :has(), :not() or an attribute value. Ancestors containing our UI are
// host elements and still need the ownership guard.
function targetsExtension(selector) {
  let brackets = 0
  let parentheses = 0
  let quote = ""
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]
    if (char === "\\") {
      i++
      continue
    }
    if (quote) {
      if (char === quote)
        quote = ""
      continue
    }
    if (char === "'" || char === "\"") {
      quote = char
    }
    else if (char === "[") {
      brackets++
    }
    else if (char === "]") {
      brackets--
    }
    else if (!brackets && char === "(") {
      parentheses++
    }
    else if (!brackets && char === ")") {
      parentheses--
    }
    else if (!brackets && !parentheses && char === "."
      && /^\.read-frog-translated-(?:content-wrapper|inline-content|block-content)(?![\w-])/.test(selector.slice(i))) {
      return true
    }
  }
  return false
}

function keepHostDeclaration(declaration) {
  const property = declaration.prop.toLowerCase()
  const value = declaration.value.toLowerCase().trim()
  if (sizeProperties.has(property))
    return /^(?:unset|auto|none|fit-content)$/.test(value)
  if (overflowProperties.has(property))
    return /^(?:unset|auto|visible|scroll)$/.test(value)
  if (property === "-webkit-line-clamp" || property === "line-clamp") {
    declaration.value = "unset"
    return true
  }
  return property === "--ytd-expander-max-lines"
}

/** Build-time only: no CSS parser or Node dependency ships in the extension. */
export function scopeBuiltInCSS(css) {
  // Two upstream PDF declarations put !important after a semicolon. Repair
  // only that known syntax so the parser can preserve their extension-only UI.
  const root = postcss.parse(css.replace(/;!important(?=[;}])/g, "!important"))
  root.walkRules((rule) => {
    const own = rule.selectors.filter(targetsExtension)
    const host = rule.selectors.filter(selector => !targetsExtension(selector) && !selector.includes("::"))
    if (own.length) {
      const extensionRule = rule.cloneBefore()
      extensionRule.selectors = own
    }
    rule.selectors = host.map(selector => `:is(${selector})${guard}`)
    rule.walkDecls((declaration) => {
      if (!keepHostDeclaration(declaration))
        declaration.remove()
    })
    if (!host.length || !rule.nodes.some(node => node.type === "decl"))
      rule.remove()
  })
  root.walkAtRules((rule) => {
    if (!["media", "supports", "container", "layer"].includes(rule.name.toLowerCase()))
      throw new Error(`Review unsupported built-in CSS at-rule: @${rule.name}`)
    if (!rule.nodes?.length)
      rule.remove()
  })
  return root.toString().trim()
}

export function buildLayoutCSS(rules) {
  return Object.fromEntries(rules.filter(rule => rule.injectedCss || rule["injectedCss.add"]?.length).map(rule => [
    rule.id,
    {
      ...(rule.injectedCss !== undefined && { injectedCss: scopeBuiltInCSS(rule.injectedCss) }),
      ...(rule["injectedCss.add"] && { "injectedCss.add": rule["injectedCss.add"].map(scopeBuiltInCSS).filter(Boolean) }),
    },
  ]))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = new URL("../src/utils/site-rules/built-in/rules.json", import.meta.url)
  const output = new URL("../src/utils/site-rules/built-in/layout-css.json", import.meta.url)
  const rules = JSON.parse(await readFile(source, "utf8"))
  await writeFile(output, `${JSON.stringify(buildLayoutCSS(rules), null, 2)}\n`)
  process.stdout.write("Generated scoped CSS for all built-in site rules.\n")
}
