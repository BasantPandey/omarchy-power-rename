const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const logic = require("./PowerRenameLogic.js")

test("preview matches the rename, clashes are blocked, and undo restores names", function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-"))
  fs.writeFileSync(path.join(dir, "a.txt"), "a")
  fs.writeFileSync(path.join(dir, "b.txt"), "b")
  fs.writeFileSync(path.join(dir, "file-1.dat"), "c")
  fs.writeFileSync(path.join(dir, "my file.txt"), "d")

  const names = fs.readdirSync(dir).sort()
  const view = logic.preview(names, "file-", "item-", true)
  const row = view.rows.find(function (item) { return item.from === "file-1.dat" })
  assert.equal(row.to, "item-1.dat")
  assert.equal(view.blocked, false)
  const moves = logic.planMoves(dir, view)
  assert.equal(moves.ok, true)
  assert.equal(moves.moves.length, 1)
  const step = logic.moveCommand(moves.moves[0].from, moves.moves[0].to)
  assert.ok(step[2].includes("mv -n --"))
  assert.deepEqual(step.slice(-2), [moves.moves[0].from, moves.moves[0].to])
  const applied = logic.applyMoves(moves.moves)
  assert.equal(applied.ok, true)
  assert.equal(fs.existsSync(path.join(dir, "item-1.dat")), true)
  assert.equal(fs.existsSync(path.join(dir, "file-1.dat")), false)
  const undone = logic.applyMoves(logic.undoMoves(moves.moves))
  assert.equal(undone.ok, true)
  assert.equal(fs.readFileSync(path.join(dir, "file-1.dat"), "utf8"), "c")

  const clash = logic.preview(["a.txt", "b.txt"], ".*", "same.txt", true)
  assert.equal(clash.blocked, true)
  assert.match(clash.message, /same new name/)
  const blocked = logic.planMoves(dir, clash)
  assert.equal(blocked.ok, false)
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a")
  assert.equal(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "b")

  const spaced = logic.preview(["my file.txt"], "file", "photo", false)
  assert.equal(spaced.rows[0].to, "my photo.txt")
  const spacedMoves = logic.planMoves(dir, spaced)
  assert.equal(logic.applyMoves(spacedMoves.moves).ok, true)
  assert.equal(fs.existsSync(path.join(dir, "my photo.txt")), true)
})

test("a typed pattern renames a fixture", function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-typed-"))
  fs.writeFileSync(path.join(dir, "shot-1.txt"), "pixel")
  fs.writeFileSync(path.join(dir, "notes.txt"), "keep")
  const list = logic.listCommand(dir)
  const names = logic.namesFromListing(execFileSync(list[0], list.slice(1), { encoding: "utf8" })).sort()
  assert.deepEqual(names, ["notes.txt", "shot-1.txt"])
  const search = "shot-"
  const replace = "pic-"
  const planned = logic.planTyped(names, dir, search, replace, false)
  const row = planned.preview.rows.find(function (item) { return item.from === "shot-1.txt" })
  assert.equal(row.to, "pic-1.txt")
  assert.equal(planned.moves.ok, true)
  assert.equal(planned.moves.moves.length, 1)
  const applied = logic.applyMoves(planned.moves.moves)
  assert.equal(applied.ok, true)
  assert.equal(fs.readFileSync(path.join(dir, "pic-1.txt"), "utf8"), "pixel")
  assert.equal(fs.existsSync(path.join(dir, "shot-1.txt")), false)
  assert.equal(fs.readFileSync(path.join(dir, "notes.txt"), "utf8"), "keep")
  const qml = fs.readFileSync(path.join(__dirname, "PowerRename.qml"), "utf8")
  assert.ok(qml.includes("text: root.search"))
  assert.ok(qml.includes("text: root.replace"))
  assert.ok(qml.includes("root.search = text"))
  assert.ok(qml.includes("root.replace = text"))
  assert.ok(qml.includes("planTyped(root.names, root.folder, root.search, root.replace, root.options)"))
  for (const option of ["matchCase", "wholeWord", "useRegex", "preserveCase"]) {
    assert.ok(qml.includes('root.setOption("' + option + '")'), option)
  }
  for (const label of ["Match case", "Match whole word", "Use regular expression", "Preserve case"]) {
    assert.ok(qml.includes('text: "' + label + '"'), label)
  }
  assert.ok(fs.existsSync(path.join(__dirname, "OptionCheckBox.qml")))
})

