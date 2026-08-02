// Renders every highlight in both themes, to look at rather than to assert on.
import { chromium } from "playwright"
import { HIGHLIGHTS } from "../src/highlight.js"

const browser = await chromium.launch({ channel: "chromium" })

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({
    viewport: { width: 460, height: 300 },
    colorScheme: theme === "light" ? "dark" : "light",
  })
  await page.goto("http://localhost:5173/")
  await page.waitForSelector("wg-content")
  // The host sets the theme; the opposite OS scheme above is the case that
  // used to win and leave the ink unreadable.
  await page.evaluate(t => document.documentElement.setAttribute("theme", t), theme)
  await page.click("wg-content")
  for (const name of HIGHLIGHTS) {
    await page.keyboard.type(`${name} highlighted text`, { delay: 10 })
    await page.keyboard.press("Home")
    await page.keyboard.down("Shift")
    await page.keyboard.press("End")
    await page.keyboard.up("Shift")
    await page.waitForTimeout(150)
    await page.click(".rich-highlight-dot")
    await page.waitForTimeout(100)
    await page.click(`.rich-highlight-swatch[data-highlight="${name}"]`)
    await page.waitForTimeout(150)
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
  }
  await page.waitForTimeout(200)
  await page.screenshot({
    path: new URL(`./shots/highlights-${theme}.png`, import.meta.url).pathname,
    caret: "initial",
  })
  await page.close()
}

await browser.close()
console.log("wrote dev/shots/highlights-light.png and highlights-dark.png")
