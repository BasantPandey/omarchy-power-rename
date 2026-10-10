import QtQuick
import qs.Commons
import qs.Ui

// A labeled checkbox drawn with the shell kit's state colors, so it follows the theme.
// The caller owns the value: bind `checked` and flip it in `onToggled`.
Item {
  id: root

  property string text: ""
  property string shortcutText: ""
  property bool checked: false
  property color foreground: Color.foreground
  property color accent: Color.accent

  signal toggled()

  readonly property bool hot: mouse.containsMouse || activeFocus
  readonly property int boxSize: Math.max(14, Style.font.body + Style.spacing.xs)

  implicitWidth: row.implicitWidth
  implicitHeight: Math.max(boxSize, label.implicitHeight) + Style.spacing.sm * 2
  activeFocusOnTab: true

  Keys.onSpacePressed: root.toggled()
  Keys.onReturnPressed: root.toggled()
  Keys.onEnterPressed: root.toggled()

  Rectangle {
    anchors.fill: parent
    anchors.margins: -Style.spacing.xs
    radius: Style.cornerRadius
    color: root.hot ? Style.hoverFillFor(root.foreground, root.accent) : "transparent"
    Behavior on color { ColorAnimation { duration: 120 } }
  }

  Row {
    id: row
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.spacing.lg

    BorderSurface {
      id: box
      width: root.boxSize
      height: root.boxSize
      anchors.verticalCenter: parent.verticalCenter
      radius: Math.min(Style.cornerRadius, Style.space(3))
      color: root.checked ? root.foreground : "transparent"
      borderSpec: Border.controlSpec(root.hot ? "hover-cursor" : "normal", root.foreground, root.accent)
      Behavior on color { ColorAnimation { duration: 120 } }

      Text {
        anchors.centerIn: parent
        visible: root.checked
        text: "✓"
        color: Color.menu.background
        font.family: Style.font.family
        font.pixelSize: Math.round(root.boxSize * 0.8)
        font.bold: true
      }
    }

    Text {
      id: label
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.text
      color: root.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      visible: root.shortcutText !== ""
      textFormat: Text.PlainText
      text: root.shortcutText
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    anchors.margins: -Style.spacing.xs
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.toggled()
  }
}
