// An embedded tool is asleep until you click into it: the note scrolls past it,
// and only once it is awake does it take the pointer and the keyboard. Escape,
// or a click anywhere else, gives the note back. Run `pnpm dev:serve` first.
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

const state = () =>
  page.$eval("rich-embed", node => {
    const view = node.shadowRoot.querySelector(".rich-embed-body").firstElementChild
    return {
      asleep: node.shadowRoot.querySelector(".rich-embed-body").classList.contains("asleep"),
      awake: node.shadowRoot.querySelector(".rich-embed-window").classList.contains("awake"),
      inert: view?.inert ?? null,
      hint: node.shadowRoot.querySelector(".rich-embed-state").textContent,
    }
  })

await page.goto(url)
await page.waitForSelector("wg-content")
await page.click("wg-content")

// A note long enough to scroll, with a document embed part way down.
await page.evaluate(async () => {
  const { editor, Embed, Leaf, Paragraph } = window.richDev
  const handle = await window.repo.create2({ "@patchwork": { type: "rich" }, content: "" })
  const lines = Array.from({ length: 40 }, (_, i) =>
    Paragraph.create([Leaf.text(`line ${i}`)]),
  )
  editor.dispatch({
    changes: {
      from: editor.state.doc.contentLength,
      insert: [Embed.of(handle.url), ...lines],
      fit: true,
    },
  })
})
await page.waitForTimeout(600)

const embed = page.locator("rich-embed")
await embed.scrollIntoViewIfNeeded()
await page.waitForTimeout(200)

check("an embedded document starts asleep", (await state()).asleep, JSON.stringify(await state()))
check("the embedded view is inert", (await state()).inert === true)

// The wheel over a sleeping embed belongs to the note.
const box = await embed.boundingBox()
const scroller = () => page.$eval("wg-scroller", node => node.scrollTop)
const before = await scroller()
await page.mouse.move(box.x + box.width / 2, box.y + Math.min(60, box.height / 2))
await page.mouse.wheel(0, 250)
await page.waitForTimeout(300)
const after = await scroller()
check("the note scrolls past it", after > before, `${before} → ${after}`)

// Clicking wakes it.
await page.mouse.click(box.x + box.width / 2, box.y + Math.min(60, box.height / 2))
await page.waitForTimeout(200)
const awake = await state()
check("a click wakes it", awake.awake && !awake.asleep, JSON.stringify(awake))
check("the view takes the pointer", awake.inert === false)
check("it says how to leave", awake.hint === "esc", awake.hint)

// Escape gives the note back.
await page.keyboard.press("Escape")
await page.waitForTimeout(200)
check("escape puts it back to sleep", (await state()).asleep, JSON.stringify(await state()))
check(
  "the note has the keyboard again",
  await page.evaluate(() => document.activeElement?.closest?.("wg-scroller, .rich-page") != null),
)

// So does a click outside it.
await page.mouse.click(box.x + box.width / 2, box.y + Math.min(60, box.height / 2))
await page.waitForTimeout(200)
check("clicking wakes it again", (await state()).awake)
await page.mouse.click(40, 400)
await page.waitForTimeout(200)
check("a click elsewhere puts it back to sleep", (await state()).asleep)

check("no page errors", errors.length === 0, errors.join(" | "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} problem(s): ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
