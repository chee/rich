// The format bar has to stay inside the visible editor whichever edge the
// selection is against. Run `pnpm dev:serve` first.
import { chromium } from "playwright"

const browser = await chromium.launch({ channel: "chromium" })
const page = await browser.newPage({ viewport: { width: 620, height: 420 } })
const problems = []
const errors = []
page.on("pageerror", e => errors.push(String(e)))
page.on("console", m => m.type() === "error" && errors.push(m.text()))
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) problems.push(name)
}

await page.goto(process.env.RICH_DEV_URL ?? "http://localhost:5173/")
await page.waitForSelector("wg-content")
await page.click("wg-content")
for (let i = 0; i < 14; i++) {
  await page.keyboard.type(`line ${i} with enough words in it to reach the right margin`)
  await page.keyboard.press("Enter")
}
await page.waitForTimeout(200)

const barBox = async () => {
  await page.waitForTimeout(200)
  return page.evaluate(() => {
    const bar = document.querySelector(".rich-format-bar")
    const { top, left, right, bottom, width, height } = bar.getBoundingClientRect()
    return { top, left, right, bottom, width, height, visible: bar.classList.contains("visible") }
  })
}

// Select a word by double-clicking on the text itself. The block's box runs
// the full content width, so its right edge is usually past the last word and
// clicking there selects nothing.
async function selectAt(index, side) {
  const text = await page.evaluate(i => {
    const node = document.querySelectorAll("wg-content > *")[i - 1].firstChild
    if (!node) return null
    const range = document.createRange()
    range.selectNodeContents(node)
    const { left, right, top, bottom } = range.getBoundingClientRect()
    // The trailing empty paragraph has a child but no laid-out text, so its
    // range measures zero — there is no word there to double-click.
    if (right - left < 1) return null
    return { left, right, top, bottom }
  }, index)
  if (!text) return false
  const x = side === "left" ? text.left + 8 : text.right - 8
  await page.mouse.dblclick(x, (text.top + text.bottom) / 2)
  await page.waitForTimeout(150)
  return true
}

const inside = bar =>
  bar.left >= 0 && bar.top >= 0 && bar.right <= 620 && bar.bottom <= 420

const scrollTop = to => page.evaluate(y => document.querySelector("wg-scroller").scrollTo(0, y), to)

// The topmost and bottommost lines currently on screen.
const visibleLines = () =>
  page.$$eval("wg-content > *", nodes =>
    nodes
      .map((n, i) => ({ index: i + 1, box: n.getBoundingClientRect() }))
      .filter(l => l.box.top >= 0 && l.box.bottom <= window.innerHeight)
      .map(l => l.index),
  )

for (const scroll of [0, 220]) {
  await scrollTop(scroll)
  await page.waitForTimeout(150)
  const lines = await visibleLines()
  for (const [where, index] of [
    ["top", lines[0]],
    ["bottom", lines.at(-1)],
  ]) {
    for (const side of ["left", "right"]) {
      if (!(await selectAt(index, side))) continue
      const bar = await barBox()
      check(
        `${where}-${side} at scroll ${scroll} keeps the bar on screen`,
        bar.visible && inside(bar),
        JSON.stringify(bar),
      )
      await page.screenshot({
        path: new URL(`./shots/bar-${scroll}-${where}-${side}.png`, import.meta.url).pathname,
        caret: "initial",
      })
    }
  }
}

// A line hard against the top has no room above it, so the bar has to flip
// below rather than clamp on top of the text it belongs to.
const atTop = async () => {
  for (let scroll = 200; scroll < 320; scroll += 4) {
    await scrollTop(scroll)
    const found = await page.$$eval("wg-content > *", nodes =>
      nodes.findIndex(n => {
        const box = n.getBoundingClientRect()
        return box.top >= 0 && box.top < 6
      }),
    )
    if (found >= 0) return found + 1
  }
  return null
}
const flush = await atTop()
check("found a line against the top edge", flush != null)
if (flush != null) {
  await selectAt(flush, "left")
  const bar = await barBox()
  const line = await page.locator(`wg-content > :nth-child(${flush})`).boundingBox()
  check("no room above: the bar flips below", bar.top > line.y, `bar ${bar.top} vs line ${line.y}`)
  check("flipped bar is still on screen", inside(bar), JSON.stringify(bar))
  await page.screenshot({ path: new URL(`./shots/bar-flip.png`, import.meta.url).pathname, caret: "initial" })
}

check("no page errors", errors.length === 0, errors.join(" | "))
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall ok")
await browser.close()
process.exit(problems.length ? 1 : 0)
