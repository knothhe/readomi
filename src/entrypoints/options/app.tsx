import { useEffect, useState } from "react"
import { i18n } from "#imports"
import { AppearanceSection } from "./sections/appearance"
import { BackupSection } from "./sections/backup"
import { FeaturesSection } from "./sections/features"
import { SettingsHeader } from "./sections/header"
import { QualitySection } from "./sections/quality"
import { ReadingSection } from "./sections/reading"
import { ServiceSection } from "./sections/service"
import { ShortcutSection } from "./sections/shortcut"

const SECTIONS = [
  { id: "service", group: "translation", title: "options.service.title", Component: ServiceSection },
  { id: "quality", group: "translation", title: "options.quality.title", Component: QualitySection },
  { id: "reading", group: "reading", title: "options.reading.title", Component: ReadingSection },
  { id: "features", group: "reading", title: "features.title", Component: FeaturesSection },
  { id: "shortcut", group: "reading", title: "options.shortcut.title", Component: ShortcutSection },
  { id: "appearance", group: "extension", title: "options.appearance.title", Component: AppearanceSection },
  { id: "backup", group: "extension", title: "configBackup.title", Component: BackupSection },
] as const

const NAVIGATION_GROUPS = [
  { id: "translation", title: "settingsNavigation.groups.translation" },
  { id: "reading", title: "settingsNavigation.groups.reading" },
  { id: "extension", title: "settingsNavigation.groups.extension" },
] as const

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

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-6 pt-12 pb-16 text-[13px] md:flex-row md:gap-10">
      <aside className="flex flex-col gap-8 md:sticky md:top-12 md:w-44 md:shrink-0 md:self-start">
        <SettingsHeader />
        <nav aria-label={i18n.t("settingsNavigation.label")} className="flex gap-6 overflow-x-auto md:flex-col md:gap-5">
          {NAVIGATION_GROUPS.map(group => (
            <div key={group.id} role="group" aria-labelledby={`nav-${group.id}`} className="flex shrink-0 flex-col gap-2">
              <h2 id={`nav-${group.id}`} className="px-3 text-[11px] font-medium tracking-wide text-muted-foreground">{i18n.t(group.title)}</h2>
              <div className="flex gap-1 md:flex-col">
                {SECTIONS.filter(section => section.group === group.id).map(({ id, title }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    aria-current={active === id ? "page" : undefined}
                    className={`rounded-lg px-3 py-2.5 whitespace-nowrap md:whitespace-normal ${active === id ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
                    onClick={(event) => {
                      event.preventDefault()
                      if (active === id)
                        return
                      window.history.pushState(null, "", `#${id}`)
                      setActive(id)
                      window.scrollTo?.({ top: 0 })
                    }}
                  >
                    {i18n.t(title)}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <main className="w-full min-w-0 max-w-[640px]">
        {/* Keep drafts mounted while the reader switches sections. */}
        {SECTIONS.map(({ id, Component }) => <div key={id} hidden={active !== id}><Component /></div>)}
      </main>
    </div>
  )
}
