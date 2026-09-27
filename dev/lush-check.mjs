// A note written by lush (chee's Swift notes app) opens in rich without
// losing or mangling anything, and writes back exactly as lush wrote it.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } })
const problems = []
const errors = []
page.on("pageerror", error => errors.push(String(error)))
page.on("console", message => {
  if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text())
})

// Spans compared as lush compares them: attrs in any order, no empty marks.
const canon = value =>
  Array.isArray(value)
    ? value.map(canon)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .filter(key => !(key === "marks" && Object.keys(value.marks ?? {}).length === 0))
            .sort()
            .map(key => [key, canon(value[key])]),
        )
      : value
// Adjacent text with the same marks is one run to automerge.
const merged = spans => {
  if (!Array.isArray(spans)) return spans
  const out = []
  for (const span of canon(spans)) {
    const last = out[out.length - 1]
    if (span.type === "text" && last?.type === "text" && JSON.stringify(last.marks) === JSON.stringify(span.marks)) {
      out[out.length - 1] = { ...last, value: last.value + span.value }
    } else out.push(span)
  }
  return out
}
const same = (a, b) => JSON.stringify(merged(canon(a))) === JSON.stringify(merged(canon(b)))

function check(name, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!condition) problems.push(name)
}

const block = (type, parents = [], attrs = {}, isEmbed = false) => ({
  type: "block",
  value: { type, parents, attrs, isEmbed },
})
const text = (value, marks) => (marks ? { type: "text", value, marks } : { type: "text", value })

// Everything lush writes, in one note.
export const LUSH_NOTE = [
  block("heading", [], { level: 1 }),
  text("A lush note"),
  block("paragraph"),
  text("plain "),
  text("bold", { strong: true }),
  text(" "),
  text("italic", { em: true }),
  text(" "),
  text("link", { link: "https://example.com/a?b=c" }),
  text(" "),
  text("sky", { highlight: "sky" }),
  text(" "),
  text("under", { underline: true }),
  text(" "),
  text("struck", { strikethrough: true }),
  text(" x"),
  text("2", { superscript: true }),
  text(" H"),
  text("2", { subscript: true }),
  text("O "),
  text("serif", { font: "serif" }),
  text(" "),
  text("hand", { font: "hand" }),
  text(" "),
  text("mono", { code: true }),
  text(" "),
  text("mystery", { mystery: "kept" }),
  block("paragraph", [], { indent: 2 }),
  text("indented twice"),
  block("heading", [], { level: 2, indent: 1 }),
  text("An indented heading"),
  block("code-block", [], { language: "swift" }),
  text("let a = 1"),
  block("code-block", [], { language: "swift" }),
  text("let b = 2"),
  block("unordered-list-item"),
  text("bullet"),
  block("unordered-list-item", ["unordered-list-item"]),
  text("nested bullet"),
  block("ordered-list-item"),
  text("first"),
  block("ordered-list-item"),
  text("second"),
  block("todo-list-item"),
  text("open"),
  block("todo-list-item", [], { checked: true }),
  text("done"),
  block("todo-list-item", [], { state: "canceled" }),
  text("canceled"),
  block("todo-list-item", [], { state: "pending" }),
  text("pending"),
  block("blockquote"),
  text("quoted soft break"),
  block("paragraph", ["blockquote"]),
  text("second quote line"),
  block("embed", [], { url: "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ", alt: "a photo", width: 320, height: 200 }, true),
  block("paragraph"),
  text("after the embed"),
  block(
    "context",
    [],
    {
      ts: "2026-09-27T10:11:12+01:00",
      tz: "Europe/London",
      location: "Leeds",
      lat: 53.8,
      lon: -1.55,
      weather: "11°C, drizzle",
      nowPlaying: "Stereolab — French Disko",
      pending: true,
    },
    true,
  ),
  block(
    "calendar-event",
    [],
    { event: "ev1", kind: "event", title: "Tea", start: "2026-09-28T16:00:00", end: "2026-09-28T17:00:00", color: "#FF4D97" },
    true,
  ),
  block("html", [], { html: "<b>hi</b>" }, true),
  block("table"),
  block("table-row", ["table"]),
  block("table-header-cell", ["table", "table-row"]),
  text("Name"),
  block("table-header-cell", ["table", "table-row"]),
  text("Notes"),
  block("table-row", ["table"]),
  block("table-cell", ["table", "table-row"]),
  text("chee"),
  block("table-cell", ["table", "table-row"]),
  text("line one"),
  block("paragraph", ["table", "table-row", "table-cell"]),
  text("line two"),
  block("columns"),
  block("column", ["columns"]),
  text("left"),
  block("column", ["columns"]),
  text("right"),
  block("paragraph", ["columns", "column"]),
  text("right again"),
  block("paragraph"),
  text("the end"),
]

await page.goto(url)
await page.waitForSelector("wg-content")

await page.evaluate(spans => window.richDev.mount(spans), LUSH_NOTE)
await page.waitForTimeout(300)

