// Embedded media: a picture, a video or a sound renders as itself, without the
// window chrome an embedded document gets. Run `pnpm dev:serve` first.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium" })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const problems = []
page.on("pageerror", error => problems.push(String(error)))

function check(name, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!condition) problems.push(name)
}

await page.goto(url)
await page.waitForSelector("wg-content")

// A file document per kind, embedded in the note. The bytes don't have to
// decode: the question is which element the embed builds.
const kinds = await page.evaluate(async () => {
  const { editor, Embed } = window.richDev
  const files = [
    { mimeType: "image/png", extension: "png", name: "picture" },
    { mimeType: "video/mp4", extension: "mp4", name: "movie" },
    { mimeType: "audio/mpeg", extension: "mp3", name: "sound" },
    { mimeType: "application/json", extension: "json", name: "data" },
  ]
  const urls = []
  for (const file of files) {
    const handle = await window.repo.create2({
      "@patchwork": { type: "file" },
      content: new Uint8Array([0, 1, 2, 3]),
      ...file,
    })
    urls.push(handle.url)
  }
  editor.dispatch({
    changes: {
      from: editor.state.doc.contentLength,
      insert: urls.map(url => Embed.of(url)),
      fit: true,
    },
  })
  return urls
})

await page.waitForTimeout(500)

const embeds = await page.$$eval("rich-embed", nodes =>
  nodes.map(node => ({
    media: node.shadowRoot.querySelector(".rich-embed-window").className,
    body: node.shadowRoot.querySelector(".rich-embed-body")?.firstElementChild?.tagName,
    bar: getComputedStyle(node.shadowRoot.querySelector(".rich-embed-bar")).display,
  })),
)

check("four embeds", embeds.length === 4, JSON.stringify(embeds))
check("image renders as an image", embeds[0]?.body === "IMG", embeds[0]?.body)
check("video renders as a video", embeds[1]?.body === "VIDEO", embeds[1]?.body)
check("audio renders as an audio", embeds[2]?.body === "AUDIO", embeds[2]?.body)
check("a document still gets a view", embeds[3]?.body === "PATCHWORK-VIEW", embeds[3]?.body)
check(
  "media has no window chrome",
  embeds.slice(0, 3).every(embed => embed.bar === "none"),
  embeds.map(embed => embed.bar).join(", "),
)
check("a document keeps its window", embeds[3]?.bar !== "none", embeds[3]?.bar)

await page.screenshot({
  path: new URL("./shots/media-embeds.png", import.meta.url).pathname,
  caret: "initial",
})

await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
