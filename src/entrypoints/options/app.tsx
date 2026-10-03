import { useEffect, useState } from "react"
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

const SECTIONS = [
  { id: "service", title: "options.service.title", Component: ServiceSection },
  { id: "reading", title: "options.reading.title", Component: ReadingSection },
  { id: "features", title: "features.title", Component: FeaturesSection },
  { id: "quality", title: "options.quality.title", Component: QualitySection },
  { id: "shortcut", title: "options.shortcut.title", Component: ShortcutSection },
  { id: "appearance", title: "options.appearance.title", Component: AppearanceSection },
  { id: "backup", title: "configBackup.title", Component: BackupSection },
] as const

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

function sectionFromHash() {
  const hash = window.location.hash.slice(1)
  return SECTIONS.find(section => section.id === hash)?.id ?? "service"
}

export default function App() {
  const [active, setActive] = useState(sectionFromHash)
  useEffect(() => {
    const update = () => setActive(sectionFromHash())
    window.addEventListener("hashchange", update)
    window.addEventListener("popstate", update)
    return () => {
      window.removeEventListener("hashchange", update)
      window.removeEventListener("popstate", update)
    }
  }, [])
  useEffect(() => {
    const keepActiveVisible = () => {
      const link = document.querySelector<HTMLElement>(`.options-navigation a[href="#${active}"]`)
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
  }, [active])

  return (
    <div className="options-shell">
      <aside className="options-sidebar">
        <SettingsHeader />
        <nav aria-label={i18n.t("settingsNavigation.label")} className="options-navigation">
          {SECTIONS.map(({ id, title }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "page" : undefined}
              className="options-nav-link"
              onClick={(event) => {
                event.preventDefault()
                if (active === id)
                  return
                window.history.pushState(null, "", `#${id}`)
                setActive(id)
                window.scrollTo?.({ top: 0 })
              }}
            >
              <NavigationIcon section={id} />
              <span className="options-nav-label">{i18n.t(title)}</span>
            </a>
          ))}
        </nav>
        <div className="options-sidebar-footer">{`${i18n.t("options.version")} ${EXTENSION_VERSION}`}</div>
      </aside>
      <main className="options-main">
        {/* Keep drafts mounted while the reader switches sections. */}
        {SECTIONS.map(({ id, Component }) => <div key={id} hidden={active !== id}><Component /></div>)}
      </main>
    </div>
  )
}
