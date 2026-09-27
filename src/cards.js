// `<rich-card block-type="…" attrs="{…}">` — a block another editor wrote as
// an embed that this one has no node for. The document keeps the block
// exactly as it came; this only draws it. Lush's calendar events get a card
// (title, when, where, in the event's colour); anything else a chip naming
// its type.
import { el, svg } from "./dom.js"

const NAME = "rich-card"

const STYLE = `
  :host {
    display: block;
    margin: 0.4rem 0;
    user-select: none;
  }
  .card {
    display: flex;
    gap: 0.6rem;
    align-items: stretch;
    padding: 0.55rem 0.75rem;
    border-radius: 12px;
    background: color-mix(in oklch, var(--card-colour, var(--rich-accent, #ff4d97)) 12%, transparent);
    font: 0.875rem/1.35 var(--rich-family, system-ui, sans-serif);
    color: inherit;
  }
  .bar {
    flex: none;
    width: 4px;
    border-radius: 2px;
    background: var(--card-colour, var(--rich-accent, #ff4d97));
  }
  .title { font-weight: 600; }
  .meta { color: var(--rich-muted, #888); font-size: 0.8125rem; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: var(--rich-sunk, rgba(127, 127, 127, 0.12));
    color: var(--rich-muted, #888);
    font: 0.75rem var(--rich-family, system-ui, sans-serif);
  }
`

const text = value => (value == null ? "" : String(value))

function when(attrs) {
  const start = new Date(text(attrs.start))
  if (Number.isNaN(start.getTime())) return text(attrs.start)
  const day = { weekday: "short", month: "short", day: "numeric" }
  if (attrs.allDay) return start.toLocaleDateString(undefined, day)
  const time = { hour: "numeric", minute: "2-digit" }
  const end = attrs.end ? new Date(text(attrs.end)) : null
  const from = start.toLocaleString(undefined, { ...day, ...time })
  if (!end || Number.isNaN(end.getTime())) return from
  return `${from} – ${end.toLocaleTimeString(undefined, time)}`
}

class RichCard extends HTMLElement {
  static observedAttributes = ["block-type", "attrs"]

  connectedCallback() {
    this.contentEditable = "false"
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" })
      this.build()
    }
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.build()
  }

  build() {
    let attrs = {}
    try {
      attrs = JSON.parse(this.getAttribute("attrs") || "{}")
    } catch {
      // an unreadable block draws as its type alone
    }
    const type = this.getAttribute("block-type") || "block"
    let body
    if (type === "calendar-event") {
      body = el(
        "div",
        { class: "card", style: attrs.color ? `--card-colour:${text(attrs.color)}` : null },
        el("span", { class: "bar" }),
        el(
          "div",
          {},
          el("div", { class: "title" }, text(attrs.title) || "Event"),
          el("div", { class: "meta" }, [when(attrs), text(attrs.location)].filter(Boolean).join(" · ")),
          attrs.calendar ? el("div", { class: "meta" }, text(attrs.calendar)) : null,
        ),
      )
    } else {
      body = el(
        "span",
        { class: "chip", title: `A ${type} block, kept as it is` },
        svg(`<rect x="2.5" y="3.5" width="11" height="9" rx="2"/>`, 12),
        type,
      )
    }
    this.shadowRoot.replaceChildren(el("style", {}, STYLE), body)
  }
}

if (!customElements.get(NAME)) customElements.define(NAME, RichCard)
