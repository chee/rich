// The cases a review of the top bar found wrong, each written the way lush
// writes it: valued marks (links, highlights, fonts) set over what is already
// there, the marks the next typing will wear, indenting and restyling ranges
// of lines, one undo per style change, where the caret goes after an insert,
// and a peer's change to a block arriving intact. Run `pnpm dev:serve` first.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
const problems = []
const errors = []
page.on("pageerror", e => errors.push(String(e)))
page.on("console", m => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()))
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) problems.push(name)
}
const shot = name => page.screenshot({ path: new URL(`./shots/${name}.png`, import.meta.url).pathname })

const block = (type, parents = [], attrs = {}, isEmbed = false) => ({ type: "block", value: { type, parents, attrs, isEmbed } })
const text = (value, marks) => (marks ? { type: "text", value, marks } : { type: "text", value })

await page.goto(url)
await page.waitForSelector("wg-content")

const mount = async spans => {
  await page.evaluate(spans => window.richDev.mount(spans), spans)
  await page.waitForTimeout(200)
}
const spans = () => page.evaluate(() => window.richDev.spans())
// The note as runs of text and their marks, in automerge.
const runs = async () =>
  (await spans()).map(span =>
    span.type === "block"
      ? `|${span.value.type}${span.value.parents.length ? `<${span.value.parents.join("/")}` : ""}${Object.keys(span.value.attrs).length ? JSON.stringify(span.value.attrs) : ""}`
      : `'${span.value}'${span.marks && Object.keys(span.marks).length ? JSON.stringify(span.marks) : ""}`,
  ).join(" ")
const blocks = async () => (await spans()).filter(span => span.type === "block").map(span => span.value)
// What a fresh editor on the same note would show, against this one.
const fresh = () => page.evaluate(() => window.richDev.roundTrip())

// Select a piece of text by what it says.
async function select(words, { from: fromWord, to: toWord } = {}) {
  await page.evaluate(
    ({ words, fromWord, toWord }) => {
      const editor = window.richDev.editor
      const find = word => {
        let found = null
        editor.state.doc.iterate(0, editor.state.doc.contentLength, (node, pos) => {
          if (found == null && node.isText && node.param.includes(word)) found = pos + node.param.indexOf(word)
        })
        return found
      }
      // one word, or from the start of one to the end of another
      const anchor = find(fromWord ?? words)
      const head = toWord ? find(toWord) + toWord.length : anchor + words.length
      editor.dispatch({ selection: { anchor, head } })
      editor.focus()
    },
    { words, fromWord, toWord },
  )
}
const caretAt = async (word, offset = word.length) => {
  await page.evaluate(
    ({ word, offset }) => {
      const editor = window.richDev.editor
      let found = null
      editor.state.doc.iterate(0, editor.state.doc.contentLength, (node, pos) => {
        if (found == null && node.isText && node.param.includes(word)) found = pos + node.param.indexOf(word) + offset
      })
      editor.dispatch({ selection: { anchor: found } })
      editor.focus()
    },
    { word, offset },
  )
}
const openAa = async () => {
  if (!(await page.$(".rich-format-popover"))) await page.click(".rich-aa")
  await page.waitForSelector(".rich-format-popover")
}
const press = async title => {
  await openAa()
  await page.click(`.rich-format-popover button[title="${title}"]`)
  await page.waitForTimeout(120)
}
const closeAa = async () => {
  if (await page.$(".rich-format-popover")) await page.keyboard.press("Escape")
}
const isActive = title => page.$eval(`.rich-format-popover button[title="${title}"]`, b => b.classList.contains("active"))

// --- Links: applying the link a range already has keeps it ------------------

const linkDialog = async (how = "Enter", value = null) => {
  await page.waitForSelector(".rich-link-dialog .rich-link-input")
  if (value != null) await page.fill(".rich-link-dialog .rich-link-input", value)
  if (how === "Enter") await page.press(".rich-link-dialog .rich-link-input", "Enter")
  else await page.click(`.rich-link-dialog button:has-text("${how}")`)
  await page.waitForTimeout(150)
}

await mount([block("paragraph"), text("see "), text("linked", { link: "https://example.com" }), text(" here")])
await select("linked")
await press("Link")
await linkDialog("Enter")
check("Enter on an unchanged link keeps it", (await runs()).includes(`'linked'{"link":"https://example.com"}`), await runs())

