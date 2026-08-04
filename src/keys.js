// Keyboard shortcuts. A plugin says which key it wants in its own descriptor
// (`key: "Mod-Shift-t"`), and this turns every declared key into a binding —
// so a contributed block type or command gets a shortcut the same way the
// built-ins do, with no list of names here.
//
// The names follow chee's Swift notes app, which is the other editor on this
// datatype: the same fingers do the same thing in both. `key` may be a list,
// because some of those keys never reach a web page — the browser keeps
// Cmd-L, Cmd-Shift-A and Cmd-, for itself, and preventDefault can't take them
// back — so those declare a second key that works here.
import { KeyBinding } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { Command, toggleMark } from "wordgard/command"
import { Code, Subscript, Superscript } from "wordgard/types"
import { toggleBaseline } from "./baseline.js"

const run = (item, context) => wg => {
  const apply = item.apply ?? item.run
  if (typeof apply !== "function") return false
  apply(wg, context)
  return true
}

export function richKeys(context) {
  const items = [...context.blockTypes(), ...context.slashCommands()]
  return [
    // The app spells inline code Cmd-E; wordgard's own Mod-` still works.
    KeyBinding.of({ key: "Mod-e", run: Command.bind(toggleMark, Code) }),
    // These take precedence over wordgard's own Mod-. and Mod-, so the two
    // baselines stay exclusive. Mod-Shift-, as well, since the browser keeps
    // Mod-, for its settings.
    GardState.prec.highest([
      KeyBinding.of({ key: "Mod-.", run: wg => toggleBaseline(wg, Superscript) }),
      KeyBinding.of({ key: "Mod-,", run: wg => toggleBaseline(wg, Subscript) }),
      KeyBinding.of({ key: "Mod-Shift-,", run: wg => toggleBaseline(wg, Subscript) }),
    ]),
    ...items
      .filter(item => item.key)
      .flatMap(item =>
        [item.key]
          .flat()
          .map(key => KeyBinding.of({ key, run: run(item, context) })),
      ),
  ]
}
