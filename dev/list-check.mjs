// Tab nests a list item, Shift-Tab pulls it out again — and the nesting
// survives the trip through Automerge.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium" })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const problems = []
const errors = []
page.on("pageerror", error => errors.push(String(error)))
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text())
})

function check(name, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!condition) problems.push(name)
}

const type = (text, delay = 30) => page.keyboard.type(text, { delay })
const shape = () =>
  page.$eval("wg-content", node => {
    const walk = element =>
      [...element.children]
        .map(child => {
          const tag = child.tagName.toLowerCase()
          const inner = walk(child)
          const text = child.firstChild?.nodeType === 3 ? child.firstChild.data : ""
          return inner ? `${tag}[${text}${inner}]` : `${tag}[${child.textContent}]`
        })
        .join("")
    return walk(node)
  })

await page.goto(url)
await page.waitForSelector("wg-content")
await page.click("wg-content")
await page.waitForTimeout(300)

await type("title")
await page.keyboard.press("Enter")
await type("- one")
await page.keyboard.press("Enter")
await type("two")
await page.keyboard.press("Tab")
await page.waitForTimeout(150)
check("Tab nests the item", (await shape()) === "p[title]ul[li[p[one]ul[li[p[two]]]]]", await shape())

await type("!")
check("the cursor stays in the nested item", (await shape()).includes("two!"), await shape())

await page.keyboard.press("Enter")
await type("three")
await page.waitForTimeout(150)
check(
  "Enter keeps the new item at the same level",
  (await shape()) === "p[title]ul[li[p[one]ul[li[p[two!]]li[p[three]]]]]",
  await shape(),
)

const trip = await page.evaluate(() => window.richDev.roundTrip())
check("nested list round trips", trip.live === trip.rebuilt)
const nested = JSON.parse(trip.spans).filter(
  span =>
    span.value?.type === "unordered-list-item" &&
    span.value.parents.join() === "unordered-list-item",
)
check("nesting is stored as parents", nested.length === 2, JSON.stringify(nested[0]))

await page.keyboard.press("Shift+Tab")
await page.waitForTimeout(150)
check(
  "Shift-Tab un-nests the last item",
  (await shape()) === "p[title]ul[li[p[one]ul[li[p[two!]]]]li[p[three]]]",
  await shape(),
)

await page.keyboard.press("Shift+Tab")
await page.waitForTimeout(150)
check(
  "Shift-Tab stops at the top level",
  (await shape()) === "p[title]ul[li[p[one]ul[li[p[two!]]]]li[p[three]]]",
  await shape(),
)

await page.click("wg-content > ul > li:nth-child(1) > p")
await page.keyboard.press("Tab")
await page.waitForTimeout(150)
check(
  "Tab does nothing to the first item",
  (await shape()) === "p[title]ul[li[p[one]ul[li[p[two!]]]]li[p[three]]]",
  await shape(),
)

// An item with siblings under it keeps them: they follow it out as its own
// nested list.
const second = await browser.newPage({ viewport: { width: 1100, height: 800 } })
second.on("pageerror", error => errors.push(String(error)))
await second.bringToFront()
await second.goto(url)
await second.waitForSelector("wg-content")
await second.click("wg-content")
await second.waitForTimeout(300)
await second.keyboard.type("- a", { delay: 30 })
await second.keyboard.press("Enter")
await second.keyboard.type("b", { delay: 30 })
await second.keyboard.press("Tab")
await second.keyboard.press("Enter")
await second.keyboard.type("c", { delay: 30 })
await second.keyboard.press("ArrowUp")
await second.keyboard.press("Shift+Tab")
await second.waitForTimeout(200)
const withSiblings = await second.$eval("wg-content", node =>
  node.innerHTML.replace(/<br>/g, "").replace(/\s+/g, ""),
)
check(
  "un-nesting takes the items below along",
  withSiblings === "<ul><li><p>a</p></li><li><p>b</p><ul><li><p>c</p></li></ul></li></ul>",
  withSiblings,
)
const siblingTrip = await second.evaluate(() => window.richDev.roundTrip())
check("that round trips too", siblingTrip.live === siblingTrip.rebuilt)

await page.screenshot({
  path: new URL("./shots/09-nested-list.png", import.meta.url).pathname,
  caret: "initial",
})
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" / "))

await browser.close()
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall good")
process.exit(problems.length ? 1 : 0)