await caretAt("linked", 3)
await page.keyboard.press("ControlOrMeta+k")
await linkDialog("Apply")
check("Apply with the caret in a link keeps it", (await runs()).includes(`'linked'{"link":"https://example.com"}`), await runs())

await select("", { from: "see", to: "linked" })
await press("Link")
check("the sheet shows the link inside the selection", (await page.inputValue(".rich-link-dialog .rich-link-input")) === "https://example.com")
await linkDialog("Enter")
check(
  "the same link over a wider range links all of it",
  (await runs()) === `|paragraph 'see linked'{"link":"https://example.com"} ' here'`,
  await runs(),
)
await select("see linked")
await press("Link")
await linkDialog("Enter", "other.org")
check("a new link replaces the old one", (await runs()) === `|paragraph 'see linked'{"link":"https://other.org"} ' here'`, await runs())
await select("see linked")
await press("Link")
await linkDialog("Remove")
check("Remove takes it off", (await runs()) === `|paragraph 'see linked here'`, await runs())

// --- Highlights and fonts, set over what is already there -------------------

await mount([block("paragraph"), text("see "), text("marked", { highlight: "mint" }), text(" end")])
await select("", { from: "see", to: "marked" })
await openAa()
check("a selection starting on plain text shows no highlight", !(await isActive("Mint Highlight")))
await press("Mint Highlight")
check("Mint over part-mint text makes all of it mint", (await runs()) === `|paragraph 'see marked'{"highlight":"mint"} ' end'`, await runs())
await closeAa()
await select("marked")
await openAa()
check("an exactly selected highlighted word shows its swatch", await isActive("Mint Highlight"))
check("and the highlighter", await page.$eval(".rich-format-popover .rich-highlighter", n => n.classList.contains("active")))
await press("Pink Highlight")
check("another swatch replaces it", (await runs()) === `|paragraph 'see '{"highlight":"mint"} 'marked'{"highlight":"pink"} ' end'`, await runs())
await press("Pink Highlight")
check("its own swatch clears it", (await runs()) === `|paragraph 'see '{"highlight":"mint"} 'marked end'`, await runs())
await closeAa()

await mount([block("paragraph"), text("aaa", { font: "serif" }), text(" "), text("bbb", { font: "hand" })])
await select("", { from: "aaa", to: "bbb" })
await press("Hand")
check("Hand over serif, plain and hand text makes all of it hand", (await runs()) === `|paragraph 'aaa bbb'{"font":"hand"}`, await runs())
await press("Hand")
check("and Hand again clears it", (await runs()) === `|paragraph 'aaa bbb'`, await runs())
await closeAa()

// --- What the next typing will wear ----------------------------------------

await mount([block("paragraph"), text("H2O")])
await caretAt("H2O")
await press("Superscript")
check("a picked superscript shows before anything is typed", await isActive("Superscript"))
check("so does the Aa", await page.$eval(".rich-aa", b => b.classList.contains("marked")))
await press("Subscript")
check("subscript takes the pending superscript's place", (await isActive("Subscript")) && !(await isActive("Superscript")))
await closeAa()
await page.keyboard.type("2", { delay: 30 })
await page.waitForTimeout(150)
check("typed text wears one baseline, never both", (await runs()) === `|paragraph 'H2O' '2'{"subscript":true}`, await runs())

await mount([block("paragraph"), text("plain")])
await caretAt("plain")
await press("Pink Highlight")
check("a picked highlight shows before anything is typed", await isActive("Pink Highlight"))
await press("Pink Highlight")
check("picking it again takes it back", !(await isActive("Pink Highlight")))
await closeAa()
await page.keyboard.type("x", { delay: 30 })
await page.waitForTimeout(150)
check("so the typing wears none", (await runs()) === `|paragraph 'plainx'`, await runs())

// A range starting on superscript text: sub replaces it everywhere, in one undo.
await mount([block("paragraph"), text("x"), text("2", { superscript: true }), text("y")])
await select("", { from: "x", to: "y" })
await press("Subscript")
check("sub over a range clears super there", (await runs()) === `|paragraph 'x2y'{"subscript":true}`, await runs())
await closeAa()
await page.keyboard.press("ControlOrMeta+z")
await page.waitForTimeout(150)
check("and one undo takes the swap back", (await runs()) === `|paragraph 'x' '2'{"superscript":true} 'y'`, await runs())

// --- Styles over several lines, as lush sets them ---------------------------

