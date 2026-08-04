// Keyboard shortcuts. A plugin says which key it wants in its own descriptor
// (`key: "Mod-Shift-t"`), and this turns every declared key into a binding —
// so a contributed block type or command gets a shortcut the same way the
// built-ins do, with no list of names here.
//
// The names follow chee's Swift notes app, which is the other editor on this
// datatype: the same fingers do the same thing in both.
import { KeyBinding } from "wordgard/editor"
import { Command, toggleMark } from "wordgard/command"
import { Code } from "wordgard/types"

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
    ...items
      .filter(item => item.key)
      .map(item => KeyBinding.of({ key: item.key, run: run(item, context) })),
  ]
}
