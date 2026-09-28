// A logline: the moment the note was written, dropped into it as a line —
// time, weather, where you were, what was playing. chee's Swift notes app
// writes these as a `context` block whose attrs hold the facts, so this is the
// same block from the other side: whatever facts a platform can gather, the
// rest stay absent.
//
// The block's parameter is JSON, because the block has several attrs and a
// leaf carries one value. The mapping to and from `context` attrs is in
// adapter.js; the shape of the facts is here.
import { Leaf, Node } from "wordgard/doc"
import { el, svg } from "./dom.js"
import { insertBlocks } from "./insert.js"
import { openSheet, sheetButton, sheetButtons } from "./sheet.js"

const NAME = "rich-logline"

// The facts lush writes. Providers add more (`nowPlaying`, say); those are
// kept too, and shown as extra rows in the logline form.
export const LOGLINE_FACTS = ["ts", "created", "tz", "location", "lat", "lon", "weather", "nowPlaying", "pending"]

export const Logline = Leaf.Type.define("Logline", {
  group: Node.Group.Content,
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
  const facts = { [kind]: stamp(), tz: timeZone() }
  const place = await coordsIfAllowed()
  if (place) {
    facts.lat = place.latitude
    facts.lon = place.longitude
  }
  return Logline.of(JSON.stringify(facts))
}

// Whether the browser knows a time zone by this name.
export function knownZone(name) {
  if (typeof name !== "string" || !name) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name })
    return true
  } catch {
    return false
  }
}

export const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

// The wall clock in `zone` at `date`: year, month, day, hour, minute, second.
function wallClock(date, zone) {
  if (!knownZone(zone)) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const part = type => Number(parts.find(p => p.type === type)?.value)
  return [part("year"), part("month"), part("day"), part("hour") % 24, part("minute"), part("second")]
}

