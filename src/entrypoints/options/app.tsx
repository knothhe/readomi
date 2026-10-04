import type { MouseEvent } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { EXTENSION_VERSION } from "@/utils/constants/app"
import { AppearanceSection } from "./sections/appearance"
import { BackupSection } from "./sections/backup"
import { FeaturesSection } from "./sections/features"
import { SettingsHeader } from "./sections/header"
import { QualitySection } from "./sections/quality"
import { ReadingSection } from "./sections/reading"
import { ServiceSection } from "./sections/service"
import { ShortcutSection } from "./sections/shortcut"
import { SiteRulesSection } from "./sections/site-rules"

const SECTIONS = [
  { id: "service", title: "options.service.title", Component: ServiceSection },
  { id: "reading", title: "options.reading.title", Component: ReadingSection },
  { id: "features", title: "features.title", Component: FeaturesSection },
  { id: "quality", title: "options.quality.title", Component: QualitySection },
  { id: "shortcut", title: "options.shortcut.title", Component: ShortcutSection },
  { id: "appearance", title: "options.appearance.title", Component: AppearanceSection },
  { id: "backup", title: "configBackup.title", Component: BackupSection },
] as const

type SectionId = typeof SECTIONS[number]["id"]
type SettingsPage = SectionId | "reading/site-rules"
const SITE_RULES_PAGE = "reading/site-rules"

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state
  return typeof state === "object" && state !== null ? state as Record<string, unknown> : {}
}

function NavigationIcon({ section }: { section: typeof SECTIONS[number]["id"] }) {
  const shapes = {
    service: (
      <>
        <rect x="4" y="4" width="16" height="6" rx="2" />
        <rect x="4" y="14" width="16" height="6" rx="2" />
        <path d="M7 7h.01M7 17h.01M12 7h5M12 17h5" />
      </>
    ),
    reading: <path d="M12 5v15M12 5C9 3 5 3 3 4v14c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 1" />,
    features: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10 9 5 3-5 3Z" />
      </>
    ),
    quality: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />,
    shortcut: (
      <>
        <rect x="2" y="6" width="20" height="12" rx="3" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h8" />
      </>
    ),
    appearance: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v16M12 4a8 8 0 0 1 0 16Z" />
      </>
    ),
    backup: <path d="m3 7 9-4 9 4v10l-9 4-9-4ZM3 7l9 4 9-4M12 11v10M7.5 5l9 4" />,
  }
  return <svg className="options-nav-icon" viewBox="0 0 24 24" aria-hidden="true">{shapes[section]}</svg>
}

function pageFromHash(): SettingsPage {
  const hash = window.location.hash.slice(1)
  if (hash === "site-rules" || hash === SITE_RULES_PAGE)
    return SITE_RULES_PAGE
  return SECTIONS.find(section => section.id === hash)?.id ?? "service"
}

export default function App() {
  const [active, setActive] = useState(pageFromHash)
  const pendingScrollRef = useRef<number | null>(null)
  const activeSection = active === SITE_RULES_PAGE ? "reading" : active
  useEffect(() => {
    const update = () => {
      const page = pageFromHash()
      // Keep links saved before rules became a reading subpage usable.
      if (window.location.hash === "#site-rules")
        window.history.replaceState(window.history.state, "", `#${SITE_RULES_PAGE}`)
      const savedScroll = historyState().readomiReadingScroll
      pendingScrollRef.current = page === "reading" && typeof savedScroll === "number" && Number.isFinite(savedScroll)
        ? Math.max(0, savedScroll)
        : 0
      setActive(page)
    }
    if (window.location.hash === "#site-rules")
      window.history.replaceState(window.history.state, "", `#${SITE_RULES_PAGE}`)
    window.addEventListener("hashchange", update)
    window.addEventListener("popstate", update)
    return () => {
      window.removeEventListener("hashchange", update)
      window.removeEventListener("popstate", update)
    }
  }, [])
  useLayoutEffect(() => {
    if (pendingScrollRef.current === null)
      return
    window.scrollTo?.({ top: pendingScrollRef.current })
    pendingScrollRef.current = null
  })
  useEffect(() => {
    const keepActiveVisible = () => {
      const link = document.querySelector<HTMLElement>(`.options-navigation a[href="#${activeSection}"]`)
      const navigation = link?.parentElement
      if (!link || !navigation)
        return
      const item = link.getBoundingClientRect()
      const viewport = navigation.getBoundingClientRect()
      if (item.left < viewport.left + 8)
        navigation.scrollLeft += item.left - viewport.left - 8
      else if (item.right > viewport.right - 8)
        navigation.scrollLeft += item.right - viewport.right + 8
    }
    keepActiveVisible()
    window.addEventListener("resize", keepActiveVisible)
    return () => window.removeEventListener("resize", keepActiveVisible)
  }, [activeSection])

  const navigate = (page: SettingsPage, state: Record<string, unknown> | null = null) => {
    if (active === page)
      return
    window.history.pushState(state, "", `#${page}`)
    pendingScrollRef.current = 0
    setActive(page)
  }

  const openSiteRules = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event))
      return
    event.preventDefault()
    // The parent entry stores the clicked row's position for both Back controls.
    window.history.replaceState({ ...historyState(), readomiReadingScroll: window.scrollY }, "")
    navigate(SITE_RULES_PAGE, { readomiSiteRulesDrillIn: true })
  }

  const backToReading = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event))
      return
    event.preventDefault()
    if (historyState().readomiSiteRulesDrillIn === true)
      window.history.back()
    else
      navigate("reading")
  }

  return (
    <div className="options-shell">
      <aside className="options-sidebar">
        <SettingsHeader />
        <nav aria-label={i18n.t("settingsNavigation.label")} className="options-navigation">
          {SECTIONS.map(({ id, title }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={activeSection === id ? "page" : undefined}
              className="options-nav-link"
              onClick={(event) => {
                if (!isPlainLeftClick(event))
                  return
                event.preventDefault()
                navigate(id)
              }}
            >
              <NavigationIcon section={id} />
              <span className="options-nav-label">
                <span className="options-nav-label-text">{i18n.t(title)}</span>
                <span className="options-nav-label-size" aria-hidden="true">{i18n.t(title)}</span>
              </span>
            </a>
          ))}
        </nav>
        <div className="options-sidebar-footer">{`${i18n.t("options.version")} ${EXTENSION_VERSION}`}</div>
      </aside>
      <main className="options-main">
        {/* Keep drafts mounted while the reader switches sections. */}
        {SECTIONS.map(({ id, Component }) => (
          <div key={id} hidden={active !== id}>
            {id === "reading" ? <ReadingSection onOpenSiteRules={openSiteRules} /> : <Component />}
          </div>
        ))}
        <div hidden={active !== SITE_RULES_PAGE}><SiteRulesSection onBackToReading={backToReading} /></div>
      </main>
    </div>
  )
}
