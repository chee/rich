import { chromium } from "playwright"
const browser = await chromium.launch({ channel: "chromium" })
const page = await browser.newPage()
page.on("pageerror", e => console.log("pageerror:", String(e).split("\n")[0]))
page.on("console", m => m.type() === "error" && console.log("console:", m.text()))
await page.goto("http://localhost:8099/dev/dist-harness/index.html")
console.log("result:", await page.evaluate(() => window.result))
await browser.close()