const same = async () => {
  const trip = await fresh()
  return trip.live === trip.rebuilt
}
const count = selector => page.$$eval(selector, nodes => nodes.length)
const undo = async () => {
  await page.keyboard.press("ControlOrMeta+z")
  await page.waitForTimeout(150)
}

const LINES = [block("paragraph"), text("one"), block("paragraph"), text("two"), block("paragraph"), text("three"), block("paragraph"), text("after")]
await mount(LINES)
await select("", { from: "one", to: "three" })
await press("Code")
await closeAa()
check("three lines made code are one code block", (await count("wg-content pre")) === 1, String(await count("wg-content pre")))
check("written as a code-block marker a line", (await runs()) === "|code-block 'one' |code-block 'two' |code-block 'three' |paragraph 'after'", await runs())
check("the same as a fresh editor on the note", await same())
await shot("verify-code-live")
await undo()
check("one undo takes all three back", (await runs()) === "|paragraph 'one' |paragraph 'two' |paragraph 'three' |paragraph 'after'", await runs())

await mount(LINES)
await select("", { from: "one", to: "three" })
await page.keyboard.press("ControlOrMeta+Shift+m")
await page.waitForTimeout(150)
check("so does the Code key", (await count("wg-content pre")) === 1 && (await same()), await runs())
await page.keyboard.press("ControlOrMeta+Shift+m")
await page.waitForTimeout(150)
check("and again takes them back to Body", (await runs()) === "|paragraph 'one' |paragraph 'two' |paragraph 'three' |paragraph 'after'", await runs())

await mount(LINES)
await select("", { from: "one", to: "three" })
await press("Quote")
await closeAa()
check("three lines made a quote are one quote", (await count("wg-content blockquote")) === 1 && (await count("wg-content blockquote p")) === 3, await runs())
check("written the way lush writes a quote", (await runs()) === "|blockquote 'one' |paragraph<blockquote 'two' |paragraph<blockquote 'three' |paragraph 'after'", await runs())
await select("", { from: "one", to: "three" })
await press("Bulleted List")
await closeAa()
check("and made a list, one list", (await count("wg-content ul > li")) === 3 && (await same()), await runs())

// One undo for a style change, as lush registers one "Format Block".
await mount([block("unordered-list-item"), text("item"), block("paragraph"), text("after")])
await caretAt("item")
await press("Quote")
await closeAa()
check("a bullet made a quote", (await runs()) === "|blockquote 'item' |paragraph 'after'", await runs())
await undo()
check("one undo brings the bullet back", (await runs()) === "|unordered-list-item 'item' |paragraph 'after'", await runs())

await mount([block("heading", [], { level: 2 }), text("head"), block("paragraph"), text("after")])
await caretAt("head")
await press("Bulleted List")
await closeAa()
check("a heading made a bullet", (await runs()) === "|unordered-list-item 'head' |paragraph 'after'", await runs())
await undo()
check("one undo brings the heading back", (await runs()) === `|heading{"level":2} 'head' |paragraph 'after'`, await runs())

// A new style starts from its own attrs, as lush's applyBlockStyle does.
await mount([block("paragraph", [], { indent: 2 }), text("indented")])
await caretAt("indented")
await press("Heading")
await closeAa()
check("a style drops the indent", (await runs()) === `|heading{"level":2} 'indented'`, await runs())
check("in the editor too", (await count("wg-content [data-indent]")) === 0 && (await same()))

// The caret stays where it was through a restyle.
await mount(LINES)
await caretAt("two", 1)
await press("Title")
await closeAa()
await page.keyboard.type("X", { delay: 30 })
await page.waitForTimeout(150)
check("typing after a restyle goes where the caret was", (await runs()).includes(`|heading{"level":1} 'tXwo'`), await runs())

// --- Indenting ranges -------------------------------------------------------

const ITEMS = [
  block("paragraph"), text("list"),
  block("unordered-list-item"), text("alpha"),
  block("unordered-list-item"), text("beta"),
  block("unordered-list-item"), text("gamma"),
]
await mount(ITEMS)
await select("", { from: "beta", to: "gamma" })
await press("Increase Indent")
await closeAa()
check(
  "Increase Indent on selected items nests each of them",
  (await runs()) === "|paragraph 'list' |unordered-list-item 'alpha' |unordered-list-item<unordered-list-item 'beta' |unordered-list-item<unordered-list-item 'gamma'",
  await runs(),
)
check("and a fresh editor shows the same", await same())
check("with no indent drawn on them", (await count("wg-content [data-indent]")) === 0)
await press("Decrease Indent")
await closeAa()
check("Decrease Indent takes them back", (await runs()) === "|paragraph 'list' |unordered-list-item 'alpha' |unordered-list-item 'beta' |unordered-list-item 'gamma'", await runs())

