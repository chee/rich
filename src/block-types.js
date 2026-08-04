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
const blockType = (id, name, icon, keywords, { active, apply, key }) => ({
  type: "rich:block",
  id,
  name,
  icon,
  keywords,
  tier: "core",
  active,
  apply,
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

export const blockTypes = [
  blockType("text", "Body", "text", ["paragraph", "plain", "text"], {
    active: state => textblockIs(state, tag => tag === Paragraph),
    // Body means body: a line in a quote or a list comes out of it, rather
    // than staying wrapped in something that is not body text.
    apply: wg => {
      Command.dispatch(wg, setTextblockType, Paragraph)
      while (Command.dispatch(wg, unwrapBlock, [Blockquote, BulletList, OrderedList, TodoList]));
    },
    key: "Mod-Shift-b",
  }),
  ...HEADINGS.map(({ level, name, keywords, key }) =>
    blockType(`h${level}`, name, `h${level}`, keywords, {
      active: state =>
        textblockIs(state, tag => tag.type === Heading && tag.param === level),
      apply: wg => Command.dispatch(wg, setTextblockType, Heading.of(level)),
      key,
    }),
  ),
  blockType("bullet", "Bulleted List", "bullet", ["ul", "unordered"], {
    active: state => insideList(state, BulletList),
    apply: wg => Command.dispatch(wg, toggleList, BulletList),
    key: "Mod-Shift-8",
  }),
  blockType("ordered", "Numbered List", "ordered", ["ol", "number"], {
    active: state => Boolean(state.sel.head.matchingParent(plot => plot.tag.type === OrderedList)),
    apply: wg => Command.dispatch(wg, toggleList, OrderedList.of(1)),
    key: "Mod-Shift-7",
  }),
  blockType("todo", "To-do List", "todo", ["task", "checkbox", "check", "tick"], {
    active: state => insideList(state, TodoList),
    apply: wg => Command.dispatch(wg, toggleList, TodoList),
    key: "Mod-Shift-0",
  }),
  blockType("quote", "Quote", "quote", ["blockquote", "citation"], {
    active: state => insideList(state, Blockquote),
    apply: wg => Command.dispatch(wg, toggleBlock, Blockquote),
    key: "Mod-Shift-9",
  }),
  blockType("code", "Code", "code", ["pre", "snippet", "code block"], {
    active: state => textblockIs(state, tag => tag === CodeBlock),
    apply: wg => Command.dispatch(wg, setTextblockType, CodeBlock),
    key: "Mod-Shift-m",
  }),
]
