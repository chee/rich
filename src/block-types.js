// Block types are their own plugin kind, `rich:block`: what a block *is*, as
// opposed to a `rich:slash` command, which *does* something. The two are kept
// apart because the same list of block types drives the "Turn into" section
// of the slash menu and the style rows of the Aa popover — and a host can
// contribute to either kind.
import { Blockquote, BulletList, CodeBlock, Heading, ListItem, OrderedList } from "wordgard/types"
import { TodoList } from "./todo-list.js"
import { applyStyle } from "./block-style.js"

// `key` is a wordgard key name (or a list of them), bound by keys.js. The
// names match chee's Swift notes app, so the same fingers work in both.
const blockType = (id, name, icon, keywords, key) => ({
  type: "rich:block",
  id,
  name,
  icon,
  keywords,
  tier: "core",
  active: state => currentStyle(state) === id,
  // Picking the style a line already has puts it back to Body, as in lush.
  apply: wg => applyStyle(wg, currentStyle(wg.state) === id ? "text" : id),
  // This style, whatever the line was.
  make: wg => applyStyle(wg, id),
  key,
})

// The headings are named for what they are in a note rather than by level, so
// the old names ride along as keywords and "h2" still finds Heading.
export const blockTypes = [
  blockType("text", "Body", "text", ["paragraph", "plain", "text"], "Mod-Shift-b"),
  blockType("h1", "Title", "h1", ["h1", "heading 1", "big"], "Mod-Shift-t"),
  blockType("h2", "Heading", "h2", ["h2", "heading 2"], "Mod-Shift-h"),
  blockType("h3", "Subheading", "h3", ["h3", "heading 3", "small"], "Mod-Shift-j"),
  blockType("code", "Code", "code", ["pre", "snippet", "code block"], "Mod-Shift-m"),
  blockType("bullet", "Bulleted List", "bullet", ["ul", "unordered"], "Mod-Shift-8"),
  blockType("ordered", "Numbered List", "ordered", ["ol", "number"], "Mod-Shift-7"),
  blockType("todo", "To-do List", "todo", ["task", "checkbox", "check", "tick"], "Mod-Shift-0"),
  blockType("quote", "Quote", "quote", ["blockquote", "citation"], "Mod-Shift-9"),
]

// Lush's style for a line: whatever its own block is, the innermost — a list
// item's first line is the list's, any line of a quote is the quote's, and
// every heading past the third draws like the third.
const LIST_STYLES = new Map([
  [BulletList.type, "bullet"],
  [OrderedList, "ordered"],
  [TodoList.type, "todo"],
])

export function currentStyle(state) {
  const block = state.sel.head.textblockParent
  if (!block) return "text"
  const type = block.node.type
  if (type === Heading) return `h${Math.min(3, Math.max(1, Math.floor(Number(block.node.tag.param)) || 1))}`
  if (type === CodeBlock.type) return "code"
  const holder = block.parent
  if (holder?.node.type === ListItem.type && block.isFirst) return LIST_STYLES.get(holder.parent?.node.type) ?? "text"
  if (holder?.node.type === Blockquote.type) return "quote"
  return "text"
}

// A style from scratch, as lush's `applyBlockStyle` sets it; `todo` is the
// state a to-do starts in.
export const setStyle = (wg, id, options) => applyStyle(wg, id, options)

export const toBody = wg => applyStyle(wg, "text")