await select("", { from: "beta", to: "gamma" })
await page.keyboard.press("Tab")
await page.waitForTimeout(150)
check(
  "Tab on selected items nests each of them",
  (await runs()) === "|paragraph 'list' |unordered-list-item 'alpha' |unordered-list-item<unordered-list-item 'beta' |unordered-list-item<unordered-list-item 'gamma'",
  await runs(),
)
await page.keyboard.press("ControlOrMeta+]")
await page.waitForTimeout(150)
check("Cmd-] too", (await runs()).endsWith("|unordered-list-item<unordered-list-item/unordered-list-item 'gamma'"), await runs())
await page.keyboard.press("Shift+Tab")
await page.waitForTimeout(150)
await page.keyboard.press("Shift+Tab")
await page.waitForTimeout(150)
check("Shift-Tab brings them out", (await runs()) === "|paragraph 'list' |unordered-list-item 'alpha' |unordered-list-item 'beta' |unordered-list-item 'gamma'", await runs())
check("the selection stays on them", (await page.evaluate(() => {
  const editor = window.richDev.editor
  return editor.state.doc.slice(editor.state.selection.from, editor.state.selection.to).content.filter(n => n.isText).map(n => n.param).join("|")
})) === "beta|gamma")

// Lines that aren't list items take lush's `indent`, each its own.
await mount([block("paragraph"), text("first"), block("paragraph", [], { indent: 1 }), text("second")])
await select("", { from: "first", to: "second" })
await press("Increase Indent")
await closeAa()
check("each selected line indents from where it was", (await runs()) === `|paragraph{"indent":1} 'first' |paragraph{"indent":2} 'second'`, await runs())
check("drawn as written", (await count("wg-content p[data-indent='1']")) === 1 && (await count("wg-content p[data-indent='2']")) === 1 && (await same()))

// A quote's first line is the quote's own marker: its indent goes there.
await mount([block("blockquote"), text("quoted"), block("paragraph", ["blockquote"]), text("more")])
await caretAt("quoted")
await press("Increase Indent")
await closeAa()
check("indenting a quote's first line writes it on the quote", (await runs()) === `|blockquote{"indent":1} 'quoted' |paragraph<blockquote 'more'`, await runs())
check("and shows what is written", await same())
await caretAt("more")
await press("Increase Indent")
await closeAa()
check("its other lines indent as paragraphs", (await runs()) === `|blockquote{"indent":1} 'quoted' |paragraph<blockquote{"indent":1} 'more'`, await runs())

// A cell's first line has no marker of its own until it needs one.
await mount([
  block("table"),
  block("table-row", ["table"]),
  block("table-cell", ["table", "table-row"]), text("cell"),
  block("table-cell", ["table", "table-row"]), text("other"),
  block("paragraph"), text("after"),
])
await caretAt("cell")
await press("Increase Indent")
await closeAa()
check(
  "indenting a cell's first line gives it a marker",
  (await runs()).includes(`|table-cell<table/table-row |paragraph<table/table-row/table-cell{"indent":1} 'cell'`),
  await runs(),
)
check("which reads back the same", await same())
await press("Decrease Indent")
await closeAa()
check("and outdenting drops it again", (await runs()).includes(`|table-cell<table/table-row 'cell'`), await runs())
await caretAt("cell")
await press("Heading")
await closeAa()
check("a style in a cell stays in the cell", (await runs()).includes(`|table-cell<table/table-row |heading<table/table-row/table-cell{"level":2} 'cell'`), await runs())
check("and reads back the same", await same())

// A code block indents whole: its lines are one card.
await mount([block("code-block"), text("let a"), block("code-block"), text("let b"), block("paragraph"), text("after")])
await caretAt("let b")
await page.keyboard.press("ControlOrMeta+]")
await page.waitForTimeout(150)
check("indenting in a code block indents all of it", (await runs()) === `|code-block{"indent":1} 'let a' |code-block{"indent":1} 'let b' |paragraph 'after'`, await runs())
check("still one card", (await count("wg-content pre")) === 1 && (await same()))

