// Lush's top bar: the Aa popover, the paperclip menu and the ••• menu, and
// that everything they do is stored exactly the way lush stores it. The
// floating selection bar and the block handles are gone. Run `pnpm dev:serve`
// first.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
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
const text = value => ({ type: "text", value })

await page.goto(url)
await page.waitForSelector("wg-content")
await page.evaluate(
  spans => window.richDev.mount(spans),
  [
    block("heading", [], { level: 1 }),
    text("Shopping"),
    block("paragraph"),
    text("apples and pears"),
    block("paragraph"),
    text("second line"),
    block("code-block"),
    text("let x = 1"),
  ],
)
await page.waitForTimeout(300)

check("no floating format bar", (await page.$$(".rich-format-bar")).length === 0)
check("no block handles", (await page.$$(".rich-gutter")).length === 0)
check("the top bar is there", await page.isVisible(".rich-topbar"))
const pills = await page.$$eval(".rich-bar-pill", pills => pills.map(pill => [...pill.querySelectorAll("button")].map(b => b.title)))
check("centre pill: Aa and paperclip; right pill: ••• and info", JSON.stringify(pills) === '[["Format","Attach"],["More","Info"]]', JSON.stringify(pills))
check(
  "the note fades under the bar",
  (await page.$eval("wg-scroller", node => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage)).includes("gradient"),
)

const spans = () => page.evaluate(() => window.richDev.spans())
const blocks = async () => (await spans()).filter(span => span.type === "block").map(span => span.value)
const marksOn = async word => (await spans()).find(span => span.type === "text" && span.value.includes(word))?.marks ?? {}