test("PowerRename.qml uses mv -n and the preview", function () {
  const qml = fs.readFileSync(path.join(__dirname, "PowerRename.qml"), "utf8")
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"))
  assert.equal(manifest.id, "io.github.basantpandey.power-rename")
  for (const token of ["import \"PowerRenameLogic.js\"", "preview", "moveCommand", "undoMoves", "function open", "function close"]) {
    assert.ok(qml.includes(token), token)
  }
})

test("changedRows keeps only renamed or failed rows", function () {
  const view = logic.preview(["IMG_1.jpg", "notes.txt"], "IMG_", "rome-", false)
  assert.deepEqual(logic.changedRows(view.rows).map(function (row) { return row.to }), ["rome-1.jpg"])
  const bad = logic.preview(["a.txt"], "(", "x", true)
  assert.equal(logic.changedRows(bad.rows).length, 1)
  assert.deepEqual(logic.changedRows(undefined), [])
})

test("the address bar expands ~, trims slashes, and goes up a level", function () {
  assert.equal(logic.normalizeFolder("  ~/Pictures/ ", "/home/me"), "/home/me/Pictures")
  assert.equal(logic.normalizeFolder("~", "/home/me"), "/home/me")
  assert.equal(logic.normalizeFolder("/", "/home/me"), "/")
  assert.equal(logic.normalizeFolder("", "/home/me"), "")
  assert.equal(logic.parentFolder("/home/me/Pictures"), "/home/me")
  assert.equal(logic.parentFolder("/home"), "/")
  assert.equal(logic.parentFolder("/"), "/")
  assert.equal(logic.pickedFolder("/home/me/Trip\n"), "/home/me/Trip")
  assert.equal(logic.pickedFolder(""), "")
  assert.deepEqual(logic.pickCommand().slice(0, 2), ["omarchy-file-select", "--directory"])
})

test("listing a missing folder exits 3", function () {
  const list = logic.listCommand(path.join(os.tmpdir(), "no-such-folder-" + process.pid))
  const result = require("node:child_process").spawnSync(list[0], list.slice(1))
  assert.equal(result.status, 3)
})

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-bug-"))
  for (const name of Object.keys(files)) fs.writeFileSync(path.join(dir, name), files[name])
  return dir
}

function contents(dir) {
  const out = {}
  for (const name of fs.readdirSync(dir).sort()) out[name] = fs.readFileSync(path.join(dir, name), "utf8")
  return out
}

test("bug 1: a chain rename works in any listing order", function () {
  for (const order of [["a.md", "aa.md"], ["aa.md", "a.md"]]) {
    const dir = fixture({ "a.md": "one", "aa.md": "two" })
    const planned = logic.planTyped(order, dir, "a", "aa", false)
    assert.equal(planned.preview.blocked, false)
    const applied = logic.applyMoves(planned.moves.moves)
    assert.equal(applied.ok, true, applied.message)
    assert.deepEqual(contents(dir), { "aa.md": "one", "aaaa.md": "two" })
    assert.equal(logic.applyMoves(logic.undoMoves(applied.done)).ok, true)
    assert.deepEqual(contents(dir), { "a.md": "one", "aa.md": "two" })
  }
})

test("bug 1: two files can swap names", function () {
  const dir = fixture({ "a.txt": "A", "b.txt": "B" })
  // One search and replace cannot swap two names, so build the plan by hand.
  const view = { rows: [{ from: "a.txt", to: "b.txt", error: "" }, { from: "b.txt", to: "a.txt", error: "" }], blocked: false, message: "" }
  const moves = logic.planMoves(dir, view, 7)
  assert.equal(moves.ok, true)
  assert.equal(moves.count, 2)
  assert.equal(logic.applyMoves(moves.moves).ok, true)
  assert.deepEqual(contents(dir), { "a.txt": "B", "b.txt": "A" })
})

test("bug 2: a step fails instead of skipping when the new name appeared after the preview", function () {
  const dir = fixture({ "shot.png": "pixel" })
  const planned = logic.planTyped(["shot.png"], dir, "shot", "pic", false)
  fs.writeFileSync(path.join(dir, "pic.png"), "someone else")
  const applied = logic.applyMoves(planned.moves.moves)
  assert.equal(applied.ok, false)
  assert.match(applied.message, /already exists/)
  assert.deepEqual(contents(dir), { "pic.png": "someone else", "shot.png": "pixel" })
})

test("bug 3: new names that are empty, . or .., or contain / are blocked", function () {
  for (const [search, replace] of [["a.txt", ""], ["a.txt", "."], ["a.txt", ".."], ["a", "../a"], ["a", "sub/a"], ["a", "x\ny"]]) {
    const view = logic.preview(["a.txt"], search, replace, false)
    assert.equal(view.blocked, true, JSON.stringify([search, replace]))
    assert.ok(view.rows[0].error, JSON.stringify([search, replace]))
    assert.equal(logic.planMoves("/d", view).ok, false)
  }
  assert.equal(logic.preview(["a.txt"], "a", "b", false).blocked, false)
})

