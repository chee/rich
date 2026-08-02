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

// A column grip selects the column and the format bar swaps to table verbs.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(150)
await page.click(".rich-table-grip.column")
await page.waitForTimeout(150)
const selected = await page.$$eval(".wg-selected-cell", n => n.length)
check("column grip selects the column", selected > 1, `${selected} cells`)
// The highlight and table buttons live inside a wrapper, and it is the wrapper
// that gets hidden — so ask whether anything up the tree is hidden.
const visible = () =>
  page.$$eval(".rich-format-bar .rich-format-button", n =>
    n.filter(b => !b.closest(".hidden")).map(b => b.title || b.textContent),
  )
let labels = await visible()
check("the bar offers a table button", labels.includes("Table"), labels.join(" "))
check("the bar hides the character verbs on a cell selection", !labels.includes("Bold"), labels.join(" "))
check(
  "the bar hides the block-type row inside a table",
  await page.$eval(".rich-format-block-control", n => n.classList.contains("hidden")),
)
await shot("table-column-selected")

// The table button drops down the actions.
await page.click(".rich-table-menu-button")
await page.waitForTimeout(150)
const items = await page.$$eval(".rich-table-menu-item", n => n.map(b => b.textContent))
check(
  "the table menu lists the actions",
  items.join(", ") ===
    "Add row above, Add row below, Add column before, Add column after, Toggle header cells, Merge cells, Split cell, Delete row, Delete column",
  items.join(", "),
)
await shot("table-menu")

// Delete column, from the menu.
const wideNow = (await shape())[0].length / 2
await page.click(".rich-table-menu-item:text-is('Delete column')")
await page.waitForTimeout(150)
check("the menu deletes the column", (await shape())[0].length / 2 === wideNow - 1, JSON.stringify(await shape()))

// Selecting text inside a cell keeps the character verbs but not the headings.
// On its own page: a leftover cell selection changes what a click in a cell
// does, and this is about the plain case.
{
  const fresh = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  fresh.on("pageerror", e => errors.push(String(e)))
  await fresh.goto(process.env.RICH_DEV_URL ?? "http://localhost:5173/")
  await fresh.waitForSelector("wg-content")
  await fresh.click("wg-content")
  await fresh.keyboard.type("Notes", { delay: 40 })
  await fresh.keyboard.press("Enter")
  await fresh.keyboard.type("/", { delay: 40 })
  await fresh.waitForSelector(".rich-slash-item")
  await fresh.keyboard.type("table", { delay: 40 })
  await fresh.waitForTimeout(100)
  await fresh.keyboard.press("Enter")
  await fresh.waitForSelector("wg-content table")
  await fresh.keyboard.type("word", { delay: 30 })
  await fresh.keyboard.down("Shift")
  for (let i = 0; i < 4; i++) await fresh.keyboard.press("ArrowLeft")
  await fresh.keyboard.up("Shift")
  await fresh.waitForTimeout(300)
  check(
    "the caret is in a cell",
    await fresh.evaluate(() =>
      Boolean(window.richDev.editor.state.sel.head.matchingParent(p => p.name === "Table")),
    ),
  )
  labels = await fresh.$$eval(".rich-format-bar .rich-format-button", n =>
    n.filter(b => !b.closest(".hidden")).map(b => b.title || b.textContent),
  )
  check("a text selection in a cell keeps bold", labels.includes("Bold"), labels.join(" "))
  check(
    "a text selection in a cell hides the block-type row",
    await fresh.$eval(".rich-format-block-control", n => n.classList.contains("hidden")),
  )
  check("a text selection in a cell keeps the table button", labels.includes("Table"), labels.join(" "))
  await fresh.screenshot({
    path: new URL("./shots/table-text-selected.png", import.meta.url).pathname,
    caret: "initial",
  })
  await fresh.close()
}

// The block menu's table section.
await page.mouse.move(box.x + 20, box.y + 10)
await page.waitForTimeout(150)
await page.click(".rich-gutter-grip")
await page.waitForSelector(".rich-block-menu")
const blockItems = await page.$$eval(".rich-block-menu-item", n => n.map(b => b.textContent))
check("block menu has a table section", blockItems.includes("Add row"), blockItems.join(", "))
await shot("table-block-menu")
const rowsNow = (await shape()).length
await page.click(".rich-block-menu-item:has-text('Add row')")
await page.waitForTimeout(100)
check("block menu adds a row", (await shape()).length === rowsNow + 1, JSON.stringify(await shape()))

check("no page errors", errors.length === 0, errors.join(" | "))
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall ok")
await browser.close()
process.exit(problems.length ? 1 : 0)