// Select a word by its text.
async function select(word) {
  await page.evaluate(word => {
    const editor = window.richDev.editor
    let found = null
    editor.state.doc.iterate(0, editor.state.doc.contentLength, (node, pos) => {
      if (found == null && node.isText && node.param.includes(word)) found = pos + node.param.indexOf(word)
    })
    editor.dispatch({ selection: { anchor: found, head: found + word.length } })
    editor.focus()
  }, word)
}
async function caretIn(word) {
  await select(word)
  await page.evaluate(() => {
    const editor = window.richDev.editor
    editor.dispatch({ selection: { anchor: editor.state.selection.to } })
  })
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

// The popover, row by row.
await select("apples")
await openAa()
const rows = await page.$eval(".rich-format-popover .rich-popover-body", body =>
  [...body.children].map(child =>
    child.classList.contains("rich-popover-divider")
      ? "—"
      : child.classList.contains("rich-style-row")
        ? child.querySelector(".rich-style-label").textContent
        : [...child.querySelectorAll("button")].map(b => b.title).join(" "),
  ),
)
check(
  "the popover's rows are lush's",
  rows.join(" | ") ===
    [
      "Bold Italic Underline Strikethrough Link Superscript Subscript",
      "Serif Hand Inline Code",
      "Pink Highlight Yellow Highlight Sky Highlight Sea Highlight Mint Highlight No Highlight",
      "—",
      "Title",
      "Heading",
      "Subheading",
      "Body",
      "Code",
      "—",
      "Bulleted List",
      "Numbered List",
      "To-do List",
      "—",
      "Quote",
      "—",
      "Decrease Indent Increase Indent",
    ].join(" | "),
  rows.join(" | "),
)
check("Body is ticked", (await page.$eval(".rich-style-row.active .rich-style-label", n => n.textContent)) === "Body")
await shot("topbar-popover")

// Marks, as lush writes them.
await press("Bold")
check("B writes strong", (await marksOn("apples")).strong === true, JSON.stringify(await marksOn("apples")))
check("B shows as on", await page.$eval('.rich-format-popover button[title="Bold"]', b => b.classList.contains("active")))
await press("Bold")
check("B again takes it off", (await marksOn("apples")).strong === undefined, JSON.stringify(await marksOn("apples")))
await press("Underline")
await press("Strikethrough")
check("U and S", (await marksOn("apples")).underline === true && (await marksOn("apples")).strikethrough === true)
await press("Underline")
await press("Strikethrough")
await press("Superscript")
await press("Subscript")
check("sub replaces super", (await marksOn("apples")).subscript === true && !(await marksOn("apples")).superscript, JSON.stringify(await marksOn("apples")))
await press("Subscript")
await press("Serif")
check("Serif writes font: serif", (await marksOn("apples")).font === "serif", JSON.stringify(await marksOn("apples")))
await press("Hand")
check("Hand replaces it", (await marksOn("apples")).font === "hand", JSON.stringify(await marksOn("apples")))
await press("Hand")
check("Hand again clears it", (await marksOn("apples")).font === undefined, JSON.stringify(await marksOn("apples")))
await press("Inline Code")
check("Code writes the code mark", (await marksOn("apples")).code === true)
check("no two buttons share a name", await page.$$eval(".rich-format-popover button", buttons => {
  const names = buttons.map(b => b.getAttribute("aria-label"))
  return new Set(names).size === names.length
}))
await press("Inline Code")
await press("Superscript")
check("the Aa turns pink for superscript alone", await page.$eval(".rich-aa", b => b.classList.contains("marked")))
await press("Superscript")
await press("Sky Highlight")
check("a swatch writes the highlight by name", (await marksOn("apples")).highlight === "sky", JSON.stringify(await marksOn("apples")))
await press("No Highlight")
check("none clears it", (await marksOn("apples")).highlight === undefined)

// A link is a plain URL, edited in lush's Link sheet: 380 wide, the field
// taking Enter, Remove · Cancel · Apply.
const linkWith = async (typed, key = "Enter") => {
  await select("apples")
  await press("Link")
  await page.waitForSelector(".rich-link-dialog .rich-link-input")
  await page.fill(".rich-link-dialog .rich-link-input", typed)
  if (key === "Enter") await page.press(".rich-link-dialog .rich-link-input", "Enter")
  else await page.click(`.rich-link-dialog button:has-text("${key}")`)
  await page.waitForTimeout(150)
  return (await marksOn("apples")).link
}
await select("apples")
await press("Link")
await page.waitForSelector(".rich-link-dialog")
const sheet = await page.$eval(".rich-link-dialog form", form => ({
  width: form.getBoundingClientRect().width,
  buttons: [...form.querySelectorAll("button")].map(b => b.textContent),
  placeholder: form.querySelector("input").placeholder,
  focused: document.activeElement === form.querySelector("input"),
  applyDisabled: form.querySelector("button[type=submit]").disabled,
}))
check("the Link sheet is lush's", sheet.width === 380 && sheet.buttons.join(" ") === "Remove Cancel Apply" && sheet.placeholder === "https://" && sheet.focused && sheet.applyDisabled, JSON.stringify(sheet))
await shot("topbar-link")
await page.keyboard.press("Escape")
check("Escape closes it", (await page.$$(".rich-link-dialog")).length === 0)
check("a full URL is kept", (await linkWith("https://example.com/?q=1")) === "https://example.com/?q=1", await marksOn("apples").then(JSON.stringify))
check("a bare domain gets https://", (await linkWith("example.com")) === "https://example.com", await marksOn("apples").then(JSON.stringify))
check("an address becomes mailto:", (await linkWith("me@x.org", "Apply")) === "mailto:me@x.org", await marksOn("apples").then(JSON.stringify))
check("Cancel leaves the link be", (await linkWith("other.org", "Cancel")) === "mailto:me@x.org")
await select("apples")
await press("Link")
check("an existing link fills the field", (await page.inputValue(".rich-link-dialog .rich-link-input")) === "mailto:me@x.org")
await page.click(".rich-link-dialog button:has-text('Remove')")
await page.waitForTimeout(150)
check("Remove takes it off", (await marksOn("apples")).link === undefined, JSON.stringify(await marksOn("apples")))
await linkWith("https://example.com/?q=1")
check(
  "a link is pink",
  (await page.$eval("wg-content a", a => getComputedStyle(a).color)) === "rgb(255, 105, 165)",
  await page.$eval("wg-content a", a => getComputedStyle(a).color),
)

// Styles.
await caretIn("second")
const styleOf = async word => {
  const all = await spans()
  const index = all.findIndex(span => span.type === "text" && span.value.includes(word))
  for (let i = index; i >= 0; i--) if (all[i].type === "block") return all[i].value
  return null
}
await press("Title")
check("Title is heading level 1", JSON.stringify(await styleOf("second")) === JSON.stringify({ type: "heading", parents: [], attrs: { level: 1 }, isEmbed: false }), JSON.stringify(await styleOf("second")))
await press("Subheading")
check("Subheading is level 3", (await styleOf("second"))?.attrs?.level === 3)
await press("Subheading")
check("picking the style it has makes it Body", (await styleOf("second"))?.type === "paragraph")
await press("Bulleted List")
check("Bulleted List", (await styleOf("second"))?.type === "unordered-list-item")
await press("To-do List")
check("To-do List replaces it", (await styleOf("second"))?.type === "todo-list-item" && (await styleOf("second"))?.parents.length === 0, JSON.stringify(await styleOf("second")))
await press("Quote")
check("Quote", (await styleOf("second"))?.type === "blockquote", JSON.stringify(await styleOf("second")))
await press("Body")

// Indent: lush's `indent` attr on a paragraph, and back.
await press("Increase Indent")
await press("Increase Indent")
check("indent writes attrs.indent", (await styleOf("second"))?.attrs?.indent === 2, JSON.stringify(await styleOf("second")))
await press("Decrease Indent")
await press("Decrease Indent")
check("outdent to nothing drops the attr", JSON.stringify((await styleOf("second"))?.attrs) === "{}", JSON.stringify(await styleOf("second")))

// Lists nest instead: a nested bullet has its own type in parents.
await press("Bulleted List")
await caretIn("apples")
await press("Bulleted List")
await caretIn("second")
await press("Increase Indent")
check(
  "a list item indents by nesting",
  JSON.stringify(await styleOf("second")) === JSON.stringify({ type: "unordered-list-item", parents: ["unordered-list-item"], attrs: {}, isEmbed: false }),
  JSON.stringify(await styleOf("second")),
)
await press("Decrease Indent")
await press("Decrease Indent")
check("outdenting a top-level item makes it a paragraph", (await styleOf("second"))?.type === "paragraph", JSON.stringify(await styleOf("second")))

// The language row only shows in a code block, and writes `language`.
check("no language row outside code", (await page.$$(".rich-format-popover .rich-language-select")).length === 0)
await caretIn("let")
await openAa()
await page.waitForSelector(".rich-format-popover .rich-language-select")
await page.selectOption(".rich-format-popover .rich-language-select", "swift")
await page.waitForTimeout(150)
check("the language is stored", (await styleOf("let"))?.attrs?.language === "swift", JSON.stringify(await styleOf("let")))
await page.keyboard.press("Escape")

// The paperclip menu.
await caretIn("second")
await page.click(".rich-clip")
await page.waitForSelector(".rich-attach-menu")
const attach = await page.$$eval(".rich-attach-menu .rich-popover-body > *", items =>
  items.map(item => (item.classList.contains("rich-popover-divider") ? "—" : item.textContent)),
)
check(
  "the paperclip menu is lush's",
  attach.join(" | ") ===
    "Choose Photo… | Record Audio | Live Transcription | Attach File… | — | Logline | Logline… | Table | Columns | HTML Block | Patchwork Doc…",
  attach.join(" | "),
)
await shot("topbar-attach")
await page.click(".rich-attach-menu .rich-menu-item:has-text('Logline')")
await page.waitForTimeout(300)
const logline = (await blocks()).find(value => value.type === "context")
check("Logline inserts a context block on its own line", logline?.isEmbed === true && logline.parents.length === 0, JSON.stringify(logline))
check("its stamp has no fractional seconds", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/.test(logline?.attrs?.ts ?? ""), logline?.attrs?.ts)
check("and a time zone", typeof logline?.attrs?.tz === "string" && logline.attrs.tz.length > 0, logline?.attrs?.tz)

await page.click(".rich-clip")
await page.click(".rich-attach-menu .rich-menu-item:has-text('HTML Block')")
await page.waitForTimeout(200)
check("HTML Block inserts an html embed", (await blocks()).some(value => value.type === "html" && value.isEmbed))
check("and opens its source sheet", await page.isVisible(".rich-html-sheet textarea"))
await page.keyboard.press("Escape")

await page.click(".rich-clip")
await page.click(".rich-attach-menu .rich-menu-item:has-text('Columns')")
await page.waitForTimeout(200)
const columns = (await blocks()).filter(value => value.type === "column")
check("Columns inserts two top-level columns", columns.length === 2 && columns.every(value => JSON.stringify(value.parents) === '["columns"]'), JSON.stringify(columns))

await page.click(".rich-clip")
await page.click(".rich-attach-menu .rich-menu-item:has-text('Table')")
await page.waitForTimeout(200)
check("Table inserts a top-level table", (await blocks()).some(value => value.type === "table" && value.parents.length === 0))

// Duplicate: a new note from the spans, with none of this one's history.
await page.keyboard.press("Escape")
const duplicated = page.evaluate(
  () =>
    new Promise(resolve =>
      document.addEventListener("rich:duplicated", event => resolve(event.detail.url), { once: true }),
    ),
)
await page.click(".rich-more")
await page.click(".rich-note-menu .rich-menu-item:has-text('Duplicate')")
const copyUrl = await duplicated
const copy = await page.evaluate(async url => {
  const { repo, am, handle } = window.richDev
  const copy = await repo.find(url)
  const sorted = value =>
    JSON.stringify(value, (key, inner) =>
      inner && typeof inner === "object" && !Array.isArray(inner) && !am.isImmutableString(inner)
        ? Object.fromEntries(Object.keys(inner).sort().map(k => [k, inner[k]]))
        : am.isImmutableString(inner) ? `str:${inner.val}` : inner,
    )
  const theirs = new Set(am.getAllChanges(handle.doc()).map(change => am.decodeChange(change).hash))
  return {
    shared: am.getAllChanges(copy.doc()).filter(change => theirs.has(am.decodeChange(change).hash)).length,
    same:
      sorted(am.spans(copy.doc(), ["content"])) === sorted(am.spans(handle.doc(), ["content"])),
    title: String(copy.doc().title),
    patchworkTitle: String(copy.doc()["@patchwork"]?.title),
  }
}, copyUrl)
check("the duplicate has the same content", copy.same)
check("the duplicate shares no history", copy.shared === 0, `${copy.shared} shared changes`)
check("the duplicate is marked a copy", copy.title.startsWith("Copy of"), copy.title)
check("in both of its titles", copy.patchworkTitle === copy.title, copy.patchworkTitle)

// Patchwork Doc…: a datatype picker that makes a new document and embeds it.
await caretIn("second")
await page.click(".rich-clip")
await page.click(".rich-attach-menu .rich-menu-item:has-text('Patchwork Doc')")
await page.waitForSelector(".rich-doc-sheet .rich-doc-type")
const types = await page.$$eval(".rich-doc-sheet .rich-doc-type", nodes => nodes.map(node => node.dataset.type))
check("Patchwork Doc… offers the datatypes", types.includes("rich"), JSON.stringify(types))
await shot("topbar-patchwork-doc")
const embedsBefore = (await blocks()).filter(value => value.type === "embed").length
await page.click(".rich-doc-sheet .rich-doc-type[data-type=rich]")
await page.waitForTimeout(400)
const made = (await blocks()).filter(value => value.type === "embed")
const madeUrl = made[made.length - 1]?.attrs?.url
check("picking one embeds a new document", made.length === embedsBefore + 1 && /^automerge:/.test(madeUrl ?? ""), JSON.stringify(made))
const madeType = await page.evaluate(async url => {
  const handle = await window.richDev.repo.find(url)
  return String(handle.doc()?.["@patchwork"]?.type)
}, madeUrl)
check("made with repo.create and the datatype's init", madeType === "rich", madeType)

// The ••• menu.
await page.click(".rich-more")
await page.waitForSelector(".rich-note-menu")
const more = await page.$$eval(".rich-note-menu .rich-popover-body > *", items =>
  items.map(item => (item.classList.contains("rich-popover-divider") ? "—" : item.querySelector(".rich-menu-label").textContent)),
)
check(
  "the ••• menu",
  more.join(" | ") ===
    "Duplicate | Copy Link | — | Find… | Find and Replace… | — | Export as Markdown… | Export as HTML… | — | Move Checked to Bottom | Hide Checked Items | Delete Checked Items | — | Plugins…",
  more.join(" | "),
)
await shot("topbar-more")
const download = page.waitForEvent("download")
await page.click(".rich-note-menu .rich-menu-item:has-text('Export as Markdown')")
const file = await download
const markdown = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString())
check("Export as Markdown", file.suggestedFilename() === "Shopping.md" && markdown.startsWith("# Shopping\n") && markdown.includes("[apples](https://example.com/?q=1)"), JSON.stringify(markdown.slice(0, 120)))
await page.click(".rich-more")
const htmlDownload = page.waitForEvent("download")
await page.click(".rich-note-menu .rich-menu-item:has-text('Export as HTML')")
const htmlFile = await htmlDownload
const html = await (await htmlFile.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString())
check("Export as HTML", htmlFile.suggestedFilename() === "Shopping.html" && html.includes("<h1>Shopping</h1>") && html.includes('<a href="https://example.com/?q=1">apples</a>'), html.slice(0, 80))