test("bug 4: undo after a partial failure restores the files already renamed", function () {
  const dir = fixture({ "IMG_1.jpg": "1", "IMG_2.jpg": "2", "IMG_3.jpg": "3" })
  const planned = logic.planTyped(["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"], dir, "IMG_", "rome-", false)
  fs.writeFileSync(path.join(dir, "rome-3.jpg"), "taken")
  const applied = logic.applyMoves(planned.moves.moves)
  assert.equal(applied.ok, false)
  assert.equal(applied.done.length, 2)
  assert.deepEqual(contents(dir), { "IMG_3.jpg": "3", "rome-1.jpg": "1", "rome-2.jpg": "2", "rome-3.jpg": "taken" })
  const undone = logic.applyMoves(logic.undoMoves(applied.done))
  assert.equal(undone.ok, true, undone.message)
  assert.deepEqual(contents(dir), { "IMG_1.jpg": "1", "IMG_2.jpg": "2", "IMG_3.jpg": "3", "rome-3.jpg": "taken" })
})

test("bug 4: a failed undo keeps the moves it did not undo", function () {
  const done = [{ from: "/d/a", to: "/d/b" }, { from: "/d/c", to: "/d/e" }, { from: "/d/f", to: "/d/g" }]
  assert.deepEqual(logic.stillToUndo(done, 0), done)
  assert.deepEqual(logic.stillToUndo(done, 1), done.slice(0, 2))
  assert.deepEqual(logic.stillToUndo(done, 3), [])
})

test("a failed step names the file in the panel message", function () {
  const step = { from: "/d/shot.png", to: "/d/pic.png" }
  assert.equal(logic.stepError(4, step), "pic.png already exists.")
  assert.equal(logic.stepError(5, step), "mv did not move shot.png.")
  assert.equal(logic.stepError(1, step), "mv failed on shot.png.")
  const dir = fixture({ "shot.png": "p", "pic.png": "q" })
  const command = logic.moveCommand(path.join(dir, "shot.png"), path.join(dir, "pic.png"))
  assert.equal(require("node:child_process").spawnSync(command[0], command.slice(1)).status, 4)
})

test("PowerRename.qml keeps only the steps that moved", function () {
  const qml = fs.readFileSync(path.join(__dirname, "PowerRename.qml"), "utf8")
  assert.ok(qml.includes("root.lastMoves = moves.slice(0, index)"))
  assert.ok(qml.includes("PowerRenameLogic.stillToUndo(root.lastMoves, index)"))
  assert.ok(qml.includes("PowerRenameLogic.stepError(code, moves[index])"))
  assert.ok(!qml.includes("root.lastMoves = moves.moves"))
})

test("manifest.json keeps the shell contract", function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, "io.github.basantpandey.power-rename")
  assert.equal(manifest.name, "Power Rename")
  assert.equal(manifest.version, "0.1.1")
  assert.equal(manifest.author, "BasantPandey")
  assert.equal(manifest.description, "Preview a bulk rename, block name clashes, and undo the change.")
  assert.deepEqual(manifest.kinds, ["overlay"])
  assert.equal(manifest.keepLoaded, true)
  assert.deepEqual(manifest.entryPoints, { overlay: "PowerRename.qml" })
})

test("README, LICENSE, demo.gif, and preview.png meet the marketplace limits", function () {
  const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8")
  assert.equal(readme.includes("\u2014"), false)
  assert.equal(/\bsudo\b/i.test(readme), false)
  for (const section of ["## Requirements", "## Install", "## Hotkey", "## Use", "## Remove", "## Known limits", "## What it touches", "## License"]) {
    assert.ok(readme.includes(section), section)
  }
  assert.ok(readme.includes("](demo.gif)"))
  assert.ok(readme.includes("omarchy plugin add https://github.com/BasantPandey/omarchy-power-rename.git --enable"))
  assert.ok(readme.includes('o.bind("SUPER + ALT + R", "Power rename", "omarchy-shell shell toggle io.github.basantpandey.power-rename")'))
  assert.ok(readme.includes("omarchy-shell shell toggle io.github.basantpandey.power-rename '{\"path\":\"/some/folder\"}'"))
  assert.ok(readme.includes("omarchy plugin remove io.github.basantpandey.power-rename"))
  assert.ok(readme.includes("mv -n"))

  const license = fs.readFileSync(path.join(__dirname, "LICENSE"), "utf8")
  assert.ok(license.startsWith("MIT License"))
  assert.ok(license.includes("Copyright (c) 2026 BasantPandey"))

  const gif = fs.readFileSync(path.join(__dirname, "demo.gif"))
  assert.equal(gif.toString("ascii", 0, 6), "GIF89a")
  assert.ok(gif.length <= 5 * 1024 * 1024)

  const png = fs.readFileSync(path.join(__dirname, "preview.png"))
  assert.ok(png.length <= 50 * 1024 * 1024)
  assert.equal(png.toString("ascii", 1, 4), "PNG")
  assert.equal(png.toString("ascii", 12, 16), "IHDR")
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  assert.ok(width > 0 && height > 0)
  assert.ok(width * height <= 40000000)
})