// --- A peer's change to a block ---------------------------------------------

// Lush turns a line into a list item or a quote with am.updateBlock.
const peerRestyles = (word, type, parents = []) =>
  page.evaluate(
    ({ word, type, parents }) => {
      const { handle, am } = window.richDev
      const spans = am.spans(handle.doc(), ["content"])
      let index = 0
      let marker = -1
      for (const span of spans) {
        if (span.type === "block") marker = index
        if (span.type === "text" && span.value.includes(word)) break
        index += span.type === "block" ? 1 : span.value.length
      }
      handle.change(doc =>
        am.updateBlock(doc, ["content"], marker, {
          type: new am.ImmutableString(type),
          parents: parents.map(p => new am.ImmutableString(p)),
          attrs: {},
          isEmbed: false,
        }),
      )
    },
    { word, type, parents },
  )

const PEER = [
  block("paragraph"), text("alpha"),
  block("unordered-list-item"), text("beta"),
  block("paragraph"), text("gamma delta"),
  block("paragraph"), text("epsilon"),
  block("paragraph"), text("zeta"),
]
await mount(PEER)
await peerRestyles("epsilon", "unordered-list-item")
await page.waitForTimeout(200)
check("a peer's new list item arrives as it is", await same(), await page.$eval("wg-content", n => n.innerHTML.slice(0, 200)))
check("with no empty line after it", (await count("wg-content > p")) === 3, String(await count("wg-content > p")))
await caretAt("zeta")
await page.keyboard.press("Enter")
await page.waitForTimeout(200)
check(
  "and the next edit writes no empty line into the note",
  (await runs()) === "|paragraph 'alpha' |unordered-list-item 'beta' |paragraph 'gamma delta' |unordered-list-item 'epsilon' |paragraph 'zeta' |paragraph",
  await runs(),
)

await mount(PEER)
await peerRestyles("gamma", "unordered-list-item")
await page.waitForTimeout(200)
check("a peer's list item joining a list arrives as it is", await same())
await caretAt("epsilon")
await page.keyboard.press("Enter")
await page.waitForTimeout(200)
check(
  "and the next edit keeps the note as it was",
  (await runs()) === "|paragraph 'alpha' |unordered-list-item 'beta' |unordered-list-item 'gamma delta' |paragraph 'epsilon' |paragraph |paragraph 'zeta'",
  await runs(),
)

await mount(PEER)
await peerRestyles("gamma", "blockquote")
await page.waitForTimeout(200)
check("a peer's new quote arrives as it is", await same())
await caretAt("zeta")
await page.keyboard.press("Enter")
await page.waitForTimeout(200)
check(
  "and the next edit keeps it",
  (await runs()) === "|paragraph 'alpha' |unordered-list-item 'beta' |blockquote 'gamma delta' |paragraph 'epsilon' |paragraph 'zeta' |paragraph",
  await runs(),
)

// A selection running past a table restyles the lines around it, not the
// table's cells: a table is one block in lush.
await mount([
  block("paragraph"), text("above"),
  block("table"), block("table-row", ["table"]),
  block("table-cell", ["table", "table-row"]), text("cell"),
  block("paragraph"), text("below"),
])
await select("", { from: "above", to: "below" })
await press("Subheading")
await closeAa()
check(
  "a style over a table leaves the table be",
  (await runs()) === `|heading{"level":3} 'above' |table |table-row<table |table-cell<table/table-row 'cell' |heading{"level":3} 'below'`,
  await runs(),
)

// A peer nesting a list item (lush's Tab) arrives nested, even where the
// item has no item above it to nest under.
await mount([block("paragraph"), text("intro"), block("unordered-list-item"), text("only item"), block("paragraph"), text("outro")])
await peerRestyles("only item", "unordered-list-item", ["unordered-list-item"])
await page.waitForTimeout(200)
check("a peer's nested item arrives nested", await same(), await page.$eval("wg-content", n => n.innerHTML.slice(0, 300)))

// The find bar sits under the top bar, and the note makes room for it.
await mount([block("heading", [], { level: 1 }), text("First line"), block("paragraph"), text("second")])
await caretAt("second")
await page.keyboard.press("ControlOrMeta+f")
await page.waitForSelector(".rich-find")
await page.waitForTimeout(150)
const room = await page.evaluate(() => ({
  bar: document.querySelector(".rich-find").getBoundingClientRect().bottom,
  first: document.querySelector("wg-content h1").getBoundingClientRect().top,
}))
check("the find bar doesn't cover the first line", room.first >= room.bar, JSON.stringify(room))
await page.keyboard.press("Escape")
await page.waitForTimeout(150)
check("and the room goes when it closes", await page.evaluate(() => getComputedStyle(document.querySelector(".rich-tool")).getPropertyValue("--rich-find-room") === ""))

