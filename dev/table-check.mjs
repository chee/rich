import { chromium } from "playwright"

const browser = await chromium.launch({ channel: "chromium" })
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

await page.goto("http://localhost:5173/")
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

// The + past the last column grows the table sideways.
const widthBefore = (await shape())[0].length / 2
await page.click(".rich-table-plus.column")
await page.waitForTimeout(100)
const widened = await shape()
check("+ adds a column", widened[0].length / 2 === widthBefore + 1, JSON.stringify(widened))

// The + past the last row grows it downwards.
const rowsBefore = widened.length
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(150)
await page.click(".rich-table-plus.row")
await page.waitForTimeout(100)
check("+ adds a row", (await shape()).length === rowsBefore + 1, JSON.stringify(await shape()))
await shot("table-grown")

// A column grip selects the column and the format bar swaps to table verbs.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(150)
await page.click(".rich-table-grip.column")
await page.waitForTimeout(150)
const selected = await page.$$eval(".wg-selected-cell", n => n.length)
check("column grip selects the column", selected > 1, `${selected} cells`)
const labels = await page.$$eval(".rich-format-bar .rich-format-button:not(.hidden)", n =>
  n.map(b => b.textContent),
)
check("format bar shows the table verbs", labels.includes("Merge"), labels.join(" "))
check("format bar hides the character verbs", !labels.includes("B"), labels.join(" "))
await shot("table-column-selected")

// Delete column, from the bar.
const wideNow = (await shape())[0].length / 2
await page.click(".rich-format-bar .rich-format-button[title='Delete column']")
await page.waitForTimeout(100)
check("bar deletes the column", (await shape())[0].length / 2 === wideNow - 1, JSON.stringify(await shape()))

// The block menu's table section.
await page.mouse.move(box.x + 20, box.y + 10)
await page.waitForTimeout(150)
await page.click(".rich-gutter-grip")
await page.waitForSelector(".rich-block-menu")
const items = await page.$$eval(".rich-block-menu-item", n => n.map(b => b.textContent))
check("block menu has a table section", items.includes("Add row"), items.join(", "))
await shot("table-block-menu")
const rowsNow = (await shape()).length
await page.click(".rich-block-menu-item:has-text('Add row')")
await page.waitForTimeout(100)
check("block menu adds a row", (await shape()).length === rowsNow + 1, JSON.stringify(await shape()))

check("no page errors", errors.length === 0, errors.join(" | "))
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall ok")
await browser.close()
process.exit(problems.length ? 1 : 0)