const written = await page.evaluate(() => window.richDev.written())
const stored = await page.evaluate(() => window.richDev.spans())
const firstDiff = (a, b) => {
  a = merged(a)
  b = merged(b)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (!same(a[i], b[i])) return `${i}: ${JSON.stringify(b[i])} → ${JSON.stringify(a[i])}`
  }
  return ""
}
check("a lush note writes back as lush wrote it", same(written, stored), firstDiff(written, stored))
check("rewriting a lush note changes nothing", !(await page.evaluate(() => window.richDev.rewrite())))

const trip = await page.evaluate(() => window.richDev.roundTrip())
const at = [...trip.live].findIndex((c, i) => c !== trip.rebuilt[i])
check("a lush note round trips", trip.live === trip.rebuilt, `${trip.live.slice(at - 80, at + 80)} ≠ ${trip.rebuilt.slice(at - 80, at + 80)}`)

// What it looks like.
const has = selector => page.$$eval(selector, nodes => nodes.length)
check("headings", (await has("wg-content h1")) === 1 && (await has("wg-content h2")) === 1)
check("fonts render", (await has(".rich-font-serif")) === 1 && (await has(".rich-font-hand")) === 1)
check("indent renders", (await has("wg-content p[data-indent='2']")) === 1)
check("a code block holds its lines", (await has("wg-content pre")) === 1, String(await has("wg-content pre")))
check("the code block knows its language", (await has("wg-content pre[data-language='swift']")) === 1)
check("the nested bullet nests", (await has("wg-content ul ul li")) === 1)
check(
  "todo states",
  (await has("wg-content li[data-checked]")) === 1 &&
    (await has("wg-content li[data-state='canceled']")) === 1 &&
    (await has("wg-content li[data-state='pending']")) === 1,
)
check("the soft break is a line break", (await has("wg-content blockquote br")) === 1)
check("the quote holds both lines", (await has("wg-content blockquote p")) === 2)
check("the embed is a block of its own", (await has("wg-content > rich-embed")) === 1)
check("the logline is a block of its own", (await has("wg-content > rich-logline")) === 1)
check("the calendar event draws as a card", (await has("wg-content > rich-card[block-type='calendar-event']")) === 1)
check("the html block", (await has("wg-content > rich-html")) === 1)
check("the header row", (await has("wg-content table th")) === 2)
check("a cell holds two lines", (await page.$$eval("wg-content table td", tds => tds[1]?.querySelectorAll("p").length)) === 2)
check("columns", (await has("wg-content .rich-columns .rich-column")) === 2)
await page.screenshot({ path: "dev/shots/lush-note.png", fullPage: true })

const typeAt = async (word, typed) => {
  await page.evaluate(word => {
    const editor = window.richDev.editor
    let found = null
    editor.state.doc.iterate(0, editor.state.doc.contentLength, (node, pos) => {
      if (found == null && node.isText && node.param.includes(word)) found = pos + node.param.indexOf(word) + word.length
    })
    editor.dispatch({ selection: { anchor: found } })
    editor.focus()
  }, word)
  await page.keyboard.type(typed, { delay: 20 })
  await page.waitForTimeout(150)
}
// The title is derived from the first line, as lush derives it.
await typeAt("A lush note", "!")
const titles = await page.evaluate(() => ({
  title: window.richDev.handle.doc().title,
  patchwork: window.richDev.handle.doc()["@patchwork"].title,
}))
check("typing writes the title", titles.title === "A lush note!", JSON.stringify(titles))
check("and @patchwork's", titles.patchwork === "A lush note!", JSON.stringify(titles))

// Typing (the fast path straight into automerge) leaves automerge holding
// what the editor would write, wherever it happens.
for (const [word, typed] of [
  ["let b", " + a"],
  ["soft", "er"],
  ["second quote", " (still)"],
  ["bold", "er"],
  ["line two", "!"],
  ["right again", "?"],
  ["after the embed", "."],
  ["nested bullet", "s"],
]) {
  await typeAt(word, typed)
  const now = await page.evaluate(() => ({ written: window.richDev.written(), stored: window.richDev.spans() }))
  check(`typing after "${word}" keeps automerge in step`, same(now.written, now.stored), firstDiff(now.written, now.stored))
}

// Return in a code block is another code-block line, as in lush.
await typeAt("+ a = 2", "")
await page.keyboard.press("Enter")
await page.keyboard.type("let c = 3", { delay: 20 })
await page.waitForTimeout(200)
{
  const now = await page.evaluate(() => ({ written: window.richDev.written(), stored: window.richDev.spans() }))
  const lines = now.stored.filter(span => span.type === "block" && span.value.type === "code-block")
  check("Return in code makes a third code-block marker", lines.length === 3 && lines.every(line => line.value.attrs.language === "swift"), await page.$eval("wg-content pre", pre => pre.outerHTML))
  check("and automerge keeps in step", same(now.written, now.stored), firstDiff(now.written, now.stored))
}

