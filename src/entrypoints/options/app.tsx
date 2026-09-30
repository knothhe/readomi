import { useEffect, useState } from "react"
import { i18n } from "#imports"
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
  { id: "quality", title: "options.quality.title", Component: QualitySection },
  { id: "shortcut", title: "options.shortcut.title", Component: ShortcutSection },
  { id: "features", title: "features.title", Component: FeaturesSection },
  { id: "backup", title: "configBackup.title", Component: BackupSection },
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
        <nav aria-label={i18n.t("settingsNavigation.label")} className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map(({ id, title }) => (
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
        </nav>
      </aside>
      <main className="w-full min-w-0 max-w-[640px]">
        {/* Keep drafts mounted while the reader switches sections. */}
        {SECTIONS.map(({ id, Component }) => <div key={id} hidden={active !== id}><Component /></div>)}
      </main>
    </div>
  )
}
