import type { HTMLAttributes } from "react"
import { animate } from "motion"
import { Component, createRef } from "react"

interface PopupStateFadeProps extends HTMLAttributes<HTMLDivElement> {
  paused: boolean
}

/** Capture before React changes disabled styles; fade only an inert visual copy. */
export class PopupStateFade extends Component<PopupStateFadeProps> {
  private root = createRef<HTMLDivElement>()
  private overlay: HTMLElement | null = null
  private animation: ReturnType<typeof animate> | null = null
  private reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")

  override componentDidMount() {
    this.reducedMotion?.addEventListener("change", this.clearOverlay)
  }

  override getSnapshotBeforeUpdate(previous: PopupStateFadeProps): HTMLElement | null {
    const root = this.root.current
    if (previous.paused === this.props.paused || !root || this.reducedMotion?.matches)
      return null
    const { width, height } = root.getBoundingClientRect()
    if (!width || !height)
      return null

    const clone = root.cloneNode(true) as HTMLElement
    const originals = [root, ...root.querySelectorAll<HTMLElement | SVGElement>("*")]
    const copies = [clone, ...clone.querySelectorAll<HTMLElement | SVGElement>("*")]
    originals.forEach((original, index) => {
      const style = getComputedStyle(original)
      // Includes an interrupted fade, so reversing never jumps to a stale endpoint.
      for (const property of ["color", "background-color", "box-shadow", "opacity", "transform", "translate"])
        copies[index].style.setProperty(property, style.getPropertyValue(property))
      copies[index].removeAttribute("id")
    })
    clone.classList.remove("popup-feature-row")
    clone.classList.add("popup-state-overlay")
    clone.setAttribute("aria-hidden", "true")
    clone.inert = true
    return clone
  }

  override componentDidUpdate(_previous: PopupStateFadeProps, _state: unknown, snapshot: HTMLElement | null) {
    if (!snapshot)
      return
    this.clearOverlay()
    this.root.current?.append(snapshot)
    this.overlay = snapshot
    const animation = animate(snapshot, { opacity: [1, 0] }, { duration: 0.72, ease: [0.22, 1, 0.36, 1] })
    this.animation = animation
    void animation.then(() => {
      if (this.animation === animation)
        this.clearOverlay()
    })
  }

  override componentWillUnmount() {
    this.reducedMotion?.removeEventListener("change", this.clearOverlay)
    this.clearOverlay()
  }

  private clearOverlay = () => {
    this.animation?.stop()
    this.animation = null
    this.overlay?.remove()
    this.overlay = null
  }

  override render() {
    const { paused: _paused, className = "", children, ...props } = this.props
    return <div {...props} ref={this.root} className={`popup-state-fade ${className}`}>{children}</div>
  }
}