// A structural edit writes the whole note, and still keeps what rich doesn't
// model.
await typeAt("A lush note!", "")
await page.keyboard.press("Enter")
await page.keyboard.type("new line", { delay: 20 })
await page.waitForTimeout(200)
const after = await page.evaluate(() => window.richDev.spans())
const find = (spans, type) => spans.find(span => span.type === "block" && span.value.type === type)?.value
check("embed extras survive a write", same(find(after, "embed")?.attrs, { url: "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ", alt: "a photo", width: 320, height: 200 }), JSON.stringify(find(after, "embed")))
check("logline extras survive a write", find(after, "context")?.attrs?.nowPlaying === "Stereolab — French Disko" && find(after, "context")?.attrs?.pending === true, JSON.stringify(find(after, "context")))
check("the calendar event survives a write", find(after, "calendar-event")?.attrs?.title === "Tea")
check("the unknown mark survives a write", after.some(span => span.type === "text" && span.marks?.mystery === "kept"))
check("the font mark survives a write", after.some(span => span.type === "text" && span.marks?.font === "hand"))
check("links are plain urls", after.some(span => span.type === "text" && span.marks?.link === "https://example.com/a?b=c"))
check("code is one marker a line", after.filter(span => span.type === "block" && span.value.type === "code-block").length === 3, JSON.stringify(after.filter(span => span.type === "block" && span.value.type === "code-block")))
check("the soft break is U+2028", after.some(span => span.type === "text" && span.value.includes(" ")))
check(
  "header cells nest under table-cell",
  after.some(span => span.type === "block" && JSON.stringify(span.value.parents) === JSON.stringify(["table", "table-row", "table-cell"])),
)

// Duplicating makes a new note with no shared history.
const copy = await page.evaluate(() => {
  const result = window.richDev.copy()
  return { ...result, stored: window.richDev.spans() }
})
copy.same = same(copy.spans, copy.stored)
check("a copy keeps every block and mark", copy.same)
check("a copy has none of the note's history", copy.history < copy.sourceHistory, `${copy.history} vs ${copy.sourceHistory}`)
check("a copy keeps @patchwork", copy.patchwork?.type === "rich", JSON.stringify(copy.patchwork))

// A note written by an older rich: embeds inside paragraphs, JSON links,
// multi-line code in one marker.
const OLD_RICH = [
  block("paragraph"),
  text("before "),
  text("old link", { link: JSON.stringify({ href: "https://old.example", title: "" }) }),
  block("paragraph"),
  block("image", ["paragraph"], { src: "https://example.com/cat.png" }, true),
  block("paragraph"),
  text("text then "),
  block("embed", ["paragraph"], { url: "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" }, true),
  text(" and after"),
  block("code-block"),
  text("one\ntwo"),
]
await page.evaluate(spans => window.richDev.mount(spans), OLD_RICH)
await page.waitForTimeout(300)
const upgraded = await page.evaluate(() => window.richDev.written())
const types = upgraded.filter(span => span.type === "block").map(span => `${span.value.type}${span.value.parents.length ? `(${span.value.parents})` : ""}`)
check(
  "an older rich note reads with its embeds on their own lines",
  types.join(" ") === "paragraph image paragraph embed paragraph code-block code-block",
  types.join(" "),
)
check("old JSON links are written as plain urls", upgraded.some(span => span.marks?.link === "https://old.example"))
check("an older note loads clean", (await has("wg-content > p > rich-embed")) === 0)

// Lush lets any list item nest, the first one too, and depth can jump: the
// items read as they are and write back without an empty item above them.
const NESTED = [
  block("unordered-list-item", ["unordered-list-item"]),
  text("nested first"),
  block("unordered-list-item"),
  text("top"),
  block("unordered-list-item", ["unordered-list-item", "unordered-list-item"]),
  text("two deep"),
  block("paragraph"),
  text("after"),
]
await page.evaluate(spans => window.richDev.mount(spans), NESTED)
await page.waitForTimeout(300)
const nestedBack = await page.evaluate(() => window.richDev.written())
check("nested-first list items write back as they came", same(nestedBack, NESTED), firstDiff(nestedBack, NESTED))
check("no empty bullet is drawn", (await page.$$eval("wg-content li", items => items.filter(li => !li.textContent.trim()).length === 0 || items.every(li => li.querySelector("ul")))))

// Tab on the first item nests it, as lush does.
await page.evaluate(spans => window.richDev.mount(spans), [block("ordered-list-item"), text("one"), block("ordered-list-item"), text("two")])
await page.waitForTimeout(200)
await page.click("wg-content li >> nth=0")
await page.keyboard.press("Tab")
await page.waitForTimeout(200)
const tabbed = (await page.evaluate(() => window.richDev.spans())).filter(span => span.type === "block").map(span => span.value.parents.join("/"))
check("Tab nests the first item", JSON.stringify(tabbed) === JSON.stringify(["ordered-list-item", ""]), JSON.stringify(tabbed))

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
