// Block types are their own plugin kind, `rich:block`: what a block *is*, as
// opposed to a `rich:slash` command, which *does* something. The two are kept
// apart because the same list of block types drives the "Turn into" section of
// both the slash menu and the block handle's menu — and a host can contribute
// to either kind.
import { Command, setTextblockType, toggleList, toggleBlock } from "wordgard/command"
import {
  Blockquote,
  BulletList,
  CodeBlock,
  Heading,
  OrderedList,
  Paragraph,
} from "wordgard/types"

const blockType = (id, name, icon, keywords, { active, apply }) => ({
  type: "rich:block",
  id,
  name,
  icon,
  keywords,
  tier: "core",
  active,
  apply,
})

const textblockIs = (state, test) => {
  const block = state.sel.head.textblockParent
  return Boolean(block && test(block.node.tag))
}

const insideList = (state, tag) =>
  Boolean(state.sel.head.matchingParent(plot => plot.tag === tag))

export const blockTypes = [
  blockType("text", "Text", "text", ["paragraph", "plain", "body"], {
    active: state => textblockIs(state, tag => tag === Paragraph),
    apply: wg => Command.dispatch(wg, setTextblockType, Paragraph),
  }),
  ...[1, 2, 3].map(level =>
    blockType(`h${level}`, `Heading ${level}`, `h${level}`, level === 1 ? ["title", "big"] : [], {
      active: state =>
        textblockIs(state, tag => tag.type === Heading && tag.param === level),
      apply: wg => Command.dispatch(wg, setTextblockType, Heading.of(level)),
    }),
  ),
  blockType("bullet", "Bulleted list", "bullet", ["ul", "unordered"], {
    active: state => insideList(state, BulletList),
    apply: wg => Command.dispatch(wg, toggleList, BulletList),
  }),
  blockType("ordered", "Numbered list", "ordered", ["ol", "number"], {
    active: state => Boolean(state.sel.head.matchingParent(plot => plot.tag.type === OrderedList)),
    apply: wg => Command.dispatch(wg, toggleList, OrderedList.of(1)),
  }),
  blockType("quote", "Quote", "quote", ["blockquote", "citation"], {
    active: state => insideList(state, Blockquote),
    apply: wg => Command.dispatch(wg, toggleBlock, Blockquote),
  }),
  blockType("code", "Code block", "code", ["pre", "snippet"], {
    active: state => textblockIs(state, tag => tag === CodeBlock),
    apply: wg => Command.dispatch(wg, setTextblockType, CodeBlock),
  }),
]
