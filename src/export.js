// Export: the note as Markdown or as an HTML page, for the ••• menu (lush's
// Share As and Export as HTML…). Both read the spans automerge holds, so what
// is exported is what every peer has, not what one editor happens to show.
import * as am from "@automerge/automerge"
import { titleFromSpans } from "./datatype.js"

const str = value => (value == null ? "" : am.isImmutableString?.(value) ? value.val : String(value?.val ?? value))

const LIST_TYPES = ["unordered-list-item", "ordered-list-item", "todo-list-item"]

// The spans as lines: one per block marker, each with its block and its text
// runs. Table and column contents are flattened into lines of their own.
function linesOf(spans) {
  const lines = []
  let line = null
  for (const span of spans) {
    if (span.type === "block") {
      line = { block: span.value, runs: [] }
      lines.push(line)
    } else if (span.type === "text") {
      if (!line) {
        line = { block: { type: "paragraph", parents: [], attrs: {} }, runs: [] }
        lines.push(line)
      }
      line.runs.push({ text: span.value, marks: span.marks ?? {} })
    }
  }
  return lines
}

const escapeMarkdown = text => text.replace(/([\\`*_[\]#<>|])/g, "\\$1")

function markdownRuns(runs, { code = false } = {}) {
  return runs
    .map(({ text, marks }) => {
      let out = code ? text : escapeMarkdown(text).replace(/\u2028/g, "  \n")
      if (code) return out
      if (marks.code) out = "`" + text + "`"
      if (marks.strong) out = `**${out}**`
      if (marks.em) out = `_${out}_`
      if (marks.strikethrough) out = `~~${out}~~`
      if (marks.superscript) out = `<sup>${out}</sup>`
      if (marks.subscript) out = `<sub>${out}</sub>`
      if (marks.highlight) out = `==${out}==`
      if (marks.link) out = `[${out}](${str(marks.link)})`
      return out
    })
    .join("")
}

export function toMarkdown(spans) {
  const lines = linesOf(spans)
  const out = []
  let code = null
  let table = null
  const endCode = () => {
    if (code) out.push("```", "")
    code = null
  }
  const endTable = () => {
    if (!table) return
    const rows = table.filter(row => row.length)
    if (rows.length) {
      const width = Math.max(...rows.map(row => row.length))
      const pad = row => [...row, ...Array(width - row.length).fill("")]
      out.push(`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`)
      for (const row of rows.slice(1)) out.push(`| ${pad(row).join(" | ")} |`)
      out.push("")
    }
    table = null
  }
  let previous = null
  for (const { block, runs } of lines) {
    const type = str(block.type)
    const parents = (block.parents ?? []).map(str)
    const attrs = block.attrs ?? {}
    if (type !== "code-block") endCode()
    if (parents[0] !== "table" && type !== "table") endTable()
    if (type === "table") {
      table = []
      continue
    }
    if (type === "table-row") {
      table?.push([])
      continue
    }
    if (type === "table-cell" || type === "table-header-cell") {
      table?.[table.length - 1]?.push(markdownRuns(runs).replace(/\|/g, "\\|"))
      continue
    }
    if (table && parents[0] === "table") {
      const row = table[table.length - 1]
      if (row?.length) row[row.length - 1] += " " + markdownRuns(runs)
      continue
    }
    if (type === "columns" || type === "column") continue
    const listDepth = parents.filter(parent => LIST_TYPES.includes(parent)).length
    const quoteDepth = parents.filter(parent => parent === "blockquote").length + (type === "blockquote" ? 1 : 0)
    const quote = "> ".repeat(quoteDepth)
    const text = markdownRuns(runs)
    const indent = "  ".repeat(listDepth)
    // a blank line between blocks that aren't lines of one list or quote
    const joined = previous && ((LIST_TYPES.includes(previous) && LIST_TYPES.includes(type)) || (quoteDepth && previous === "quote"))
    if (!joined && out.length && out[out.length - 1] !== "") out.push("")
    previous = LIST_TYPES.includes(type) ? type : quoteDepth ? "quote" : type
    if (type === "heading") out.push(`${"#".repeat(Math.min(Number(attrs.level) || 1, 6))} ${text}`)
    else if (type === "code-block") {
      if (!code) out.push("```" + str(attrs.language))
      code = true
      out.push(markdownRuns(runs, { code: true }))
      continue
    } else if (type === "unordered-list-item") out.push(`${quote}${indent}- ${text}`)
    else if (type === "ordered-list-item") out.push(`${quote}${indent}1. ${text}`)
    else if (type === "todo-list-item") {
      const state = attrs.checked === true ? "x" : str(attrs.state) === "canceled" ? "-" : str(attrs.state) === "pending" ? "/" : " "
      out.push(`${quote}${indent}- [${state}] ${text}`)
    } else if (type === "embed" || type === "image") out.push(`[${str(attrs.alt) || "Attachment"}](${str(attrs.url ?? attrs.src)})`)
    else if (type === "html") out.push(str(attrs.html))
    else if (type === "context") {
      const facts = [attrs.ts ?? attrs.created, attrs.location, attrs.weather].map(str).filter(Boolean)
      out.push(`_${facts.join(" · ")}_`)
    } else out.push(`${quote}${text}`)
  }
  endCode()
  endTable()
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
}

const escapeHtml = text =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// The light pair of each highlight, as lush exports them.
const HIGHLIGHT = {
  pink: ["rgb(255 77 151 / 0.16)", "#8d1a4c"],
  yellow: ["rgb(255 204 51 / 0.16)", "#6b4600"],
  sky: ["rgb(59 166 255 / 0.16)", "#084881"],
  sea: ["rgb(79 70 229 / 0.16)", "#312e81"],
  mint: ["rgb(79 223 156 / 0.16)", "#0d5c3a"],
}

function htmlRuns(runs) {
  return runs
    .map(({ text, marks }) => {
      let out = escapeHtml(text).replace(/\u2028/g, "<br>")
      if (marks.code) out = `<code>${out}</code>`
      if (marks.strong) out = `<strong>${out}</strong>`
      if (marks.em) out = `<em>${out}</em>`
      if (marks.underline) out = `<u>${out}</u>`
      if (marks.strikethrough) out = `<s>${out}</s>`
      if (marks.superscript) out = `<sup>${out}</sup>`
      if (marks.subscript) out = `<sub>${out}</sub>`
      if (marks.font) out = `<span class="font-${escapeHtml(str(marks.font))}">${out}</span>`
      const highlight = HIGHLIGHT[str(marks.highlight)]
      if (highlight) out = `<mark style="background:${highlight[0]};color:${highlight[1]}">${out}</mark>`
      if (marks.link) out = `<a href="${escapeHtml(str(marks.link))}">${out}</a>`
      return out
    })
    .join("")
}

export function toHtml(spans, title = titleFromSpans(spans)) {
  const body = []
  // open list and quote elements, innermost last
  const open = []
  const close = until => {
    while (open.length > until) body.push(`</${open.pop()}>`)
  }
  let code = null
  for (const { block, runs } of linesOf(spans)) {
    const type = str(block.type)
    const parents = (block.parents ?? []).map(str)
    const attrs = block.attrs ?? {}
    if (code && type !== "code-block") {
      body.push(`<pre><code>${code.join("\n")}</code></pre>`)
      code = null
    }
    if (type === "code-block") {
      close(0)
      ;(code ??= []).push(escapeHtml(runs.map(run => run.text).join("")))
      continue
    }
    const wanted = []
    for (const parent of parents) {
      if (parent === "blockquote") wanted.push("blockquote")
      else if (parent === "unordered-list-item" || parent === "todo-list-item") wanted.push("ul")
      else if (parent === "ordered-list-item") wanted.push("ol")
    }
    if (type === "blockquote") wanted.push("blockquote")
    else if (type === "unordered-list-item" || type === "todo-list-item") wanted.push("ul")
    else if (type === "ordered-list-item") wanted.push("ol")
    let same = 0
    while (same < open.length && same < wanted.length && open[same] === wanted[same]) same++
    close(same)
    for (const tag of wanted.slice(same)) {
      body.push(`<${tag}>`)
      open.push(tag)
    }
    const text = htmlRuns(runs)
    if (type === "heading") {
      const level = Math.min(Number(attrs.level) || 1, 6)
      body.push(`<h${level}>${text}</h${level}>`)
    } else if (type === "unordered-list-item" || type === "ordered-list-item") body.push(`<li>${text}</li>`)
    else if (type === "todo-list-item") {
      const state = attrs.checked === true ? "checked" : str(attrs.state) || "open"
      body.push(`<li class="todo ${state}"><input type="checkbox" disabled${state === "checked" ? " checked" : ""}> ${text}</li>`)
    } else if (type === "embed" || type === "image") {
      const url = escapeHtml(str(attrs.url ?? attrs.src))
      body.push(`<p><a href="${url}">${escapeHtml(str(attrs.alt) || "Attachment")}</a></p>`)
    } else if (type === "html") body.push(str(attrs.html))
    else if (["table", "table-row", "columns", "column", "context", "calendar-event"].includes(type)) {
      if (type === "context") {
        const facts = [attrs.ts ?? attrs.created, attrs.location, attrs.weather].map(str).filter(Boolean)
        body.push(`<p class="logline">${escapeHtml(facts.join(" · "))}</p>`)
      }
    } else body.push(`<p>${text || "<br>"}</p>`)
  }
  if (code) body.push(`<pre><code>${code.join("\n")}</code></pre>`)
  close(0)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || "Note")}</title>
