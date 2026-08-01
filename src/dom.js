export function el(tag, attrs, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue
    else if (name === "class") node.className = value
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value)
    else node.setAttribute(name, value === true ? "" : value)
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child)
  }
  return node
}

export function svg(paths, size = 16) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  node.setAttribute("viewBox", "0 0 16 16")
  node.setAttribute("width", size)
  node.setAttribute("height", size)
  node.setAttribute("fill", "none")
  node.setAttribute("stroke", "currentColor")
  node.setAttribute("stroke-width", "1.5")
  node.setAttribute("stroke-linecap", "round")
  node.setAttribute("stroke-linejoin", "round")
  node.innerHTML = paths
  return node
}