// --- Duplicate --------------------------------------------------------------

const moreItems = async () => {
  await page.click(".rich-more")
  await page.waitForSelector(".rich-note-menu")
  const items = await page.$$eval(".rich-note-menu .rich-menu-label", nodes => nodes.map(node => node.textContent))
  await page.keyboard.press("Escape")
  return items
}
await page.evaluate(spans => window.richDev.mount(spans, { type: "cherries-post" }), [block("paragraph"), text("a post")])
await page.waitForTimeout(200)
check("a document that isn't a note (a site's post) offers no Duplicate", !(await moreItems()).includes("Duplicate"), JSON.stringify(await moreItems()))
await mount([block("paragraph"), text("a note")])
check("a note does", (await moreItems()).includes("Duplicate"))

// --- Inserting blocks: after the line, the caret on a line below -------------

const attach = async item => {
  await page.click(".rich-clip")
  await page.waitForSelector(".rich-attach-menu")
  await page.click(`.rich-attach-menu .rich-menu-item:has-text("${item}")`)
  await page.waitForTimeout(250)
}
const kinds = async () => (await blocks()).map(value => value.type).join(" ")

await mount([block("paragraph"), text("first"), block("paragraph"), text("second")])
await caretAt("first")
await attach("Logline")
await attach("HTML Block")
check("HTML Block opens its source", await page.isVisible(".rich-html-sheet textarea"))
await page.keyboard.press("Escape")
await page.waitForTimeout(100)
await attach("Patchwork Doc")
await page.waitForSelector(".rich-doc-sheet .rich-doc-type")
await page.click(".rich-doc-sheet .rich-doc-type[data-type=rich]")
await page.waitForTimeout(400)
check("blocks inserted one after another stack in order", (await kinds()) === "paragraph context html embed paragraph paragraph", await kinds())
await page.keyboard.type("x", { delay: 30 })
await page.waitForTimeout(150)
check("and typing carries on below them", /\|embed\{[^}]*\} \|paragraph 'x' \|paragraph 'second'$/.test(await runs()), await runs())

await mount([block("paragraph"), text("first"), block("paragraph"), text("second")])
await caretAt("first", 2)
await attach("Logline")
check("a block goes after the line, not into it", (await runs()).replace(/\|context\{[^}]*\}/, "|context") === "|paragraph 'first' |context |paragraph |paragraph 'second'", await runs())

await mount([block("paragraph"), text("a"), block("paragraph"), block("paragraph"), text("b")])
await caretAt("a")
await page.keyboard.press("ArrowDown")
await attach("Logline")
check("an empty line is taken by the block", (await kinds()) === "paragraph context paragraph paragraph", await kinds())

// Choose Photo… and Attach File… put what they store after the line too.
await mount([block("paragraph"), text("first"), block("paragraph"), text("second")])
await caretAt("first", 1)
const pick = async (item, file) => {
  const chooser = page.waitForEvent("filechooser")
  await attach(item)
  await (await chooser).setFiles(file)
  await page.waitForTimeout(500)
}
await pick("Choose Photo…", { name: "pink.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex") })
await pick("Attach File…", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") })
check("a photo and a file go after the line, in the order they came", (await kinds()) === "paragraph embed embed paragraph paragraph", await kinds())
await page.keyboard.type("y", { delay: 30 })
await page.waitForTimeout(150)
check("with the caret below them", /\|embed\{[^}]*\} \|paragraph 'y' \|paragraph 'second'$/.test(await runs()), await runs())

// --- Logline… ------------------------------------------------------------------

