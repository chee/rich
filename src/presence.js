// Who else is here. A Presence session per mounted tool broadcasts who we
// are and where our caret is, and draws everyone else's: a faces row over
// the page, and a caret and selection tint per peer in the text.
//
// The value shared with peers (and with the other Patchwork editors) is
//   { contactUrl, name, color, avatarUrl?, focused, cursor? }
// where `cursor` holds Automerge text cursors over the `content` field, so
// a caret survives everyone's edits without either side re-sending it.
import * as am from "@automerge/automerge"
import * as automergeRepo from "@automerge/automerge-repo"
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem"
import { Decoration, PointSet, RangeSet, Widget, Wordgard } from "wordgard/editor"
import { GardState, Transaction } from "wordgard/state"
import { indexUnits, indexFromPos, posFromIndex } from "./wordgard/index.js"

// Hosts still on an automerge-repo without the Presence class get an inert
// feature rather than a broken import.
const { Presence } = automergeRepo

const HEARTBEAT_MS = 2_000
const PEER_TTL_MS = 10_000
const CURSOR_THROTTLE_MS = 100
const REFRESH_MS = 50

// ── Self: the same two-hop resolution doc-presence uses. The account doc
// names a contact doc; the contact doc has the name, color and avatar. ──

const self = { contactUrl: null, name: null, color: null, avatarUrl: null }
const selfListeners = new Set()

let loadingSelf = null
function loadSelf() {
  if (!loadingSelf) loadingSelf = loadSelfOnce()
  return loadingSelf
}

