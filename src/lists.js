// Tab nests a list item under the one above it, Shift-Tab pulls it back out.
// Wordgard has no list-indent command, so both are written as token edits:
// nesting moves the previous item's closing token to after this item, with a
// list opened in between; un-nesting is the same trade in reverse.
import { Node, Plot } from "wordgard/doc"
import { KeyBinding } from "wordgard/editor"
import { autoJoinBlocks } from "wordgard/command"
import { ListItem } from "wordgard/types"

const isList = plot => plot.node.type.hasRole(Node.Role.List)

export function listItemAt(state) {
  if (!state.selection.isCursor) return null
  for (let scan = state.sel.head.parent; scan; scan = scan.parent) {
    if (scan.parent && isList(scan.parent)) return scan
  }
  return null
}

export function sinkListItem(state) {
  const item = listItemAt(state)
  if (!item) return false
  const list = item.parent
  const previous = item.previousSibling
  // The first item, or one after a leaf, nests too, as in lush: it goes
  // into a list inside an item of its own, which has no line of its own.
  if (!previous || previous.isLeaf) {
    return autoJoinBlocks(state, {
      changes: [
        { from: item.before, insert: [ListItem, list.node.tag] },
        { from: item.after, insert: [Plot.End, Plot.End] },
      ],
      userEvent: "list.sink",
      scrollIntoView: true,
    })
  }
  if (!state.schema.canContain(previous.type, list.node.type)) return false
  return autoJoinBlocks(state, {
    changes: [
      { from: item.before - 1, to: item.before, insert: [list.node.tag] },
      { from: item.after, insert: [Plot.End, Plot.End] },
    ],
    userEvent: "list.sink",
    scrollIntoView: true,
  })
}

export function liftListItem(state) {
  const item = listItemAt(state)
  if (!item) return false
  const list = item.parent
  // Only nesting is undone here: the list has to sit at the end of an item of
  // an outer list, so the two tokens after this item are the list's and that
  // item's closers, which is what the edits below move around.
  const outer = list.parent
  if (!outer || !list.isLast || !outer.parent || !isList(outer.parent)) return false
  // An item with no line of its own around the list (how the first item
  // nests): the first item simply comes out of it.
  if (outer.node.content.length === 1 && item.isFirst) {
    return autoJoinBlocks(state, {
      changes: [
        { from: item.before - 2, to: item.before },
        item.isLast
          ? { from: item.after, to: item.after + 2 }
          : { from: item.after, insert: [ListItem, list.node.tag] },
      ],
      userEvent: "list.lift",
      scrollIntoView: true,
    })
  }
  return autoJoinBlocks(state, {
    changes: [
      item.isFirst
        ? { from: item.before - 1, to: item.before, insert: [Plot.End] }
        : { from: item.before, insert: [Plot.End, Plot.End] },
      item.isLast
        ? { from: item.after, to: item.after + 2 }
        : { from: item.after - 1, to: item.after, insert: [list.node.tag] },
    ],
    userEvent: "list.lift",
    scrollIntoView: true,
  })
}

const command = change => wg => {
  const spec = change(wg.state)
  if (!spec) return false
  wg.dispatch(spec)
  return true
}

export function listIndent() {
  return [
    KeyBinding.of({ key: "Tab", run: command(sinkListItem) }).extension,
    KeyBinding.of({ key: "Shift-Tab", run: command(liftListItem) }).extension,
  ]
}
