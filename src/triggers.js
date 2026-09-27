// Lush's markdown triggers replace the block's style, whatever the block was:
// `> ` typed on a to-do line makes a quote, not a quote inside the to-do. On a
// plain top-level line, wordgard's own rules already do exactly that, so the
// rule is only taken over inside a list or a quote: there it deletes what was
// typed and marks the transaction, and the style is set right after, the way
// the Aa popover sets it (see block-types.js `setStyle`).
import { InputRule, Wordgard } from "wordgard/editor"
import { Transaction } from "wordgard/state"
import { history } from "wordgard/history"
import { Blockquote, BulletList, ListItem, OrderedList } from "wordgard/types"
import { setStyle } from "./block-types.js"
import { TodoList, todoStateChanges } from "./todo-list.js"

const WRAPPERS = [Blockquote.type, BulletList.type, OrderedList.type, TodoList.type]

const restyleTo = Transaction.Annotation.define()

const inWrapper = pos => {
  for (let level = pos.parent; level; level = level.parent) {
    if (WRAPPERS.includes(level.node?.type)) return true
  }
  return false
}

// `rule`, except inside a list or a quote, where it becomes lush's
// replacement. `style(match)` names the style: a block-types id, and for a
// to-do the state it starts in.
export function lushTrigger(rule, style) {
  return InputRule.define({
    expr: rule.expr,
    lookahead: rule.lookahead,
    apply: (state, match) => {
      const { from, to } = match[0]
      if (!inWrapper(from)) return rule.apply(state, match)
      return {
        changes: [{ from: from.pos, to: to.pos }],
        annotations: [history.isolate.of("before"), restyleTo.of(style(match))],
      }
    },
  })
}

// The follow-up joins the trigger's own undo step, so one undo takes the
// whole conversion back.
const joined = wg =>
  Object.assign(Object.create(wg), {
    dispatch: spec =>
      wg.dispatch({ ...spec, annotations: [].concat(spec.annotations ?? [], Transaction.appended.of(true)) }),
  })

export const restyleTriggers = Wordgard.Plugin.define(wg => ({
  update(update) {
    for (const tr of update.transactions) {
      const style = tr.annotation(restyleTo)
      if (!style) continue
      queueMicrotask(() => {
        const target = joined(wg)
        setStyle(target, style.id)
        if (style.todo && style.todo !== "open") {
          const item = wg.state.sel.head.matchingParent(plot => plot.type === ListItem.type)
          if (item) target.dispatch({ changes: todoStateChanges(item.node.tag, item.before, style.todo) })
        }
      })
    }
  },
})).extension