// Find in note.
await page.click(".rich-more")
await page.click(".rich-note-menu .rich-menu-item:has-text('Find…')")
await page.waitForSelector(".rich-find .rich-find-input")
await page.keyboard.type("e")
await page.waitForTimeout(100)
const found = await page.$$eval("wg-content .rich-find-match", nodes => nodes.length)
check("Find marks the matches", found > 3, `${found} marked`)
check("and counts them", /^1\/\d+$/.test(await page.textContent(".rich-find-count")), await page.textContent(".rich-find-count"))
await page.keyboard.press("Enter")
await page.waitForTimeout(100)
check("Enter steps to the next", (await page.textContent(".rich-find-count")).startsWith("2/"), await page.textContent(".rich-find-count"))
await shot("topbar-find")
await page.fill(".rich-find-input", "pears")
await page.click(".rich-find-toggle")
await page.fill(".rich-replace-input", "plums")
await page.click(".rich-replace-row button:has-text('All')")
await page.waitForTimeout(150)
check("Replace All", (await spans()).filter(span => span.type === "text").map(span => span.value).join("").includes("apples and plums"), JSON.stringify((await spans()).filter(s => s.type === "text").map(s => s.value)))
await page.keyboard.press("Escape")
await page.waitForTimeout(100)
check("Escape closes the find bar", (await page.$$(".rich-find")).length === 0 && (await page.$$("wg-content .rich-find-match")).length === 0)

