// Lush's markdown triggers replace the line's style, whatever the line was:
// `> ` typed on a to-do line makes a quote, not a quote inside the to-do, and
// `- ` on an indented line makes a bullet without the indent. So a trigger
// deletes what was typed and marks the transaction, and the style is set
// right after, the way the Aa popover sets it (block-style.js), in the same
// undo step.
import { InputRule, Wordgard } from "wordgard/editor"
import { Transaction } from "wordgard/state"
import { history } from "wordgard/history"
import { setStyle } from "./block-types.js"

const restyleTo = Transaction.Annotation.define()

// `rule`'s pattern, as lush's replacement. `style(match)` names the style: a
// block-types id, and for a to-do the state it starts in.
export function lushTrigger(rule, style) {
  return InputRule.define({
    expr: rule.expr,
    lookahead: rule.lookahead,
    apply: (state, match) => {
      const { from, to } = match[0]
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
      queueMicrotask(() => setStyle(joined(wg), style.id, { todo: style.todo }))
    }
  },
})).extension