<style>
body { max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; font: 16px/1.445 Jost, system-ui, sans-serif; color: #1d1d1f; }
h1, h2, h3 { margin: 10px 0 6px; line-height: 1.445; }
h1 { font-size: 1.6em; } h2 { font-size: 1.3em; } h3 { font-size: 1.15em; }
p { margin: 0; }
a { color: #ff69a5; }
blockquote { margin: 2px 0; padding: 2px 8px 2px 18px; border-left: 3.5px solid rgb(255 77 151 / 0.9); border-radius: 6px; background: rgb(255 240 214 / 0.36); }
pre { margin: 4px 0; padding: 4px 12px; background: #f9fcff; border: 1px solid #e3f6ff; border-radius: 8px; font: 0.92em/1.35 "Fantasque Sans Mono", ui-monospace, monospace; }
code { font-family: "Fantasque Sans Mono", ui-monospace, monospace; }
ul, ol { margin: 0; padding-left: 28px; }
li.todo { list-style: none; }
mark { border-radius: 3px; padding: 0 0.15em; }
.font-serif { font-family: Merriweather, Georgia, serif; }
.font-hand { font-family: Caroni, cursive; }
.logline { color: #8a8a8e; font-size: 0.9em; }
</style>
</head>
<body>
${body.join("\n")}
</body>
</html>
`
}

const safeName = title => (title || "Note").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)

export function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportNote(handle, format) {
  const doc = handle.doc()
  const spans = am.spans(doc, ["content"])
  const title = titleFromSpans(spans)
  if (format === "markdown") download(`${safeName(title)}.md`, "text/markdown", toMarkdown(spans))
  else download(`${safeName(title)}.html`, "text/html", toHtml(spans, title))
}
