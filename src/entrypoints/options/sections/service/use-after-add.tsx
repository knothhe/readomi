import { i18n } from "#imports"

export function UseAfterAdd({ value, onChange, disabled }: { value: boolean, onChange?: (value: boolean) => void, disabled?: boolean }) {
  if (!onChange)
    return null
  return (
    <div className="settings-service-use-after-add">
      <label>
        <input type="checkbox" disabled={disabled} checked={value} onChange={event => onChange(event.target.checked)} />
        {i18n.t("options.service.useAfterAdd")}
      </label>
      <p>{i18n.t("options.service.useAfterAddHint")}</p>
    </div>
  )
}
