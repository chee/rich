// A draft shows its work: text typed after the fork point is marked as added,
// text taken out is shown struck through where it was.
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
await mkdir(new URL("./shots/", import.meta.url), { recursive: true })

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

const type = (text, delay = 20) => page.keyboard.type(text, { delay })
const texts = selector => page.$$eval(selector, nodes => nodes.map(node => node.textContent))
const shot = name =>
  page.screenshot({
    path: new URL(`./shots/${name}.png`, import.meta.url).pathname,
    caret: "initial",
  })

await page.goto(url)
await page.waitForSelector("wg-content")
await page.click("wg-content")
await page.waitForTimeout(200)

// The note as it stands on main.
await type("The kettle is on.")
await page.keyboard.press("Enter")
await type("The cat is asleep.")
await page.waitForTimeout(200)

check("no diff before a draft", (await texts(".rich-diff-added")).length === 0)

// Fork here, then work in the draft.
await page.evaluate(() => window.richDev.draft())
await page.waitForTimeout(200)
check("forking alone marks nothing", (await texts(".rich-diff-added")).length === 0)

await page.keyboard.press("Enter")
await type("The bread is rising.")
await page.waitForTimeout(300)

const added = await texts(".rich-diff-added")
check("added text is marked", added.join("").includes("The bread is rising."), added.join(" | "))
check(
  "untouched text is not marked",
  !added.join("").includes("kettle"),
  added.join(" | "),
)

// Take a word out of a line that was already there.
await page.getByText("The cat is asleep.").click()
await page.keyboard.press("Home")
for (const _ of "The ") await page.keyboard.press("Delete")
await page.waitForTimeout(300)

const deleted = await texts(".rich-diff-deleted")
check("deleted text is shown", deleted.join("").includes("The"), deleted.join(" | "))

// The ghost sits beside the line, not in it: what the note says now is what is
// left when the ghosts are taken out.
const lines = () =>
  page.$$eval("wg-content > *", nodes =>
    nodes.map(node => {
      const copy = node.cloneNode(true)
      copy.querySelectorAll(".rich-diff-deleted").forEach(ghost => ghost.remove())
      return copy.textContent
    }),
  )
check(
  "the line reads without it",
  (await lines()).includes("cat is asleep."),
  (await lines()).join(" | "),
)

await shot("draft-diff")

// Take that line out. The note still has a line where it was — the one the
// draft added — so the two are read against each other, by words rather than
// by the letters they happen to share.
await page.getByText("cat is asleep.").click()
await page.keyboard.press("Home")
await page.keyboard.down("Shift")
await page.keyboard.press("End")
await page.keyboard.up("Shift")
await page.keyboard.press("Backspace")
await page.keyboard.press("Backspace")
await page.waitForTimeout(300)

const swapped = await texts(".rich-diff-deleted")
check("a rewritten line swaps words", swapped.join("").includes("cat"), swapped.join(" | "))
check(
  "it swaps words, not letters",
  swapped.every(text => text.trim().length > 1),
  swapped.join(" | "),
)
check("the line is gone from the note", !(await lines()).includes("cat is asleep."))
await shot("draft-diff-words")

// With nothing left to read it against, a line the draft removed is shown
// whole, where it was.
await page.locator("wg-content > *").last().click()
await page.keyboard.press("End")
// The line, and then the line break that held it.
for (let i = 0; i <= "The bread is rising.".length; i++) {
  await page.keyboard.press("Backspace")
}
await page.waitForTimeout(300)

const gone = await texts(".rich-diff-deleted")
check("a removed line is shown whole", gone.includes("The cat is asleep."), gone.join(" | "))
await shot("draft-diff-line")

// A fork point before the note's first change: all of it is the draft's work.
await page.evaluate(() => window.richDev.draft([]))
await page.waitForTimeout(300)
const all = await texts(".rich-diff-added")
check("a note forked from nothing is all new", all.join("").includes("The kettle is on."), all.join(" | "))

// Back to main: nothing is marked.
await page.evaluate(() => window.richDev.draft(null))
await page.waitForTimeout(300)
check("main shows no diff", (await texts(".rich-diff-added")).length === 0)
check("main shows no ghosts", (await texts(".rich-diff-deleted")).length === 0)

check("no page errors", errors.length === 0, errors.join(" | "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} problem(s): ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
