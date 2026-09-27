// Todo lists. A third kind of list beside bullets and numbers: its items map
// to `todo-list-item` blocks, and whether an item is done is a `checked` block
// attr — carried on the item's tag as the `Checked` mark, the way alignment
// and heading level ride on their blocks.
//
// The box itself is drawn by CSS on the item (see rich.css); clicking it is
// what this module handles, since the document is the editor's business.
import { InlineListItem, ListItem } from "wordgard/types"
import { Mark, Node, Plot } from "wordgard/doc"
import { InputRule, Wordgard } from "wordgard/editor"
import { Transaction } from "wordgard/state"

export const TodoList = Plot.define("TodoList", {
  blockContent: [ListItem, InlineListItem],
  group: Node.Group.Content,
  role: Node.Role.List,
  defining: true,
  shape: { element: "ul", attributes: { class: "rich-todo-list" } },
  autoJoin: true,
})

export const Checked = Mark.define("Checked", {
  target: ListItem,
  keepOnSplit: false,
  shape: { attribute: "data-checked", value: "true" },
})

// Lush's other two states: an item can be canceled (struck through) or
// pending (half-done), written as `state: "canceled" | "pending"`. Open is
// neither attr, done is `checked: true`.
export const TODO_STATES = ["canceled", "pending"]

export const TodoState = Mark.Type.define("TodoState", {
  target: ListItem,
  validate: "string",
  keepOnSplit: false,
  shape: { attribute: "data-state", value: 0 },
})

export const isChecked = tag => Checked.isInSet(tag.marks) != null

// "open", "checked", "canceled" or "pending".
export const todoStateOf = tag =>
  isChecked(tag) ? "checked" : (TodoState.isInSet(tag.marks)?.value ?? "open")

const stateName = value => {
  const name = value == null ? null : typeof value === "string" ? value : value.val
  return TODO_STATES.includes(name) ? name : null
}

export const todoParsers = {
  fromAutomerge: block => {
    if (block.attrs.checked === true) return Checked.addToSet(Mark.none)
    const state = stateName(block.attrs.state)
    return state ? TodoState.of(state).addToSet(Mark.none) : Mark.none
  },
  fromWordgard: node => {
    if (isChecked(node.tag)) return { checked: true }
    const state = TodoState.isInSet(node.tag.marks)
    return state ? { state: state.value } : {}
  },
}

// The changes that put the item at `pos` into `state`.
export function todoStateChanges(tag, pos, state) {
  const changes = []
  if (isChecked(tag)) changes.push({ from: pos, remove: Checked })
  const current = TodoState.isInSet(tag.marks)
  if (current) changes.push({ from: pos, remove: current })
  if (state === "checked") changes.push({ from: pos, add: Checked })
  else if (TODO_STATES.includes(state)) changes.push({ from: pos, add: TodoState.of(state) })
  return changes
}

const todoItemAt = (wg, element) => {
  const item = element.closest?.("ul.rich-todo-list > li")
  if (!item) return null
  const found = wg.nodeFromDOM(item)
  return found ? { ...found, element: item } : null
}

// The box lives in the item's left padding, so a click left of the content
// box is a click on the box.
const onTheBox = (event, element) => {
  const box = element.getBoundingClientRect()
  const padding = parseFloat(getComputedStyle(element).paddingInlineStart) || 0
  return event.clientX < box.left + padding
}

// `[] `, `[ ] `, `[x] `, `[-] ` or `[/] ` at the start of a line starts a
// to-do list in that state, the way `- ` starts a bullet one — lush's
// triggers.
const wrapTodo = InputRule.wrapping(/^ ?\[([ xX\-/]?)\] $/, TodoList)
const BRACKET_STATES = { x: "checked", X: "checked", "-": "canceled", "/": "pending" }

// A rule returns one transaction, and the item it makes doesn't exist until
// that has applied, so the state rides along as an annotation and is set on
// the new item right after.
const bracketState = Transaction.Annotation.define()

const createOnBrackets = InputRule.define({
  expr: /^ ?\[([ xX\-/]?)\] $/,
  apply: (state, match) => {
    const spec = wrapTodo.apply(state, match)
    const todo = BRACKET_STATES[match[1]?.text ?? ""]
    if (!spec || !todo) return spec
    return { ...spec, annotations: [].concat(spec.annotations ?? [], bracketState.of(todo)) }
  },
})

const applyBracketState = Wordgard.Plugin.define(wg => ({
  update(update) {
    for (const tr of update.transactions) {
      const todo = tr.annotation(bracketState)
      if (!todo) continue
      queueMicrotask(() => {
        const item = wg.state.sel.head.matchingParent(plot => plot.type === ListItem.type)
        if (item) wg.dispatch({ changes: todoStateChanges(item.node.tag, item.before, todo) })
      })
    }
  },
})).extension

// `wrap` lets the caller take the bracket rule over inside lists and quotes
// (see triggers.js, which imports this module).
export function todoLists(wrap = rule => rule) {
  return [
    wrap(createOnBrackets, match => ({ id: "todo", todo: BRACKET_STATES[match[1]?.text ?? ""] ?? "open" })).extension,
    applyBracketState,
    todoChecking(),
    todoStateMenu(),
  ]
}

