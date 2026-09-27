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
      "Serif Hand Code",
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
await press("Code")
check("Code writes the code mark", (await marksOn("apples")).code === true)
await press("Code")
await press("Sky Highlight")
check("a swatch writes the highlight by name", (await marksOn("apples")).highlight === "sky", JSON.stringify(await marksOn("apples")))
await press("No Highlight")
check("none clears it", (await marksOn("apples")).highlight === undefined)

// A link is a plain URL.
await press("Link")
await page.fill(".rich-format-popover .rich-link-input", "https://example.com/?q=1")
await page.press(".rich-format-popover .rich-link-input", "Enter")
await page.waitForTimeout(150)
check("the link is stored as a plain url", (await marksOn("apples")).link === "https://example.com/?q=1", JSON.stringify(await marksOn("apples")))

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
check("its stamp has no fractional seconds", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(logline?.attrs?.ts ?? ""), logline?.attrs?.ts)
check("and a time zone", typeof logline?.attrs?.tz === "string" && logline.attrs.tz.length > 0, logline?.attrs?.tz)

await page.click(".rich-clip")
await page.click(".rich-attach-menu .rich-menu-item:has-text('HTML Block')")
await page.waitForTimeout(200)
check("HTML Block inserts an html embed", (await blocks()).some(value => value.type === "html" && value.isEmbed))

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
  }
}, copyUrl)
check("the duplicate has the same content", copy.same)
check("the duplicate shares no history", copy.shared === 0, `${copy.shared} shared changes`)
check("the duplicate is marked a copy", copy.title.startsWith("Copy of"), copy.title)

// Info.
await page.click(".rich-info")
await page.waitForSelector(".rich-info-popover")
check("info shows the word count", (await page.textContent(".rich-info-popover")).includes("Words"))
await shot("topbar-info")

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