async function loadSelfOnce() {
  let contactUrl
  while (!(contactUrl = window.accountDocHandle?.doc()?.contactUrl)) {
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  self.contactUrl = contactUrl
  const contactHandle = await window.repo.find(contactUrl)
  function refresh() {
    const c = contactHandle.doc()
    if (!c) return
    self.name = c.type === "registered" ? c.name : "Anonymous"
    self.color = c.color || null
    self.avatarUrl = (c.type === "registered" && c.avatarUrl) || null
    for (const listener of selfListeners) listener()
  }
  refresh()
  contactHandle.on("change", refresh)
}

// ── Faces ──

function face({ name, color, avatarUrl, focused }) {
  const div = document.createElement("div")
  div.className = "rich-presence-face"
  div.title = name || "?"
  div.style.setProperty("--presence-color", color || "#888")
  if (!focused) div.classList.add("rich-presence-away")
  div.textContent = (name || "?")[0].toUpperCase()
  if (avatarUrl) {
    try {
      div.style.backgroundImage = `url("${automergeUrlToServiceWorkerUrl(avatarUrl)}")`
      div.classList.add("rich-presence-avatar")
    } catch {}
  }
  return div
}

// ── Remote carets ──

const caretWidget = Widget.define({
  render: ({ color, name }) => {
    const caret = document.createElement("span")
    caret.className = "rich-presence-caret"
    caret.style.setProperty("--presence-color", color)
    caret.contentEditable = "false"
    const tag = document.createElement("span")
    tag.className = "rich-presence-caret-name"
    tag.textContent = name
    caret.append(tag)
    return caret
  },
  eq: (a, b) => a.color === b.color && a.name === b.name,
})

const nothing = { ranges: RangeSet.empty, carets: PointSet.empty }

export function presence(context) {
  const { handle, element } = context
  const refreshEffect = Transaction.Effect.define()

  let session = null

  // The units map is O(doc), so it is cached per document value.
  let unitsDoc = null
  let units = null
  const unitsFor = doc => {
    if (doc !== unitsDoc) {
      unitsDoc = doc
      units = indexUnits(context.adapter, doc)
    }
    return units
  }

  function build(state) {
    const doc = session?.presence && handle.doc()
    if (!doc) return nothing
    const map = unitsFor(state.doc)
    const ranges = []
    const carets = []
    for (const peer of session.remotePeers()) {
      const cursor = peer.value.cursor
      if (!cursor?.anchor || !cursor?.head) continue
      let anchor, head
      try {
        anchor = am.getCursorPosition(doc, ["content"], cursor.anchor)
        head = am.getCursorPosition(doc, ["content"], cursor.head)
      } catch {
        continue
      }
      const anchorPos = posFromIndex(map, anchor)
      const headPos = posFromIndex(map, head)
      const color = peer.value.color || "#888"
      if (anchorPos !== headPos) {
        ranges.push([
          Math.min(anchorPos, headPos),
          Math.max(anchorPos, headPos),
          Decoration.Range.wrapper("span", {
            attributes: {
              class: "rich-presence-selection",
              style: `--presence-color: ${color}`,
            },
            scope: "all",
          }),
        ])
      }
      carets.push([
        headPos,
        Decoration.Point.widget(
          caretWidget.of({ color, name: peer.value.name || "?" }),
        ),
      ])
    }
    ranges.sort((a, b) => a[0] - b[0])
    carets.sort((a, b) => a[0] - b[0])
    return { ranges: RangeSet.create(ranges), carets: PointSet.create(carets) }
  }

  const field = GardState.Field.define({
    create: () => nothing,
    update(value, tr) {
      if (tr.effects.some(effect => effect.is(refreshEffect))) {
        return build(tr.state)
      }
      if (tr.docChanged) {
        return {
          ranges: value.ranges.map(tr.changes),
          carets: value.carets.map(tr.changes),
        }
      }
      return value
    },
    provide: field => [
      Decoration.Range.source.of(state => state.field(field).ranges),
      Decoration.Point.source.of(state => state.field(field).carets),
    ],
  })

  const plugin = Wordgard.Plugin.fromClass(
    class {
      constructor(wg) {
        this.wg = wg
        this.presence = null
        this.strip = null
        this.stopped = true
        this.refreshTimer = null
        this.cursorTimer = null
        this.onSelf = () => {
          this.renderFaces()
          if (!this.presence?.running) return
          this.presence.broadcast("name", self.name)
          this.presence.broadcast("color", self.color)
          if (self.avatarUrl) this.presence.broadcast("avatarUrl", self.avatarUrl)
        }
        this.onFocusChange = () => {
          this.presence?.broadcast("focused", document.hasFocus())
          this.renderFaces()
        }
        this.onPageHide = () => this.presence?.stop()
        this.onDocChange = () => this.scheduleRefresh()
        this.scheduleRefresh = this.scheduleRefresh.bind(this)
        session = this
      }

      connect() {
        this.start()
      }

      disconnect() {
        this.stop()
      }

      remove() {
        this.stop()
      }

      async start() {
        if (!Presence) return
        this.stopped = false
        this.strip = document.createElement("div")
        this.strip.className = "rich-presence"
        ;(element.querySelector(".rich-page") ?? element).append(this.strip)

        await loadSelf()
        if (this.stopped) return

        this.presence = new Presence({ handle })
        this.presence.start({
          initialState: this.localState(),
          heartbeatMs: HEARTBEAT_MS,
          peerTtlMs: PEER_TTL_MS,
        })
        for (const event of ["update", "snapshot", "goodbye", "pruned"]) {
          this.presence.on(event, this.scheduleRefresh)
        }
        handle.on("change", this.onDocChange)
        selfListeners.add(this.onSelf)
        window.addEventListener("focus", this.onFocusChange)
        window.addEventListener("blur", this.onFocusChange)
        window.addEventListener("pagehide", this.onPageHide)
        this.renderFaces()
      }

      stop() {
        this.stopped = true
        if (this.refreshTimer) clearTimeout(this.refreshTimer)
        if (this.cursorTimer) clearTimeout(this.cursorTimer)
        this.refreshTimer = null
        this.cursorTimer = null
        handle.off("change", this.onDocChange)
        selfListeners.delete(this.onSelf)
        window.removeEventListener("focus", this.onFocusChange)
        window.removeEventListener("blur", this.onFocusChange)
        window.removeEventListener("pagehide", this.onPageHide)
        this.presence?.stop()
        this.presence = null
        this.strip?.remove()
        this.strip = null
      }

      localState() {
        const state = {
          contactUrl: self.contactUrl,
          name: self.name,
          color: self.color,
          focused: document.hasFocus(),
        }
        if (self.avatarUrl) state.avatarUrl = self.avatarUrl
        const cursor = this.cursorValue()
        if (cursor) state.cursor = cursor
        return state
      }

      cursorValue() {
        const doc = handle.doc()
        if (!doc) return undefined
        const map = unitsFor(this.wg.state.doc)
        const selection = this.wg.state.selection
        const at = pos => {
          const index = indexFromPos(map, pos)
          return am.getCursor(doc, ["content"], index >= map.length ? "end" : index)
        }
        try {
          return { anchor: at(selection.anchor), head: at(selection.head) }
        } catch {
          return undefined
        }
      }

      remotePeers() {
        if (!this.presence) return []
        return this.presence
          .getPeerStates()
          .peers.filter(
            peer =>
              peer.value?.contactUrl && peer.value.contactUrl !== self.contactUrl,
          )
      }

      update(update) {
        if (!update.selectionSet && !update.docChanged) return
        if (this.cursorTimer) return
        this.cursorTimer = setTimeout(() => {
          this.cursorTimer = null
          if (!this.presence?.running) return
          const cursor = this.cursorValue()
          if (cursor) this.presence.broadcast("cursor", cursor)
        }, CURSOR_THROTTLE_MS)
      }

      scheduleRefresh() {
        if (this.refreshTimer) return
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = null
          if (this.stopped) return
          this.renderFaces()
          this.wg.dispatch({
            effects: refreshEffect.of(null),
            annotations: [Transaction.addToHistory.of(false)],
          })
        }, REFRESH_MS)
      }

      renderFaces() {
        if (!this.strip) return
        this.strip.replaceChildren()
        if (self.contactUrl) {
          this.strip.append(
            face({
              name: self.name,
              color: self.color,
              avatarUrl: self.avatarUrl,
              focused: document.hasFocus(),
            }),
          )
        }
        const byContact = new Map()
        for (const peer of this.remotePeers()) {
          const previous = byContact.get(peer.value.contactUrl)
          if (!previous || peer.lastUpdateAt > previous.lastUpdateAt) {
            byContact.set(peer.value.contactUrl, peer)
          }
        }
        for (const peer of byContact.values()) this.strip.append(face(peer.value))
      }
    },
  )

  return [field.extension, plugin.extension]
}
