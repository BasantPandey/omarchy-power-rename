// Pure bulk rename preview.
// This file does not call Qt or Quickshell.
// Renames use mv -n on the paths the caller passes, one step at a time.

// Options match the find bar in most editors: matchCase, wholeWord, useRegex,
// preserveCase. The old boolean argument means { useRegex: it, matchCase: true }.
function searchOptions(options) {
  if (options === true || options === false || options == null) {
    return { matchCase: true, wholeWord: false, useRegex: options === true, preserveCase: false }
  }
  return {
    matchCase: options.matchCase === true,
    wholeWord: options.wholeWord === true,
    useRegex: options.useRegex === true,
    preserveCase: options.preserveCase === true
  }
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Letters and digits make up a word. _ - . and spaces separate words in a file name.
function isWordChar(ch) {
  if (!ch) return false
  if (/[A-Za-z0-9]/.test(ch)) return true
  return ch > "\u007f" && ch.toLowerCase() !== ch.toUpperCase()
}

// Expands $$, $&, $`, $', $1..$99 and $<name> the way String.replace does.
function expandTemplate(template, match, source) {
  var out = ""
  for (var i = 0; i < template.length; i++) {
    var ch = template.charAt(i)
    if (ch !== "$" || i + 1 >= template.length) { out += ch; continue }
    var next = template.charAt(i + 1)
    if (next === "$") { out += "$"; i++; continue }
    if (next === "&") { out += match[0]; i++; continue }
    if (next === "`") { out += source.slice(0, match.index); i++; continue }
    if (next === "'") { out += source.slice(match.index + match[0].length); i++; continue }
    if (next === "<" && match.groups) {
      var close = template.indexOf(">", i + 2)
      if (close !== -1) {
        var value = match.groups[template.slice(i + 2, close)]
        out += value == null ? "" : value
        i = close
        continue
      }
    }
    if (next >= "0" && next <= "9") {
      var two = template.slice(i + 1, i + 3)
      if (/^\d\d$/.test(two) && Number(two) > 0 && Number(two) < match.length) {
        out += match[Number(two)] == null ? "" : match[Number(two)]
        i += 2
        continue
      }
      if (Number(next) > 0 && Number(next) < match.length) {
        out += match[Number(next)] == null ? "" : match[Number(next)]
        i++
        continue
      }
    }
    out += ch
  }
  return out
}

// ALL CAPS, all lower, or a capital first letter in the match carries over to the new text.
function matchCaseOf(found, text) {
  if (!text || found.toUpperCase() === found.toLowerCase()) return text
  if (found === found.toUpperCase()) return text.toUpperCase()
  if (found === found.toLowerCase()) return text.toLowerCase()
  var first = found.charAt(0)
  var rest = found.slice(1)
  if (first === first.toUpperCase() && rest === rest.toLowerCase()) {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
  }
  return text
}

function applyOne(name, search, replace, options) {
  var source = String(name)
  var from = search == null ? "" : String(search)
  var to = replace == null ? "" : String(replace)
  if (!from) return { name: source, error: "" }
  var opts = searchOptions(options)
  var pattern
  try {
    pattern = new RegExp(opts.useRegex ? from : escapeRegex(from), opts.matchCase ? "g" : "gi")
  } catch (e) {
    return { name: source, error: "Bad regular expression." }
  }
  var out = ""
  var last = 0
  var match
  while ((match = pattern.exec(source)) !== null) {
    var start = match.index
    var end = start + match[0].length
    if (match[0].length === 0) pattern.lastIndex++
    if (opts.wholeWord && (isWordChar(source.charAt(start - 1)) || isWordChar(source.charAt(end)))) continue
    var text = opts.useRegex ? expandTemplate(to, match, source) : to
    if (opts.preserveCase) text = matchCaseOf(match[0], text)
    out += source.slice(last, start) + text
    last = end
  }
  return { name: out + source.slice(last), error: "" }
}

// A new name must stay a plain file name inside the folder.
function nameError(name) {
  if (name === "") return "A new name cannot be empty."
  if (name === "." || name === "..") return "A new name cannot be . or ..."
  if (name.indexOf("/") !== -1) return "A new name cannot contain /."
  if (/[\n\0]/.test(name)) return "A new name cannot contain a line break."
  return ""
}

function preview(names, search, replace, useRegex) {
  var rows = []
  var seen = {}
  var blocked = false
  var message = ""
  var list = names || []
  for (var i = 0; i < list.length; i++) {
    var oldName = String(list[i])
    var next = applyOne(oldName, search, replace, useRegex)
    if (!next.error && next.name !== oldName) next.error = nameError(next.name)
    if (next.error) {
      blocked = true
      message = next.error
    }
    if (seen[next.name]) {
      blocked = true
      message = "Two files get the same new name."
    }
    seen[next.name] = true
    rows.push({ from: oldName, to: next.name, error: next.error })
  }
  return { rows: rows, blocked: blocked, message: message }
}

// When a new name is another file's old name (a.md -> aa.md, aa.md -> aaaa.md,
// or a swap), a direct move would hit a name that is still taken. Those plans
// move every file to a temporary name first, then to its new name.
function planMoves(dir, previewResult, stamp) {
  if (!previewResult || previewResult.blocked) {
    return { ok: false, message: previewResult && previewResult.message ? previewResult.message : "Rename is blocked.", moves: [], count: 0 }
  }
  if (folderError(dir) || !String(dir)) {
    return { ok: false, message: folderError(dir) || "Choose a folder first.", moves: [], count: 0 }
  }
  var base = String(dir).replace(/\/$/, "") + "/"
  var rows = (previewResult.rows || []).filter(function (row) { return row.from !== row.to })
  var sources = {}
  for (var i = 0; i < rows.length; i++) sources[rows[i].from] = true
  var chained = rows.some(function (row) { return sources[row.to] === true })
  var moves = []
  if (!chained) {
    for (var j = 0; j < rows.length; j++) moves.push({ from: base + rows[j].from, to: base + rows[j].to })
    return { ok: true, message: "", moves: moves, count: rows.length }
  }
  var tag = ".power-rename-" + String(stamp == null ? Date.now() : stamp) + "-"
  for (var k = 0; k < rows.length; k++) moves.push({ from: base + rows[k].from, to: base + tag + k })
  for (var m = 0; m < rows.length; m++) moves.push({ from: base + tag + m, to: base + rows[m].to })
  return { ok: true, message: "", moves: moves, count: rows.length }
}

// GNU mv -n exits 0 when it skips a move, so the step checks both names itself.
// Exit 4: the new name is taken. Exit 5: mv left the old name in place.
function moveCommand(from, to) {
  var script = "if [ -e \"$2\" ] || [ -L \"$2\" ]; then echo \"${2##*/} already exists.\" >&2; exit 4; fi; "
    + "mv -n -- \"$1\" \"$2\" || exit $?; "
    + "if [ -e \"$1\" ] || [ -L \"$1\" ]; then echo \"mv did not move ${1##*/}.\" >&2; exit 5; fi"
  return ["bash", "-c", script, "rename-step", String(from), String(to)]
}

function baseName(path) {
  var text = String(path || "")
  return text.slice(text.lastIndexOf("/") + 1)
}

// The panel reads the exit code, not stderr, which can arrive after the exit.
function stepError(code, step) {
  if (code === 4) return baseName(step && step.to) + " already exists."
  if (code === 5) return "mv did not move " + baseName(step && step.from) + "."
  return "mv failed on " + baseName(step && step.from) + "."
}

// After an undo stops at step `undone`, these moves are still not undone.
function stillToUndo(done, undone) {
  var list = done || []
  return list.slice(0, Math.max(0, list.length - undone))
}

function undoMoves(moves) {
  var reversed = []
  var list = moves || []
  for (var i = list.length - 1; i >= 0; i--) {
    reversed.push({ from: list[i].to, to: list[i].from })
  }
  return reversed
}

// Exit 3 means the folder does not exist, so the panel can say so.
// find starts from "." after cd, so a folder name such as "-delete" is never
// read as a find expression.
function listCommand(dir) {
  return ["bash", "-c", "[ -d \"$1\" ] || exit 3; cd -- \"$1\" || exit 3; find . -mindepth 1 -maxdepth 1 -printf '%f\\n'", "list", String(dir)]
}

// A relative path would resolve against the shell's own working directory.
function folderError(dir) {
  var path = String(dir == null ? "" : dir)
  if (path === "" || path.charAt(0) === "/") return ""
  return "Type a full path that starts with / or ~."
}

function normalizeFolder(text, home) {
  var path = String(text == null ? "" : text).trim()
  if (path === "~" || path.indexOf("~/") === 0) path = String(home || "") + path.slice(1)
  while (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1)
  return path
}

function parentFolder(path) {
  var dir = normalizeFolder(path, "")
  if (!dir || dir === "/") return dir
  var cut = dir.lastIndexOf("/")
  if (cut <= 0) return "/"
  return dir.slice(0, cut)
}

function pickCommand() {
  return ["omarchy-file-select", "--directory", "--title", "Choose a folder to rename in"]
}

function pickedFolder(text) {
  return String(text || "").split("\n").filter(function (line) { return line !== "" })[0] || ""
}

function namesFromListing(text) {
  return String(text || "").split("\n").filter(function (line) { return line !== "" }).sort()
}

function changedRows(rows) {
  return (rows || []).filter(function (row) { return row.from !== row.to || row.error })
}

function planTyped(names, dir, search, replace, options) {
  var view = preview(names, search, replace, options)
  var moves = planMoves(dir, view)
  return { preview: view, moves: moves }
}

// Runs the same steps as the panel. `done` is what actually moved, so undo can reverse it.
function applyMoves(moves) {
  var cp = require("child_process")
  var list = moves || []
  for (var j = 0; j < list.length; j++) {
    var command = moveCommand(list[j].from, list[j].to)
    var result = cp.spawnSync(command[0], command.slice(1), { encoding: "utf8" })
    if (result.status !== 0) {
      return { ok: false, message: (result.stderr || "mv failed").trim(), applied: j, done: list.slice(0, j) }
    }
  }
  return { ok: true, message: "", applied: list.length, done: list.slice() }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applyOne: applyOne,
    searchOptions: searchOptions,
    preview: preview,
    nameError: nameError,
    planMoves: planMoves,
    stillToUndo: stillToUndo,
    stepError: stepError,
    moveCommand: moveCommand,
    undoMoves: undoMoves,
    applyMoves: applyMoves,
    listCommand: listCommand,
    normalizeFolder: normalizeFolder,
    folderError: folderError,
    parentFolder: parentFolder,
    pickCommand: pickCommand,
    pickedFolder: pickedFolder,
    namesFromListing: namesFromListing,
    changedRows: changedRows,
    planTyped: planTyped
  }
}
