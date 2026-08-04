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

export const isChecked = tag => Checked.isInSet(tag.marks) != null

export const checkedParsers = {
  fromAutomerge: block => (block.attrs.checked === true ? Checked.addToSet(Mark.none) : Mark.none),
  fromWordgard: node => (isChecked(node.tag) ? { checked: true } : {}),
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

// `[] ` or `[x] ` at the start of a line starts a to-do list, the way `- `
// starts a bullet one.
const createOnBrackets = InputRule.wrapping(/^ ?\[[ xX]?\] $/, TodoList, true)

export function todoLists() {
  return [createOnBrackets.extension, todoChecking()]
}

function todoChecking() {
  return Wordgard.domEventHandler("mousedown", (event, wg) => {
    const found = todoItemAt(wg, event.target)
    if (!found || !onTheBox(event, found.element)) return false
    event.preventDefault()
    const done = isChecked(found.node.tag)
    wg.dispatch({
      changes: { from: found.pos, [done ? "remove" : "add"]: Checked },
      userEvent: "todo.check",
    })
    return true
  })
}
