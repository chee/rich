// Block types are their own plugin kind, `rich:block`: what a block *is*, as
// opposed to a `rich:slash` command, which *does* something. The two are kept
// apart because the same list of block types drives the "Turn into" section of
// both the slash menu and the block handle's menu — and a host can contribute
// to either kind.
import { Command, setTextblockType, toggleList, toggleBlock, unwrapBlock } from "wordgard/command"
import {
  Blockquote,
  BulletList,
  CodeBlock,
  Heading,
  OrderedList,
  Paragraph,
} from "wordgard/types"
import { TodoList } from "./todo-list.js"

// `key` is a wordgard key name (or a list of them), bound by keys.js. The
// names match chee's Swift notes app, so the same fingers work in both.
const blockType = (id, name, icon, keywords, { active, apply, make, key }) => ({
  type: "rich:block",
  id,
  name,
  icon,
  keywords,
  tier: "core",
  active,
  apply,
  // Turn a Body line into this style (what `apply` does after `toBody`).
  make: make ?? apply,
  key,
})

const textblockIs = (state, test) => {
  const block = state.sel.head.textblockParent
  return Boolean(block && test(block.node.tag))
}

const insideList = (state, tag) =>
  Boolean(state.sel.head.matchingParent(plot => plot.tag === tag))

// The headings are named for what they are in a note rather than by level, so
// the old names ride along as keywords and "h2" still finds Heading.
const HEADINGS = [
  { level: 1, name: "Title", keywords: ["h1", "heading 1", "big"], key: "Mod-Shift-t" },
  { level: 2, name: "Heading", keywords: ["h2", "heading 2"], key: "Mod-Shift-h" },
  { level: 3, name: "Subheading", keywords: ["h3", "heading 3", "small"], key: "Mod-Shift-j" },
]

// Lush replaces the whole block when you pick a style: out of any list or
// quote, then the new type. Picking the style a block already has puts it
// back to Body.
const WRAPPERS = [Blockquote, BulletList, OrderedList, TodoList]

export function toBody(wg) {
  Command.dispatch(wg, setTextblockType, Paragraph)
  while (Command.dispatch(wg, unwrapBlock, WRAPPERS));
}

const restyle = (active, apply) => wg => {
  const was = active(wg.state)
  toBody(wg)
  if (!was) apply(wg)
}

// A style from scratch, as lush's `applyBlockStyle` sets it: out of every
// list and quote, then into this one — whatever the block was before.
export function setStyle(wg, id) {
  const block = blockTypes.find(block => block.id === id)
  if (!block) return false
  toBody(wg)
  if (id !== "text") block.make(wg)
  return true
}

const isList = type => state => Boolean(state.sel.head.matchingParent(plot => plot.tag.type === type))

export const blockTypes = [
  blockType("text", "Body", "text", ["paragraph", "plain", "text"], {
    make: () => {},
    active: state =>
      textblockIs(state, tag => tag === Paragraph) &&
      !state.sel.head.matchingParent(plot => WRAPPERS.some(wrapper => plot.tag.type === wrapper.type)),
    apply: toBody,
    key: "Mod-Shift-b",
  }),
  ...HEADINGS.map(({ level, name, keywords, key }) => {
    // Lush draws every heading past the third like the third.
    const active = state =>
      textblockIs(state, tag => tag.type === Heading && Math.min(tag.param, 3) === level)
    return blockType(`h${level}`, name, `h${level}`, keywords, {
      active,
      apply: restyle(active, wg => Command.dispatch(wg, setTextblockType, Heading.of(level))),
      make: wg => Command.dispatch(wg, setTextblockType, Heading.of(level)),
      key,
    })
  }),
  blockType("code", "Code", "code", ["pre", "snippet", "code block"], {
    active: state => textblockIs(state, tag => tag.type === CodeBlock.type),
    apply: restyle(
      state => textblockIs(state, tag => tag.type === CodeBlock.type),
      wg => Command.dispatch(wg, setTextblockType, CodeBlock),
    ),
    make: wg => Command.dispatch(wg, setTextblockType, CodeBlock),
    key: "Mod-Shift-m",
  }),
  blockType("bullet", "Bulleted List", "bullet", ["ul", "unordered"], {
    active: isList(BulletList.type),
    apply: restyle(isList(BulletList.type), wg => Command.dispatch(wg, toggleList, BulletList)),
    make: wg => Command.dispatch(wg, toggleList, BulletList),
    key: "Mod-Shift-8",
  }),
  blockType("ordered", "Numbered List", "ordered", ["ol", "number"], {
    active: isList(OrderedList),
    apply: restyle(isList(OrderedList), wg => Command.dispatch(wg, toggleList, OrderedList.of(1))),
    make: wg => Command.dispatch(wg, toggleList, OrderedList.of(1)),
    key: "Mod-Shift-7",
  }),
  blockType("todo", "To-do List", "todo", ["task", "checkbox", "check", "tick"], {
    active: isList(TodoList.type),
    apply: restyle(isList(TodoList.type), wg => Command.dispatch(wg, toggleList, TodoList)),
    make: wg => Command.dispatch(wg, toggleList, TodoList),
    key: "Mod-Shift-0",
  }),
  blockType("quote", "Quote", "quote", ["blockquote", "citation"], {
    active: isList(Blockquote.type),
    apply: restyle(isList(Blockquote.type), wg => Command.dispatch(wg, toggleBlock, Blockquote)),
    make: wg => Command.dispatch(wg, toggleBlock, Blockquote),
    key: "Mod-Shift-9",
  }),
]

// The style lush's popover ticks: a list or a quote wins over the line's own
// type, since a list item's line is a paragraph.
export function currentStyle(state) {
  const order = ["todo", "ordered", "bullet", "quote", "h1", "h2", "h3", "code", "text"]
  const byId = Object.fromEntries(blockTypes.map(block => [block.id, block]))
  return order.find(id => byId[id].active(state)) ?? "text"
}
