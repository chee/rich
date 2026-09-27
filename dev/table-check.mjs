import { chromium } from "playwright"

const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const errors = []
page.on("pageerror", e => errors.push(String(e)))
page.on("console", m => m.type() === "error" && errors.push(m.text()))
const problems = []
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) problems.push(name)
}
const shot = name =>
  page.screenshot({
    path: new URL(`./shots/${name}.png`, import.meta.url).pathname,
    caret: "initial",
  })

const shape = () =>
  page.$$eval("wg-content table tr", rows =>
    rows.map(r => [...r.cells].map(c => c.tagName.toLowerCase()).join("")),
  )

await page.goto(process.env.RICH_DEV_URL ?? "http://localhost:5173/")
await page.waitForSelector("wg-content")
await page.click("wg-content")
await page.keyboard.type("Notes", { delay: 40 })
await page.keyboard.press("Enter")
await page.keyboard.type("/", { delay: 40 })
await page.waitForSelector(".rich-slash-item")
await page.keyboard.type("table", { delay: 40 })
await page.waitForTimeout(100)
await page.keyboard.press("Enter")
await page.waitForSelector("wg-content table")
check("table inserted 3x3", JSON.stringify(await shape()) === '["thth th","tdtdtd","tdtdtd"]'.replace(" ", ""), JSON.stringify(await shape()))

// Tab walks cells.
await page.keyboard.type("a")
await page.waitForTimeout(120)
await page.keyboard.press("Tab")
await page.waitForTimeout(120)
await page.keyboard.type("b")
await page.waitForTimeout(120)
check("tab moved to next cell", (await page.textContent("wg-content table")).includes("b"))

// Tab from the last cell grows the table.
const before = (await shape()).length
for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(80) }
const grown = await shape()
check("tab at the last cell adds a row", grown.length === before + 1, JSON.stringify(grown))
await shot("table-tab")

// Handles appear on hover.
const box = await page.locator("wg-content table").boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(150)
const grips = await page.$$eval(".rich-table-grip", n => n.length)
const pluses = await page.$$eval(".rich-table-plus", n => n.length)
check("row and column grips drawn", grips === 3 + grown.length, `${grips} grips`)
check("two + buttons drawn", pluses === 2, `${pluses}`)
await shot("table-handles")

// The + buttons sit outside the table, so moving the pointer off the table to
// reach them must not take them away.
const plusBox = await page.locator(".rich-table-plus.column").boundingBox()
await page.mouse.move(plusBox.x + plusBox.width / 2, plusBox.y + plusBox.height / 2)
await page.waitForTimeout(200)
check(
  "the + survives the pointer leaving the table",
  (await page.$$(".rich-table-plus")).length === 2,
)

// The + past the last column grows the table sideways.
const widthBefore = (await shape())[0].length / 2
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(150)
const widened = await shape()
check("+ adds a column", widened[0].length / 2 === widthBefore + 1, JSON.stringify(widened))

// And the handles are still there afterwards, so it can be clicked again.
check(
  "the handles are redrawn after the table grows",
  (await page.$$(".rich-table-plus")).length === 2,
)

// The + past the last row grows it downwards.
const rowsBefore = widened.length
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(150)
await page.click(".rich-table-plus.row")
await page.waitForTimeout(150)
check("+ adds a row", (await shape()).length === rowsBefore + 1, JSON.stringify(await shape()))
await shot("table-grown")

// A column grip selects the column; the ••• menu then offers the table verbs.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(150)
await page.click(".rich-table-grip.column")
await page.waitForTimeout(150)
const selected = await page.$$eval(".wg-selected-cell", n => n.length)
check("column grip selects the column", selected > 1, `${selected} cells`)

await page.click(".rich-more")
await page.waitForSelector(".rich-note-menu")
const items = await page.$$eval(".rich-note-menu .rich-menu-label", n => n.map(b => b.textContent))
const verbs = "Add row above, Add row below, Add column before, Add column after, Toggle header row, Delete row, Delete column"
check("the ••• menu lists the table actions", items.join(", ").includes(verbs), items.join(", "))
check("no merged cells, as in lush", !items.some(item => /merge|split/i.test(item)), items.join(", "))
await shot("table-menu")

// Delete column, from the menu.
const wideNow = (await shape())[0].length / 2
await page.click(".rich-note-menu .rich-menu-item:has-text('Delete column')")
await page.waitForTimeout(150)
check("the menu deletes the column", (await shape())[0].length / 2 === wideNow - 1, JSON.stringify(await shape()))

// Stored the way lush stores a table: a top-level `table`, rows under it,
// header cells in the first row only, and each cell's text straight after
// its marker.
const stored = await page.evaluate(() => window.richDev.spans())
const blocks = stored.filter(span => span.type === "block").map(span => span.value)
const table = blocks.find(block => block.type === "table")
check("the table is top level", JSON.stringify(table?.parents) === "[]", JSON.stringify(table))
check(
  "rows nest under the table",
  blocks.filter(block => block.type === "table-row").every(block => JSON.stringify(block.parents) === '["table"]'),
)
check(
  "cells nest under the row",
  blocks
    .filter(block => block.type.startsWith("table-") && block.type.endsWith("cell"))
    .every(block => JSON.stringify(block.parents) === '["table","table-row"]'),
)
check("the header is the first row", (await shape())[0].startsWith("th") && !(await shape()).slice(1).some(row => row.includes("th")))
const trip = await page.evaluate(() => window.richDev.roundTrip())
check("the table round trips", trip.live === trip.rebuilt)

// A second line in a cell: cells hold blocks, as they do in lush.
await page.click("wg-content table td >> nth=0")
await page.keyboard.press("End")
await page.keyboard.type("one", { delay: 30 })
await page.keyboard.press("Enter")
await page.keyboard.type("two", { delay: 30 })
await page.waitForTimeout(200)
check(
  "a cell holds two lines",
  await page.$$eval("wg-content table td, wg-content table th", tds => tds.some(td => td.querySelectorAll("p").length === 2)),
  await page.$eval("wg-content table", table => table.innerHTML.slice(0, 300)),
)
const lines = await page.evaluate(() => window.richDev.spans())
check(
  "the cell's second line nests under table-cell",
  lines.some(span => span.type === "block" && JSON.stringify(span.value.parents) === '["table","table-row","table-cell"]'),
)

check("no page errors", errors.length === 0, errors.join(" | "))
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall ok")
await browser.close()
process.exit(problems.length ? 1 : 0)
