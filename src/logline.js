// A logline: the moment the note was written, dropped into it as a line —
// time, weather, where you were, what was playing. chee's Swift notes app
// writes these as a `context` block whose attrs hold the facts, so this is the
// same block from the other side: whatever facts a platform can gather, the
// rest stay absent.
//
// The block's parameter is JSON, because the block has several attrs and a
// leaf carries one value. The mapping to and from `context` attrs is in
// adapter.js; the shape of the facts is here.
import { Leaf } from "wordgard/doc"
import { el, svg } from "./dom.js"

const NAME = "rich-logline"

export const LOGLINE_FACTS = ["ts", "created", "location", "lat", "lon", "weather", "now_playing"]

export const Logline = Leaf.Type.define("Logline", {
  inline: true,
  validate: "string",
  selectable: true,
  shape: {
    element: NAME,
    attributes: facts => ({ facts }),
  },
})

// A leaf for the facts we can gather here: the time, and the place when the
// browser will give it without asking.
export async function loglineNow(kind = "ts") {
  const facts = { [kind]: new Date().toISOString() }
  const place = await coordsIfAllowed()
  if (place) {
    facts.lat = place.latitude
    facts.lon = place.longitude
  }
  return Logline.of(JSON.stringify(facts))
}

export async function insertLogline(wg) {
  const leaf = await loglineNow()
  wg.dispatch({
    changes: { from: wg.state.selection.head, insert: [leaf], fit: true },
    scrollIntoView: true,
  })
  wg.focus()
}

// Only when the page already has permission: a note-taking gesture shouldn't
// raise a location prompt.
async function coordsIfAllowed() {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" })
    if (status?.state !== "granted") return null
    return await new Promise(resolve =>
      navigator.geolocation.getCurrentPosition(
        position => resolve(position.coords),
        () => resolve(null),
        { timeout: 3000, maximumAge: 300000 },
      ),
    )
  } catch {
    return null
  }
}

const STYLE = `
  :host {
    display: block;
    margin: 0.4rem 0;
    user-select: none;
  }
  .rich-logline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    font: 0.75rem var(--rich-family, system-ui, sans-serif);
    color: var(--rich-muted, #888);
  }
  .rich-logline-fact {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }
  a.rich-logline-fact { color: inherit; text-decoration: none; }
  a.rich-logline-fact:hover { text-decoration: underline; }
`

const GLYPHS = {
  clock: `<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>`,
  weather: `<path d="M4.5 12a3 3 0 01.2-6 4 4 0 017.5 1.2A2.5 2.5 0 0111.5 12z"/>`,
  location: `<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 10-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.5"/>`,
  music: `<path d="M6 12V4l7-1.5V10"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="11.5" cy="10" r="1.5"/>`,
}

const fact = (name, text, href) =>
  el(
    href ? "a" : "span",
    href
      ? { class: "rich-logline-fact", href, target: "_blank", rel: "noreferrer" }
      : { class: "rich-logline-fact" },
    svg(GLYPHS[name], 12),
    text,
  )

// A creation stamp says the date; a logline mid-note is a time of day.
const timeText = (value, withDate) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    ...(withDate ? { year: "numeric", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  })
}

const mapUrl = facts => {
  if (facts.lat == null || facts.lon == null) return null
  const query = facts.location ? `${encodeURIComponent(facts.location)}&` : ""
  return `https://maps.apple.com/?${query}ll=${facts.lat},${facts.lon}`
}

class RichLogline extends HTMLElement {
  static observedAttributes = ["facts"]

  connectedCallback() {
    this.contentEditable = "false"
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" })
      this.shadowRoot.append(el("style", {}, STYLE))
      this.build()
    }
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.build()
  }

  build() {
    let facts = {}
    try {
      facts = JSON.parse(this.getAttribute("facts") || "{}")
    } catch {
      // an unreadable logline is an empty one
    }
    const row = el("div", { class: "rich-logline" })
    const time = timeText(facts.created ?? facts.ts, facts.created != null)
    if (time) row.append(fact("clock", time))
    if (facts.weather) row.append(fact("weather", facts.weather))
    const place = facts.location ?? (facts.lat != null ? `${facts.lat.toFixed?.(3) ?? facts.lat}, ${facts.lon.toFixed?.(3) ?? facts.lon}` : null)
    if (place) row.append(fact("location", place, mapUrl(facts)))
    if (facts.now_playing) row.append(fact("music", facts.now_playing))
    this.shadowRoot.querySelector(".rich-logline")?.remove()
    this.shadowRoot.append(row)
  }
}

if (!customElements.get(NAME)) customElements.define(NAME, RichLogline)
