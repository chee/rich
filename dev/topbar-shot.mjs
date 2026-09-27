// Screenshots of the top bar and its popovers in both schemes, to look at.
import { chromium } from "playwright"

const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, colorScheme: scheme })
  await page.goto(process.env.RICH_DEV_URL ?? "http://localhost:5173/")
  await page.waitForSelector("wg-content")
  await page.evaluate(scheme => {
    document.documentElement.setAttribute("theme", scheme)
    document.documentElement.style.colorScheme = scheme
    document.body.style.background = scheme === "dark" ? "#1c1c1e" : "#fbfbfa"
    document.documentElement.style.setProperty("--editor-fill", scheme === "dark" ? "#1c1c1e" : "white")
    document.documentElement.style.setProperty("--editor-line", scheme === "dark" ? "#f2f2f7" : "black")
  }, scheme)
  await page.click("wg-content")
  await page.keyboard.type("Groceries", { delay: 10 })
  await page.keyboard.press("Enter")
  for (let i = 0; i < 12; i++) {
    await page.keyboard.type(`A line of the note, number ${i}, long enough to wrap a little further along`, { delay: 0 })
    await page.keyboard.press("Enter")
  }
  await page.evaluate(() => (document.querySelector("wg-scroller").scrollTop = 90))
  await page.waitForTimeout(150)
  await page.click(".rich-aa")
  await page.waitForTimeout(250)
  await page.screenshot({ path: new URL(`./shots/topbar-${scheme}.png`, import.meta.url).pathname, caret: "initial" })
  await page.close()
}
await browser.close()
console.log("wrote dev/shots/topbar-light.png and topbar-dark.png")
