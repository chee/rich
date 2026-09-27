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
import { Code, Strikethrough, Subscript, Superscript, Underline } from "wordgard/types"
import { toggleBaseline } from "./baseline.js"

// The top bar owns the popovers these open, so they are reached through its
// DOM rather than imported.
const press = (context, selector) => () => {
  const button = context.element.querySelector(selector)
  if (!button) return false
  button.click()
  return true
}

const later = (load, name) => wg => {
  load().then(module => module[name](wg))
  return true
}

const run = (item, context) => wg => {
  const apply = item.apply ?? item.run
  if (typeof apply !== "function") return false
  apply(wg, context)
  return true
}

function indent(wg, direction) {
  import("./topbar.js").then(bar => bar.indentBlock(wg, direction))
  return true
}

// Cmd-K opens the Aa popover on its link row.
function openLink(wg, context) {
  if (!press(context, ".rich-aa")()) return false
  queueMicrotask(() => context.element.querySelector(".rich-format-popover button[title='Link']")?.click())
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
      // Lush's keys: Cmd-U, Cmd-/ strikethrough, Cmd-K link, Cmd-Ctrl-+ and
      // Cmd-Ctrl-- for the baselines, Cmd-] and Cmd-[ to indent.
      KeyBinding.of({ key: "Mod-u", run: Command.bind(toggleMark, Underline) }),
      KeyBinding.of({ key: "Mod-/", run: Command.bind(toggleMark, Strikethrough) }),
      KeyBinding.of({ key: "Mod-k", run: wg => openLink(wg, context) }),
      KeyBinding.of({ key: "Mod-Ctrl-=", run: wg => toggleBaseline(wg, Superscript) }),
      KeyBinding.of({ key: "Mod-Ctrl-+", run: wg => toggleBaseline(wg, Superscript) }),
      KeyBinding.of({ key: "Mod-Ctrl--", run: wg => toggleBaseline(wg, Subscript) }),
      KeyBinding.of({ key: "Mod-]", run: wg => indent(wg, 1) }),
      KeyBinding.of({ key: "Mod-[", run: wg => indent(wg, -1) }),
      KeyBinding.of({ key: "Mod-Alt-l", run: later(() => import("./topbar.js"), "openLoglineForm") }),
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