// Checked items: to the bottom, hidden, deleted.
await page.evaluate(
  spans => window.richDev.mount(spans),
  [
    block("heading", [], { level: 1 }), text("Chores"),
    block("heading", [], { level: 2 }), text("Morning"),
    block("todo-list-item", [], { checked: true }), text("coffee"),
    block("todo-list-item"), text("walk"),
    block("todo-list-item", [], { checked: true }), text("feed cat"),
    block("todo-list-item"), text("post"),
    block("heading", [], { level: 3 }), text("Later"),
  ],
)
await page.waitForTimeout(200)
const todoOrder = async () => (await spans()).filter(span => span.type === "text").map(span => span.value).join(",")
await page.click(".rich-more")
await page.click(".rich-note-menu .rich-menu-item:has-text('Move Checked to Bottom')")
await page.waitForTimeout(150)
check("Move Checked to Bottom", (await todoOrder()) === "Chores,Morning,walk,post,coffee,feed cat,Later", await todoOrder())
await page.click(".rich-more")
await page.click(".rich-note-menu .rich-menu-item:has-text('Hide Checked Items')")
check("Hide Checked Items", !(await page.isVisible("wg-content li[data-checked]")))
await page.click(".rich-more")
check("then it offers Show", (await page.$$(".rich-note-menu .rich-menu-item:has-text('Show Checked Items')")).length === 1)
await page.click(".rich-note-menu .rich-menu-item:has-text('Show Checked Items')")
check("Show brings them back", await page.isVisible("wg-content li[data-checked]"))
await page.click(".rich-more")
await page.click(".rich-note-menu .rich-menu-item:has-text('Delete Checked Items')")
await page.waitForTimeout(150)
check("Delete Checked Items", (await todoOrder()) === "Chores,Morning,walk,post,Later", await todoOrder())

