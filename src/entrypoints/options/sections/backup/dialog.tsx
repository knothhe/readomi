import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import "./style.css"

export function BackupDialog({ title, children, onClose, busy = false }: { title: string, children: ReactNode, onClose: () => void, busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    if (typeof dialog.showModal === "function")
      dialog.showModal()
    else
      dialog.setAttribute("open", "")
    return () => dialog.close?.()
  }, [])
  return (
    <dialog
      ref={ref}
      className="settings-backup-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy)
          onClose()
      }}
    >
      <h2 className="text-[19px] font-semibold tracking-[-0.3px]">{title}</h2>
      {children}
    </dialog>
  )
}
