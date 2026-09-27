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

const createOnBrackets = InputRule.define({
  expr: /^ ?\[([ xX\-/]?)\] $/,
  apply: (wg, match) => {
    const state = BRACKET_STATES[match[1]?.text ?? ""]
    if (!wrapTodo.apply(wg, match)) return false
    if (!state) return true
    const item = wg.state.sel.head.matchingParent(plot => plot.type === ListItem.type)
    if (item) wg.dispatch({ changes: todoStateChanges(item.node.tag, item.before, state) })
    return true
  },
})

export function todoLists() {
  return [createOnBrackets.extension, todoChecking()]
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