function renamed(name, search, replace, options) {
  const result = logic.applyOne(name, search, replace, options)
  assert.equal(result.error, "", result.error)
  return result.name
}

test("match case: off matches any case, on matches the exact case", function () {
  assert.equal(renamed("IMG_1.jpg", "img", "pic", {}), "pic_1.jpg")
  assert.equal(renamed("IMG_1.jpg", "img", "pic", { matchCase: true }), "IMG_1.jpg")
  assert.equal(renamed("IMG_1.jpg", "IMG", "pic", { matchCase: true }), "pic_1.jpg")
  assert.equal(renamed("a.A.a", "a", "b", {}), "b.b.b")
})

test("match whole word: _ - . and spaces separate words in a file name", function () {
  assert.equal(renamed("trip_day.jpg", "day", "night", { wholeWord: true }), "trip_night.jpg")
  assert.equal(renamed("today.jpg", "day", "night", { wholeWord: true }), "today.jpg")
  assert.equal(renamed("day-1 day2.txt", "day", "d", { wholeWord: true }), "d-1 day2.txt")
  assert.equal(renamed("cat cat.txt", "cat", "dog", { wholeWord: true }), "dog dog.txt")
  assert.equal(renamed("cat", "cat", "dog", { wholeWord: true }), "dog")
  assert.equal(renamed("café_menu", "caf", "x", { wholeWord: true }), "café_menu")
})

test("use regular expression: groups work, plain text stays literal", function () {
  assert.equal(renamed("IMG_0042.jpg", "IMG_0*(\\d+)", "photo-$1", { useRegex: true }), "photo-42.jpg")
  assert.equal(renamed("a+b.txt", "a+b", "c", {}), "c.txt")
  assert.equal(renamed("q.txt", "q", "$1$&", {}), "$1$&.txt")
  assert.equal(renamed("q.txt", "(q)", "[$1|$&|$$]", { useRegex: true }), "[q|q|$].txt")
  assert.equal(renamed("ab.txt", "(?<first>a)", "<$<first>>", { useRegex: true }), "<a>b.txt")
  assert.equal(logic.applyOne("a.txt", "(", "x", { useRegex: true }).error, "Bad regular expression.")
  assert.equal(renamed("abc", "x*", "-", { useRegex: true }), "-a-b-c-")
})

test("preserve case: the new text follows the case of the matched text", function () {
  const keep = { preserveCase: true }
  assert.equal(renamed("IMG_1.jpg", "img", "photo", keep), "PHOTO_1.jpg")
  assert.equal(renamed("img_1.jpg", "img", "Photo", keep), "photo_1.jpg")
  assert.equal(renamed("Img_1.jpg", "img", "photo", keep), "Photo_1.jpg")
  assert.equal(renamed("iMg_1.jpg", "img", "photo", keep), "photo_1.jpg")
  assert.equal(renamed("IMG img Img.txt", "img", "pic", keep), "PIC pic Pic.txt")
  assert.equal(renamed("123.txt", "123", "abc", keep), "abc.txt")
})

test("options combine", function () {
  const all = { matchCase: false, wholeWord: true, useRegex: true, preserveCase: true }
  assert.equal(renamed("Day_1 DAY_2 today.txt", "day", "night", all), "Night_1 NIGHT_2 today.txt")
  assert.equal(renamed("Day_1 day_2", "day", "night", { matchCase: true, wholeWord: true }), "Day_1 night_2")
})

test("the old boolean argument still means regex with exact case", function () {
  assert.equal(renamed("IMG_1.jpg", "img", "x", false), "IMG_1.jpg")
  assert.equal(renamed("file-1", "file-", "item-", true), "item-1")
  const view = logic.preview(["IMG_1.jpg", "img_2.jpg"], "img", "pic", { preserveCase: true })
  assert.deepEqual(view.rows.map(function (row) { return row.to }), ["PIC_1.jpg", "pic_2.jpg"])
})