await mount([block("paragraph"), text("before"), block("paragraph"), text("after")])
await caretAt("before")
await attach("Logline…")
await page.waitForSelector(".rich-logline-sheet form")
const loglineSheet = await page.$eval(".rich-logline-sheet form", form => ({
  title: form.querySelector(".rich-sheet-title").textContent,
  width: form.getBoundingClientRect().width,
  top: form.getBoundingClientRect().top,
  bar: document.querySelector(".rich-topbar").getBoundingClientRect().bottom,
  buttons: [...form.querySelectorAll(".rich-sheet-buttons button")].map(b => b.textContent).join(" "),
}))
check("Logline… is a sheet like lush's", loglineSheet.title === "New Logline" && loglineSheet.width === 420 && loglineSheet.buttons === "Cancel Insert", JSON.stringify(loglineSheet))
check("below the top bar, not over it", loglineSheet.top >= loglineSheet.bar, JSON.stringify(loglineSheet))
await shot("verify-logline-form")
await page.fill(".rich-logline-sheet input[name=lat]", "53.8")
await page.waitForTimeout(50)
check("a latitude alone says it will be dropped", await page.isVisible(".rich-logline-sheet .rich-form-warning:has-text('Needs both')"))
await page.click(".rich-logline-sheet button:has-text('Add Detail')")
await page.fill(".rich-logline-sheet .rich-form-extra:last-child .rich-extra-key", "mood")
await page.fill(".rich-logline-sheet .rich-form-extra:last-child .rich-extra-value", "calm")
await page.fill(".rich-logline-sheet input[name=location]", "Leeds")
await page.click(".rich-logline-sheet button:has-text('Insert')")
await page.waitForTimeout(250)
let context = (await blocks()).find(value => value.type === "context")
check("so it is", context && !("lat" in context.attrs) && !("lon" in context.attrs), JSON.stringify(context))
check("the rest is written as lush writes it", context?.attrs?.location === "Leeds" && context?.attrs?.mood === "calm" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/.test(context?.attrs?.ts ?? "") && typeof context?.attrs?.tz === "string", JSON.stringify(context))
check("and it draws", (await page.$eval("rich-logline", n => n.shadowRoot.querySelector(".rich-logline").textContent)).includes("Leeds"))

await page.dblclick("rich-logline")
await page.waitForSelector(".rich-logline-sheet form")
check("a double click edits it", (await page.textContent(".rich-logline-sheet .rich-sheet-title")) === "Edit Logline" && (await page.inputValue(".rich-logline-sheet input[name=location]")) === "Leeds")
await page.fill(".rich-logline-sheet input[name=lat]", "53.8")
await page.fill(".rich-logline-sheet input[name=lon]", "-1.55")
await page.click(".rich-logline-sheet button:has-text('Save')")
await page.waitForTimeout(250)
context = (await blocks()).filter(value => value.type === "context")
check("saving writes the coordinate as numbers", context.length === 1 && context[0].attrs.lat === 53.8 && context[0].attrs.lon === -1.55 && context[0].attrs.mood === "calm", JSON.stringify(context))

// A logline another editor wrote with a latitude and no longitude still draws.
await mount([block("context", [], { ts: "2026-09-27T10:11:12+01:00", tz: "Europe/London", lat: 53.8 }, true), block("paragraph"), text("after")])
const drawn = await page.$eval("rich-logline", n => n.shadowRoot.querySelector(".rich-logline").textContent)
check("a lone latitude doesn't stop a logline drawing", /2026/.test(drawn) && !drawn.includes("53.8"), drawn)
await shot("verify-logline-latonly")

// --- A short pane -------------------------------------------------------------

await page.evaluate(() => {
  const app = document.getElementById("app")
  app.style.height = "360px"
  app.style.overflow = "hidden"
})
await mount([block("paragraph"), text("short pane")])
await caretAt("short")
await openAa()
const fit = await page.evaluate(() => {
  const body = document.querySelector(".rich-format-popover .rich-popover-body").getBoundingClientRect()
  const pane = document.getElementById("app").getBoundingClientRect()
  return { bottom: body.bottom, pane: pane.bottom }
})
check("the Aa popover stays inside a short pane", fit.bottom <= fit.pane, JSON.stringify(fit))
await page.waitForTimeout(250)
await shot("verify-short-pane")
await page.click('.rich-format-popover button[title="Quote"]')
await page.waitForTimeout(150)
check("and what is below its fold can be reached", (await runs()) === "|blockquote 'short pane'", await runs())
await page.click('.rich-format-popover button[title="Increase Indent"]')
await page.waitForTimeout(150)
check("the indent pill too", (await runs()) === `|blockquote{"indent":1} 'short pane'`, await runs())
await closeAa()
await page.evaluate(() => {
  const app = document.getElementById("app")
  app.style.height = ""
  app.style.overflow = ""
})

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
