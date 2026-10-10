import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "PowerRenameLogic.js" as PowerRenameLogic

Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property string folder: ""
  property string search: ""
  property string replace: ""
  property bool matchCase: false
  property bool wholeWord: false
  property bool useRegex: false
  property bool preserveCase: false
  readonly property var options: ({ matchCase: root.matchCase, wholeWord: root.wholeWord, useRegex: root.useRegex, preserveCase: root.preserveCase })
  property var names: []
  property var plan: ({ rows: [], blocked: false, message: "" })
  property var lastMoves: []
  property string notice: ""
  property bool busy: false
  property bool picking: false
  property bool folderMissing: false
  readonly property string home: Quickshell.env("HOME")

  readonly property var changes: PowerRenameLogic.changedRows(root.plan.rows)
  readonly property bool canRename: !root.busy && !root.plan.blocked && root.changes.length > 0
  readonly property bool canUndo: !root.busy && root.lastMoves.length > 0
  readonly property string statusText: root.plan.message || root.notice

  // Shares the [menu] surface tokens, like the built-in emoji picker.
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color muted: Color.muted
  property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
  property int contentMargin: Style.spacing.panelPadding
  property int cardWidth: Math.min(Style.space(560), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(660), panel.height - Style.gapsOut * 2)

  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(payloadJson || "{}") || {} } catch (e) {}
    root.search = ""
    root.replace = ""
    root.matchCase = false
    root.wholeWord = false
    root.useRegex = false
    root.preserveCase = false
    root.opened = true
    root.loadFolder(payload.path ? String(payload.path) : "")
    Qt.callLater(function () { (root.folder ? searchField : folderField).forceActiveFocus() })
  }

  // Load a folder typed in the address bar, picked with Browse, or reached with Up.
  function loadFolder(path) {
    root.folder = PowerRenameLogic.normalizeFolder(path, root.home)
    folderField.text = root.folder
    root.names = []
    root.lastMoves = []
    root.notice = ""
    root.folderMissing = false
    root.refreshPlan()
    if (!root.folder) return
    var folderProblem = PowerRenameLogic.folderError(root.folder)
    if (folderProblem) {
      root.notice = folderProblem
      return
    }
    listProc.running = false
    listProc.command = PowerRenameLogic.listCommand(root.folder)
    listProc.running = true
  }

  function browse() {
    if (root.busy || pickProc.running) return
    root.picking = true
    pickProc.running = true
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "io.github.basantpandey.power-rename")
  }

  function refreshPlan() {
    var planned = PowerRenameLogic.planTyped(root.names, root.folder, root.search, root.replace, root.options)
    root.plan = planned.preview
    return planned
  }

  function setOption(name) {
    root[name] = !root[name]
    root.edited()
  }

  function edited() {
    root.notice = ""
    root.refreshPlan()
  }

  function renameFiles() {
    if (!root.canRename) return
    var planned = root.refreshPlan()
    var moves = planned.moves
    if (!moves.ok) {
      root.notice = moves.message
      return
    }
    moveProc.fileCount = moves.count
    root.runMoves(moves.moves, false)
  }

  function undo() {
    if (!root.canUndo) return
    var reversed = PowerRenameLogic.undoMoves(root.lastMoves)
    root.runMoves(reversed, true)
  }

  function runMoves(moves, isUndo) {
    moveProc.moves = moves
    moveProc.index = 0
    moveProc.isUndo = isUndo
    if (!moves.length) return
    root.busy = true
    moveProc.command = PowerRenameLogic.moveCommand(moves[0].from, moves[0].to)
    moveProc.running = true
  }

  Process {
    id: listProc
    command: PowerRenameLogic.listCommand(root.folder)
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.names = PowerRenameLogic.namesFromListing(text)
        root.refreshPlan()
      }
    }
    onExited: function (code) {
      root.folderMissing = code === 3
      if (code === 3) root.notice = "Folder not found."
      else if (code !== 0) root.notice = "Could not list the folder."
    }
  }

  // The portal chooser opens under the overlay, so the overlay hides until it answers.
  Process {
    id: pickProc
    command: PowerRenameLogic.pickCommand()
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var picked = PowerRenameLogic.pickedFolder(text)
        if (picked) root.loadFolder(picked)
      }
    }
    onExited: function (code) {
      root.picking = false
      if (code === 2) root.notice = "The folder chooser did not open."
      Qt.callLater(function () { searchField.forceActiveFocus() })
    }
  }

  Process {
    id: moveProc
    property var moves: []
    property int index: 0
    property bool isUndo: false
    property int fileCount: 0
    // lastMoves only ever holds steps that really moved, so Undo reverses exactly those.
    onExited: function (code) {
      if (code !== 0) {
        root.busy = false
        var reason = PowerRenameLogic.stepError(code, moves[index])
        if (!isUndo) {
          root.lastMoves = moves.slice(0, index)
          root.notice = "Stopped: " + reason + (index > 0 ? " Undo puts back what moved." : "")
        } else {
          root.lastMoves = PowerRenameLogic.stillToUndo(root.lastMoves, index)
          root.notice = "Undo stopped: " + reason
        }
        listProc.running = true
        return
      }
      index += 1
      if (index < moves.length) {
        command = PowerRenameLogic.moveCommand(moves[index].from, moves[index].to)
        running = true
        return
      }
      root.busy = false
      if (!isUndo) {
        root.lastMoves = moves.slice()
        root.notice = "Renamed " + fileCount + (fileCount === 1 ? " file." : " files.")
      } else {
        root.notice = "Undo complete."
        root.lastMoves = []
      }
      listProc.running = true
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened && !root.picking
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "basantpandey-power-rename"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      anchors.centerIn: parent
      radius: Style.cornerRadius
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: content
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        Keys.onEscapePressed: root.dismiss()

        Shortcut { sequence: "Alt+C"; onActivated: root.setOption("matchCase") }
        Shortcut { sequence: "Alt+W"; onActivated: root.setOption("wholeWord") }
        Shortcut { sequence: "Alt+R"; onActivated: root.setOption("useRegex") }
        Shortcut { sequence: "Alt+P"; onActivated: root.setOption("preserveCase") }

        Column {
          id: header
          width: parent.width
          spacing: Style.spacing.md

          Item {
            width: parent.width
            height: closeButton.height

            Text {
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: "Power Rename"
              color: root.foreground
              font.family: Style.font.family
              font.pixelSize: Style.font.title
              font.bold: true
            }

            Button {
              id: closeButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: "✕"
              tooltipText: "Close (Esc)"
              foreground: root.foreground
              onClicked: root.dismiss()
            }
          }

          PanelSectionHeader { text: "Folder"; foreground: root.foreground }
          Item {
            width: parent.width
            height: folderField.implicitHeight

            Button {
              id: upButton
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              height: folderField.implicitHeight
              text: "↑"
              tooltipText: "Parent folder"
              bordered: true
              foreground: root.foreground
              enabled: !root.busy && root.folder !== "" && root.folder !== "/"
              opacity: enabled ? 1 : 0.4
              onClicked: root.loadFolder(PowerRenameLogic.parentFolder(root.folder))
            }
            TextField {
              id: folderField
              anchors.left: upButton.right
              anchors.leftMargin: Style.spacing.controlGap
              anchors.right: browseButton.left
              anchors.rightMargin: Style.spacing.controlGap
              anchors.verticalCenter: parent.verticalCenter
              foreground: root.foreground
              placeholderText: "Type a folder path, like ~/Pictures"
              onAccepted: {
                root.loadFolder(text)
                searchField.forceActiveFocus()
              }
            }
            Button {
              id: browseButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              height: folderField.implicitHeight
              text: "Browse…"
              tooltipText: "Choose a folder"
              bordered: true
              foreground: root.foreground
              enabled: !root.busy
              opacity: enabled ? 1 : 0.4
              onClicked: root.browse()
            }
          }

          PanelSectionHeader { text: "Search"; foreground: root.foreground }
          TextField {
            id: searchField
            width: parent.width
            foreground: root.foreground
            placeholderText: "Text to find"
            text: root.search
            onTextEdited: {
              root.search = text
              root.edited()
            }
            onAccepted: replaceField.forceActiveFocus()
          }

          PanelSectionHeader { text: "Replace with"; foreground: root.foreground }
          TextField {
            id: replaceField
            width: parent.width
            foreground: root.foreground
            placeholderText: "Leave empty to remove the text"
            text: root.replace
            onTextEdited: {
              root.replace = text
              root.edited()
            }
            onAccepted: root.renameFiles()
          }

          Grid {
            id: optionGrid
            width: parent.width
            columns: 2
            columnSpacing: Style.spacing.xxl
            rowSpacing: Style.spacing.xs
            readonly property real cellWidth: (width - columnSpacing) / 2

            OptionCheckBox {
              width: optionGrid.cellWidth
              text: "Match case"
              shortcutText: "Alt+C"
              checked: root.matchCase
              foreground: root.foreground
              onToggled: root.setOption("matchCase")
            }
            OptionCheckBox {
              width: optionGrid.cellWidth
              text: "Match whole word"
              shortcutText: "Alt+W"
              checked: root.wholeWord
              foreground: root.foreground
              onToggled: root.setOption("wholeWord")
            }
            OptionCheckBox {
              width: optionGrid.cellWidth
              text: "Use regular expression"
              shortcutText: "Alt+R"
              checked: root.useRegex
              foreground: root.foreground
              onToggled: root.setOption("useRegex")
            }
            OptionCheckBox {
              width: optionGrid.cellWidth
              text: "Preserve case"
              shortcutText: "Alt+P"
              checked: root.preserveCase
              foreground: root.foreground
              onToggled: root.setOption("preserveCase")
            }
          }

          PanelSeparator { width: parent.width }

          PanelSectionHeader {
            text: root.search
              ? "Preview · " + root.changes.length + " of " + root.names.length + " files change"
              : "Preview · " + root.names.length + " files"
            foreground: root.foreground
          }
        }

        ListView {
          id: previewList
          anchors.top: header.bottom
          anchors.topMargin: Style.spacing.md
          anchors.bottom: footer.top
          anchors.bottomMargin: Style.spacing.lg
          width: parent.width
          clip: true
          spacing: Style.spacing.xxs
          model: root.changes
          boundsBehavior: Flickable.StopAtBounds

          delegate: Item {
            required property var modelData
            width: previewList.width
            height: rowText.implicitHeight + Style.spacing.sm * 2

            Rectangle {
              anchors.fill: parent
              radius: Style.cornerRadius
              color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.05)
            }
            Text {
              id: rowText
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.leftMargin: Style.spacing.lg
              anchors.rightMargin: Style.spacing.lg
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: modelData.from + "  →  " + modelData.to
              color: modelData.error ? Color.urgent : root.foreground
              font.family: Style.font.family
              font.pixelSize: Style.font.body
              elide: Text.ElideMiddle
            }
          }

          Text {
            anchors.centerIn: parent
            visible: previewList.count === 0
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            text: !root.folder ? "Type a folder path or click Browse."
              : PowerRenameLogic.folderError(root.folder) ? "Type a full path, like ~/Pictures or /home/you/Pictures."
              : root.folderMissing ? "There is no folder at " + root.folder + "."
              : root.search ? "No file names match."
              : "Type the text to find. Matching files show here."
            color: root.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
        }

        Item {
          id: footer
          anchors.bottom: parent.bottom
          width: parent.width
          height: renameButton.height

          Text {
            anchors.left: parent.left
            anchors.right: undoButton.left
            anchors.rightMargin: Style.spacing.lg
            anchors.verticalCenter: parent.verticalCenter
            text: root.statusText
            color: root.plan.blocked ? Color.urgent : root.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }

          Button {
            id: undoButton
            anchors.right: renameButton.left
            anchors.rightMargin: Style.spacing.controlGap
            anchors.verticalCenter: parent.verticalCenter
            text: "Undo"
            bordered: true
            foreground: root.foreground
            enabled: root.canUndo
            opacity: enabled ? 1 : 0.4
            onClicked: root.undo()
          }

          Button {
            id: renameButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.changes.length > 0 ? "Rename " + root.changes.length : "Rename"
            bordered: true
            selected: root.canRename
            foreground: root.foreground
            enabled: root.canRename
            opacity: enabled ? 1 : 0.4
            onClicked: root.renameFiles()
          }
        }
      }
    }
  }
}