// How many minutes `zone` is ahead of UTC at `date`.
function zoneOffset(date, zone) {
  if (!knownZone(zone)) return -date.getTimezoneOffset()
  const [y, mo, d, h, mi, s] = wallClock(date, zone)
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

const pad = (n, width = 2) => String(Math.abs(Math.trunc(n))).padStart(width, "0")

// `YYYY-MM-DDTHH:MM:SS±hh:mm`, `Z` for no offset: what lush's
// ISO8601DateFormatter writes and reads, in the logline's own zone (this
// browser's unless one is given). It takes no fractional seconds, so
// `toISOString()` would show no time.
export function stamp(date = new Date(), zone = null) {
  const [y, mo, d, h, mi, s] = wallClock(date, zone)
  const offset = zoneOffset(date, zone)
  const sign = offset >= 0 ? "+" : "-"
  const at = offset === 0 ? "Z" : `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${at}`
}

// The wall clock in `zone` as a datetime-local input shows it, and back.
const localValue = (date, zone) => {
  const [y, mo, d, h, mi, s] = wallClock(date, zone)
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`
}
function fromLocalValue(value, zone) {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/.exec(value ?? "")
  if (!match) return null
  const [y, mo, d, h, mi, s = 0] = match.slice(1).map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  // the offset at that moment, which itself depends on the moment
  let time = wall - zoneOffset(new Date(wall), zone) * 60000
  time = wall - zoneOffset(new Date(time), zone) * 60000
  return new Date(time)
}

// How lush says when a logline was written (its default "yMMMdjmmz"), in the
// zone it was written in: a logline is a record of a moment somewhere, and
// flying home shouldn't rewrite the notebook.
export function stampText(value, zone) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const options = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }
  return date.toLocaleString(undefined, knownZone(zone) ? { ...options, timeZone: zone } : options)
}

// A latitude and a longitude, only when both are numbers and in range. A lone
// or impossible coordinate is worse than none: a map would put a pin in the
// wrong place (lush's LoglineDraft.coordinate).
export function coordinate(lat, lon) {
  const read = value => (typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN)
  const a = read(lat)
  const b = read(lon)
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null
  return { lat: a, lon: b }
}

export async function insertLogline(wg) {
  insertBlocks(wg, [await loglineNow()])
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

// Lush's map link: the place by name, pinned when there is a coordinate.
const mapUrl = (facts, point) => {
  const query = [
    facts.location ? `q=${encodeURIComponent(facts.location)}` : null,
    point ? `ll=${point.lat},${point.lon}` : null,
  ].filter(Boolean)
  return query.length ? `https://maps.apple.com/?${query.join("&")}` : null
}

class RichLogline extends HTMLElement {
  static observedAttributes = ["facts"]

  connectedCallback() {
    this.contentEditable = "false"
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" })
      this.shadowRoot.append(el("style", {}, STYLE))
      this.build()
      // a double click asks the editor to open it in the Logline sheet
      this.addEventListener("dblclick", event => {
        event.preventDefault()
        this.dispatchEvent(new CustomEvent("rich-logline-edit", { bubbles: true, composed: true }))
      })
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
    const time = stampText(facts.created ?? facts.ts, facts.tz)
    if (time) row.append(fact("clock", time))
    if (facts.weather) row.append(fact("weather", String(facts.weather)))
    // the place by name, or where it was when there is no name
    const point = coordinate(facts.lat, facts.lon)
    const place = facts.location ? String(facts.location) : point ? `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}` : null
    if (place) row.append(fact("location", place, mapUrl(facts, point)))
    const playing = facts.nowPlaying ?? facts.now_playing
    if (playing) row.append(fact("music", playing))
    if (facts.pending) row.append(el("span", { class: "rich-logline-fact rich-logline-pending" }, "…"))
    this.shadowRoot.querySelector(".rich-logline")?.remove()
    this.shadowRoot.append(row)
  }
}

if (!customElements.get(NAME)) customElements.define(NAME, RichLogline)

// Logline…: lush's logline editor, as a sheet. When, where, the weather, and
// the details a provider added, as key/value rows. Saving writes what lush's
// LoglineDraft writes: the stamp in the chosen zone, only a whole coordinate,
// the text details as the rows say, and whatever else the logline held kept.
const RESERVED = new Set(["created", "ts", "tz", "location", "lat", "lon", "weather", "pending"])

let zoneList = null
const zoneOptions = () => {
  if (!zoneList) {
    let zones = []
    try {
      zones = Intl.supportedValuesOf?.("timeZone") ?? []
    } catch {}
    zoneList = el("datalist", { id: "rich-time-zones" }, ...zones.map(zone => el("option", { value: zone })))
  }
  return zoneList
}

// `found` is the logline being edited ({node, pos}), or nothing for a new one.
export function loglineSheet(wg, parent, found) {
  let facts = {}
  if (found) {
    try {
      facts = JSON.parse(found.node.param || "{}")
    } catch {}
  }
  // A note's opening logline is its `created` one: editing keeps which it is.
  const stampKey = facts.created != null ? "created" : "ts"
  const zone = knownZone(facts.tz) ? facts.tz : timeZone()
  const when = new Date(facts[stampKey] ?? Date.now())
  const date = Number.isNaN(when.getTime()) ? new Date() : when

  const field = (label, input) => el("label", { class: "rich-form-field" }, el("span", {}, label), input)
  const input = (name, value, extra = {}) =>
    el("input", { name, type: "text", autocomplete: "off", value: value == null ? "" : String(value), ...extra })
  const whenInput = el("input", { name: "when", type: "datetime-local", step: "1", value: localValue(date, zone) })
  const zoneInput = input("tz", zone, { list: "rich-time-zones", spellcheck: "false" })
  const placeInput = input("location", facts.location)
  const latInput = input("lat", facts.lat, { inputmode: "decimal", spellcheck: "false" })
  const lonInput = input("lon", facts.lon, { inputmode: "decimal", spellcheck: "false" })
  const weatherInput = input("weather", facts.weather)
  const coordinateNote = el("p", { class: "rich-sheet-note rich-form-warning" }, "Needs both, as numbers, within ±90 and ±180. Saving now drops them.")
  const zoneNote = el("p", { class: "rich-sheet-note rich-form-warning" }, "Not a time zone this browser knows.")
  const preview = el("p", { class: "rich-sheet-note" })

  const extras = el("div", { class: "rich-form-extras" })
  const extraRow = (key = "", value = "") =>
    el(
      "div",
      { class: "rich-form-extra" },
      el("input", { class: "rich-extra-key", type: "text", placeholder: "Key", value: key, "aria-label": "Key", spellcheck: "false" }),
      el("input", { class: "rich-extra-value", type: "text", placeholder: "Value", value, "aria-label": "Value" }),
      el("button", { type: "button", class: "rich-extra-remove", title: "Remove", "aria-label": "Remove", onclick: event => event.currentTarget.closest(".rich-form-extra").remove() }, "−"),
    )
  // only the details that are text: anything else isn't retyped as a string
  for (const key of Object.keys(facts).sort()) {
    if (!RESERVED.has(key) && typeof facts[key] === "string") extras.append(extraRow(key, facts[key]))
  }

  const save = sheetButton(found ? "Save" : "Insert", null, { prominent: true, type: "submit" })
  const refresh = () => {
    const lat = latInput.value.trim()
    const lon = lonInput.value.trim()
    coordinateNote.hidden = !((lat || lon) && !coordinate(lat, lon))
    const zoneKnown = knownZone(zoneInput.value.trim())
    zoneNote.hidden = zoneKnown
    const moment = zoneKnown ? fromLocalValue(whenInput.value, zoneInput.value.trim()) : null
    save.disabled = !moment
    preview.textContent = moment ? stampText(moment, zoneInput.value.trim()) : ""
  }

  const card = el(
    "form",
    {
      class: "rich-logline-card",
      novalidate: true,
      oninput: refresh,
      onsubmit: event => {
        event.preventDefault()
        const tz = zoneInput.value.trim()
        const moment = knownZone(tz) ? fromLocalValue(whenInput.value, tz) : null
        if (!moment) return
        const next = { ...facts }
        // filled in by hand, so there is nothing for a refresh to chase
        delete next.pending
        next[stampKey] = stamp(moment, tz)
        delete next[stampKey === "created" ? "ts" : "created"]
        next.tz = tz
        for (const [name, box] of [["location", placeInput], ["weather", weatherInput]]) {
          const value = box.value.trim()
          if (value) next[name] = value
          else delete next[name]
        }
        // the rows are the text details now, so a removed row is gone
        for (const key of Object.keys(next)) if (!RESERVED.has(key) && typeof next[key] === "string") delete next[key]
        for (const row of extras.querySelectorAll(".rich-form-extra")) {
          const key = row.querySelector(".rich-extra-key").value.trim()
          if (key && !RESERVED.has(key)) next[key] = row.querySelector(".rich-extra-value").value.trim()
        }
        const point = coordinate(latInput.value, lonInput.value)
        if (point) Object.assign(next, point)
        else {
          delete next.lat
          delete next.lon
        }
        sheet.close()
        const leaf = Logline.of(JSON.stringify(next))
        // the note may have moved on while the sheet was up
        const at = found && loglinePos(wg.state.doc, found)
        if (at != null) wg.dispatch({ changes: { from: at, to: at + 1, insert: [leaf] }, userEvent: "input.logline" })
        else if (!found) insertBlocks(wg, [leaf])
        wg.focus()
      },
    },
    el("h3", { class: "rich-sheet-title" }, found ? "Edit Logline" : "New Logline"),
    el("h4", { class: "rich-form-section" }, "When"),
    field("Date and time", whenInput),
    field("Time zone", zoneInput),
    zoneNote,
    zoneOptions(),
    el("h4", { class: "rich-form-section" }, "Where"),
    field("Place", placeInput),
    field("Latitude", latInput),
    field("Longitude", lonInput),
    coordinateNote,
    el("h4", { class: "rich-form-section" }, "Weather"),
    field("Weather", weatherInput),
    el("h4", { class: "rich-form-section" }, "Details"),
    extras,
    el("button", { type: "button", class: "rich-form-add", onclick: () => extras.append(extraRow()) }, "Add Detail"),
    el("p", { class: "rich-sheet-note" }, "Anything else the logline records — what was playing, who was there. A row with no key is dropped."),
    el("h4", { class: "rich-form-section" }, "Preview"),
    preview,
    sheetButtons(null, [sheetButton("Cancel", () => sheet.cancel()), save]),
  )
  const sheet = openSheet(parent, {
    label: found ? "Edit Logline" : "New Logline",
    className: "rich-logline-sheet",
    card,
    onCancel: () => wg.focus(),
  })
  refresh()
  whenInput.focus()
  return sheet.sheet
}

// Where the logline being edited is now: where it was, or else the one
// with the same facts.
function loglinePos(doc, found) {
  const at = found.pos <= doc.contentLength - 1 ? doc.resolve(found.pos).nodeAfter : null
  if (at && at.type === Logline && at.param === found.node.param) return found.pos
  let pos = null
  doc.iterate(0, doc.contentLength, (node, p) => {
    if (pos == null && node.type === Logline && node.param === found.node.param) pos = p
  })
  return pos
}
