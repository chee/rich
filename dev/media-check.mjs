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

// A picture is its own size against the page, up to the column width — no
// letterboxing, no fill showing around it.
const picture = await page.evaluate(async () => {
  const canvas = document.createElement("canvas")
  canvas.width = 300
  canvas.height = 180
  canvas.getContext("2d").fillRect(0, 0, 300, 180)
  const blob = await new Promise(done => canvas.toBlob(done, "image/png"))
  const handle = await window.repo.create2({
    "@patchwork": { type: "file" },
    content: new Uint8Array(await blob.arrayBuffer()),
    mimeType: "image/png",
    extension: "png",
    name: "picture",
  })
  const { editor, Embed } = window.richDev
  editor.dispatch({
    changes: { from: editor.state.doc.contentLength, insert: [Embed.of(handle.url)], fit: true },
  })
  await new Promise(done => setTimeout(done, 500))
  const embed = [...document.querySelectorAll("rich-embed")].at(-1)
  const image = embed.shadowRoot.querySelector("img")
  const window_ = embed.shadowRoot.querySelector(".rich-embed-window")
  return {
    image: image.getBoundingClientRect(),
    box: window_.getBoundingClientRect(),
    fill: getComputedStyle(image).backgroundColor,
    text: document.querySelector("wg-content > p").getBoundingClientRect(),
  }
})

check("the picture keeps its own size", Math.round(picture.image.width) === 300, picture.image.width)
check(
  "the box is the picture",
  Math.round(picture.box.width) === 300 && Math.round(picture.box.height) === 180,
  `${picture.box.width} x ${picture.box.height}`,
)
check(
  "the picture sits at the left margin",
  Math.round(picture.box.x) === Math.round(picture.text.x),
  `${picture.box.x} / ${picture.text.x}`,
)
check("nothing shows behind it", picture.fill === "rgba(0, 0, 0, 0)", picture.fill)

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