// Right-click a box: the four states.
const box = await page.$eval("wg-content li", li => {
  const rect = li.getBoundingClientRect()
  return { x: rect.left + 18, y: rect.top + rect.height / 2 }
})
await page.mouse.click(box.x, box.y, { button: "right" })
await page.waitForSelector(".rich-todo-menu")
const states = await page.$$eval(".rich-todo-menu .rich-menu-label", nodes => nodes.map(node => node.textContent))
check("right-click on a box offers the four states", states.join(",") === "To-do,Done,Canceled,Pending", states.join(","))
await shot("todo-menu")
await page.click(".rich-todo-menu .rich-menu-item:has-text('Canceled')")
await page.waitForTimeout(150)
check("Canceled writes state", (await blocks()).find(value => value.type === "todo-list-item")?.attrs?.state === "canceled", JSON.stringify(await blocks()))

// Info and Outline.
await page.click(".rich-info")
await page.waitForSelector(".rich-info-popover")
const infoText = await page.textContent(".rich-info-popover")
check("info shows the counts", ["Words", "Characters", "Paragraphs", "Headings", "To-dos"].every(word => infoText.includes(word)), infoText)
check("the (i) is pink while open", (await page.$eval(".rich-info", b => getComputedStyle(b).color)) === "rgb(255, 105, 165)")
await shot("topbar-info")
await page.click(".rich-info-popover .rich-tab:has-text('Outline')")
const outline = await page.$$eval(".rich-outline-item", nodes => nodes.map(node => `${node.className.match(/level-(\d)/)[1]}:${node.textContent}`))
check("the Outline lists the headings", outline.join(",") === "1:Chores,2:Morning,3:Later", outline.join(","))
await shot("topbar-outline")
await page.click(".rich-outline-item:has-text('Later')")
await page.waitForTimeout(100)
check("clicking one goes there", await page.evaluate(() => window.richDev.editor.state.sel.head.textblockParent.node.textContent() === "Later"))

// Phone width: the format popover is a bottom island.
await page.setViewportSize({ width: 390, height: 760 })
await page.waitForTimeout(100)
await page.click(".rich-aa")
await page.waitForSelector(".rich-format-popover.rich-island")
await page.waitForTimeout(300)
const island = await page.$eval(".rich-format-popover", node => {
  const rect = node.getBoundingClientRect()
  const note = node.closest(".rich-tool").getBoundingClientRect()
  return { bottom: Math.round(note.bottom - rect.bottom), width: Math.round(rect.width), header: node.querySelector(".rich-island-header h3")?.textContent }
})
check("at phone width Aa opens the Format island", island.bottom === 12 && island.width === 366 && island.header === "Format", JSON.stringify(island))
await shot("topbar-island")
await page.click(".rich-island-close")
check("its ⊗ closes it", (await page.$$(".rich-format-popover")).length === 0)

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
