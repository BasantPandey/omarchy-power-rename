# Power Rename

Rename many files in a folder at once. Type the text to find and the text to put in its place.
The panel shows each old name next to its new name before anything changes.
If two files would get the same new name, or a new name is not a plain file name, the plugin blocks the rename.
Undo puts the old names back.

`rename` on this system only replaces a substring. It has no preview and no undo.
This plugin adds both.

![Power Rename running in Omarchy: a folder is typed in the Folder bar, IMG_000 is replaced with rome-day, the files are renamed, and Undo puts the old names back](demo.gif)

## Requirements

- Omarchy Quattro (the Quickshell-based shell) on Hyprland.
- `bash`, `find` and `mv` from GNU coreutils and findutils, which every Omarchy install has.
- `omarchy-file-select`, which ships with Omarchy, for the **Browse…** button. Typing a path works without it.
- It needs no administrator rights, no network access, no extra packages, and no build step.

## Install

```bash
omarchy plugin add https://github.com/BasantPandey/omarchy-power-rename.git --enable
```

The plugin stays loaded in the background. After `omarchy plugin update io.github.basantpandey.power-rename`, run `omarchy-restart-shell` to load the new version.

## Hotkey

Add this line to `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + ALT + R", "Power rename", "omarchy-shell shell toggle io.github.basantpandey.power-rename")
```

Some Omarchy builds reject `{ panel = id }` in `o.bind`. Use the plain command above.

## Open for a folder

```bash
omarchy-shell shell toggle io.github.basantpandey.power-rename '{"path":"/some/folder"}'
```

The path is optional. Without it, the panel opens with the Folder field ready to type in.

## Use

1. Pick the folder:
   - Type a full path in the **Folder** field and press Enter. It must start with `/` or `~` (your home folder).
   - Or click **Browse…** to pick a folder with the desktop folder chooser. The panel hides while the chooser is open.
   - Click **↑** to go to the parent folder.
2. Type the text to find in **Search**. The preview lists only the files whose names change.
3. Type the new text in **Replace with**. Leave it empty to remove the found text.
4. Tick the search options you need. They work like the find bar in a code editor, and you can combine them:

   | Option | Shortcut | What it does |
   |---|---|---|
   | **Match case** | Alt+C | Off: `img` also finds `IMG` and `Img`. On: only the exact case. |
   | **Match whole word** | Alt+W | Finds the text only as a whole word. In a file name, `_`, `-`, `.` and spaces separate words, so `day` matches `trip_day.jpg` but not `today.jpg`. |
   | **Use regular expression** | Alt+R | Search is a JavaScript regular expression. In Replace, `$1` inserts the first group, `$&` the whole match, and `$$` a `$`. |
   | **Preserve case** | Alt+P | The new text follows the case of the found text. `IMG` becomes `PHOTO`, `Img` becomes `Photo`, and `img` becomes `photo`. |

   All four start off each time the panel opens. Without **Use regular expression**, Search and Replace are plain text, so `$` and `.` have no special meaning.
5. Click **Rename** (it shows how many files will change), or press Enter in the Replace field.
6. Click **Undo** to put the old names back. Undo covers the last rename in the current folder.

Keys: Tab moves between fields and options, Space ticks the option in focus, Enter in Search moves to Replace, Esc closes the panel. Clicking outside the panel also closes it.

## Remove

```bash
omarchy plugin remove io.github.basantpandey.power-rename
```

Then delete the hotkey line, if you added one.

## Known limits

- It renames only the files directly in the folder, not in subfolders. Hidden files (names that start with `.`) are listed too.
- A new name cannot be empty, `.` or `..`, or contain `/` or a line break. The preview shows such rows in red and blocks the rename.
- If a file takes one of the new names after the preview (another program creates it), the rename stops at that file and says which name is taken. Undo puts back the files that already moved.
- File names that already contain a line break are not listed correctly.
- The Search and Replace text stays when you change folders, and clears when the panel opens again.

## What it touches

- It only renames files in the folder you choose. It does not edit, copy or delete file contents.
- It lists the folder by changing into it (`cd -- <folder>`) and running `find . -mindepth 1 -maxdepth 1`, so a folder name is never read as a `find` option.
- Each rename step runs `mv -n -- <old> <new>`, and first checks that the new name is free. It never overwrites a file. GNU `mv -n` reports success even when it skips a file, so the step also checks that the old name is gone and stops if it is not.
- When a new name is another file's current name (for example `a.md` to `aa.md` while `aa.md` becomes `aaaa.md`, or two files swapping names), each file first moves to a temporary hidden name `.power-rename-<time>-<n>` in the same folder, then to its new name.
- **Browse…** runs `omarchy-file-select --directory`, which asks the desktop portal for its folder chooser.
- Undo is kept in memory only. Closing the panel or restarting the shell forgets it.
- It writes no settings files and does not edit your Hyprland config. You add the hotkey line yourself.

## License

MIT. See `LICENSE`.