function todoChecking() {
  return Wordgard.domEventHandler("mousedown", (event, wg) => {
    const found = todoItemAt(wg, event.target)
    if (!found || !onTheBox(event, found.element)) return false
    event.preventDefault()
    // The box ticks an open item and opens any other one.
    const state = todoStateOf(found.node.tag) === "open" ? "checked" : "open"
    wg.dispatch({
      changes: todoStateChanges(found.node.tag, found.pos, state),
      userEvent: "todo.check",
    })
    return true
  })
}

// Right-click on the box: lush's menu of the four states.
const STATE_LABELS = [
  ["open", "To-do"],
  ["checked", "Done"],
  ["canceled", "Canceled"],
  ["pending", "Pending"],
]

function todoStateMenu() {
  return Wordgard.domEventHandler("contextmenu", (event, wg) => {
    const found = todoItemAt(wg, event.target)
    if (!found || !onTheBox(event, found.element)) return false
    event.preventDefault()
    openTodoMenu(wg, found, event.clientX, event.clientY)
    return true
  })
}

export function openTodoMenu(wg, found, x, y) {
  const host = wg.dom.closest(".rich-tool") ?? document.body
  host.querySelector(".rich-todo-menu")?.remove()
  const current = todoStateOf(found.node.tag)
  const menu = document.createElement("div")
  menu.className = "rich-popover rich-todo-menu"
  menu.setAttribute("role", "menu")
  const body = document.createElement("div")
  body.className = "rich-popover-body"
  menu.append(body)
  const close = () => {
    menu.remove()
    document.removeEventListener("mousedown", outside, true)
    document.removeEventListener("keydown", escape, true)
  }
  const outside = event => {
    if (!menu.contains(event.target)) close()
  }
  const escape = event => {
    if (event.key !== "Escape") return
    event.preventDefault()
    close()
    wg.focus()
  }
  for (const [state, label] of STATE_LABELS) {
    const item = document.createElement("button")
    item.type = "button"
    item.className = "rich-menu-item"
    item.setAttribute("role", "menuitemradio")
    item.setAttribute("aria-checked", String(state === current))
    item.dataset.state = state
    const check = document.createElement("span")
    check.className = "rich-menu-glyph"
    check.textContent = state === current ? "✓" : ""
    const text = document.createElement("span")
    text.className = "rich-menu-label"
    text.textContent = label
    item.append(check, text)
    item.addEventListener("mousedown", event => event.preventDefault())
    item.addEventListener("click", event => {
      event.preventDefault()
      close()
      // the item may have moved while the menu was open
      const now = wg.nodeFromDOM(found.element) ?? found
      const changes = todoStateChanges(now.node.tag, now.pos, state)
      if (changes.length) wg.dispatch({ changes, userEvent: "todo.state" })
    })
    body.append(item)
  }
  host.append(menu)
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`
  document.addEventListener("mousedown", outside, true)
  document.addEventListener("keydown", escape, true)
  return menu
}

// ••• › Move Checked to Bottom and Delete Checked Items, lush's list actions.
// Both work on every to-do list in the note; an item takes what is nested in
// it along.
const itemsOf = list => list.content.filter(node => node.isPlot)

function outerTodoLists(doc) {
  const lists = []
  doc.iterate((node, pos) => {
    if (!node.isPlot || node.type !== TodoList.type) return
    lists.push({ node, pos })
    return false
  })
  return lists
}

export function moveCheckedToBottom(wg) {
  const changes = []
  for (const { node, pos } of outerTodoLists(wg.state.doc)) {
    const items = itemsOf(node)
    const open = items.filter(item => !isChecked(item.tag))
    const done = items.filter(item => isChecked(item.tag))
    const sorted = [...open, ...done]
    if (sorted.every((item, i) => item === items[i])) continue
    changes.push({ from: pos + 1, to: pos + 1 + node.contentLength, insert: sorted })
  }
  if (!changes.length) return false
  wg.dispatch({ changes, userEvent: "todo.move", scrollIntoView: false })
  return true
}

export function deleteCheckedItems(wg) {
  const changes = []
  wg.state.doc.iterate((node, pos, parent) => {
    if (!node.isPlot) return
    // a list with nothing left in it goes as a whole
    if (node.type === TodoList.type && itemsOf(node).every(item => isChecked(item.tag))) {
      changes.push({ from: pos, to: pos + node.length, fit: true })
      return false
    }
    if (!parent || parent.type !== TodoList.type || !isChecked(node.tag)) return
    changes.push({ from: pos, to: pos + node.length, fit: true })
    return false
  })
  if (!changes.length) return false
  wg.dispatch({ changes, userEvent: "delete.todo", scrollIntoView: false })
  return true
}

export const hasChecked = doc => {
  let found = false
  doc.iterate(node => {
    if (found) return false
    if (node.isPlot && node.tag && isChecked(node.tag)) found = true
  })
  return found
}
