package dev.elchi.orbit.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** Line icons on a 24 unit grid with 2 unit round strokes, the look of the web app's icons. */
object Ic {
    private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0"

    private fun icon(name: String, vararg d: String, stroke: Float = 2f): ImageVector {
        val b = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        for (p in d) {
            b.addPath(
                pathData = PathParser().parsePathString(p).toNodes(),
                stroke = SolidColor(Color.White),
                strokeLineWidth = stroke,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    val Check by lazy { icon("check", "M20 6 9 17l-5-5") }
    val CheckCheck by lazy { icon("check-check", "M18 6 7 17l-5-5", "m22 10-7.5 7.5L13 16") }
    val X by lazy { icon("x", "M18 6 6 18", "m6 6 12 12") }
    val ChevronDown by lazy { icon("chevron-down", "m6 9 6 6 6-6") }
    val ChevronUp by lazy { icon("chevron-up", "m18 15-6-6-6 6") }
    val ChevronLeft by lazy { icon("chevron-left", "m15 18-6-6 6-6") }
    val ChevronRight by lazy { icon("chevron-right", "m9 18 6-6-6-6") }
    val ArrowUp by lazy { icon("arrow-up", "m5 12 7-7 7 7", "M12 19V5") }
    val ArrowDown by lazy { icon("arrow-down", "M12 5v14", "m19 12-7 7-7-7") }
    val ArrowUpRight by lazy { icon("arrow-up-right", "M7 7h10v10", "M7 17 17 7") }
    val Stop by lazy { icon("square", "M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z") }
    val Terminal by lazy { icon("terminal", "m4 17 6-6-6-6", "M12 19h8") }
    val File by lazy { icon("file", "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M16 13H8", "M16 17H8") }
    val FilePen by lazy { icon("file-pen", "M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5", "M14 2v4a2 2 0 0 0 2 2h4", "M13.4 12.6a2 2 0 1 1 3 3L11 21l-4 1 1-4Z") }
    val Folder by lazy { icon("folder", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z") }
    val Search by lazy { icon("search", circle(11f, 11f, 8f), "m21 21-4.3-4.3") }
    val Globe by lazy { icon("globe", circle(12f, 12f, 10f), "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20") }
    val Thought by lazy { icon("thought", "M9 18h6", "M10 22h4", "M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z") }
    val Gauge by lazy { icon("gauge", "m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0") }
    val Pencil by lazy { icon("pencil", "M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z", "m15 5 4 4") }
    val Trash by lazy { icon("trash", "M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2") }
    val Plus by lazy { icon("plus", "M5 12h14", "M12 5v14") }
    val List by lazy { icon("list", "M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01") }
    val Sky by lazy { icon("sky", circle(12f, 12f, 3f), circle(12f, 12f, 8.5f), circle(18.5f, 5.8f, 1.6f)) }
    val Alert by lazy { icon("alert", circle(12f, 12f, 10f), "M12 8v4", "M12 16h.01") }
    val Sliders by lazy { icon("sliders", "M20 7h-9", "M14 17H5", circle(17f, 17f, 3f), circle(7f, 7f, 3f)) }
    val Qr by lazy { icon("qr", "M3 3h6v6H3z", "M15 3h6v6h-6z", "M3 15h6v6H3z", "M15 15h2v2h-2z", "M19 19h2v2h-2z", "M15 20h1", "M20 15h1") }
    val Clipboard by lazy { icon("clipboard", "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2", "M9 2h6v4H9z") }
    val Copy by lazy { icon("copy", "M9 9h11v11H9z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1") }
    val Bell by lazy { icon("bell", "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0") }
    val Hand by lazy { icon("hand", "M18 11V6a2 2 0 0 0-4 0v5", "M14 10V4a2 2 0 0 0-4 0v6", "M10 10.5V6a2 2 0 0 0-4 0v8", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15") }
    val Scale by lazy { icon("scale", "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z", "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z", "M7 21h10", "M12 3v18", "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2") }
    val Zap by lazy { icon("zap", "M13 2 3 14h9l-1 8 10-12h-9l1-8z") }
    val ListChecks by lazy { icon("list-checks", "m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8") }
    val Wrench by lazy { icon("wrench", "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z") }
    val Helpers by lazy { icon("helpers", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circle(9f, 7f, 4f), "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75") }
    val WifiOff by lazy { icon("wifi-off", "M12 20h.01", "M8.5 16.43a5 5 0 0 1 7 0", "M5 12.86a10 10 0 0 1 5.17-2.69", "M19 12.86a10 10 0 0 0-2-1.54", "M2 8.82a15 15 0 0 1 4.18-2.65", "M22 8.82a15 15 0 0 0-11.29-3.76", "M2 2l20 20") }
    val Note by lazy { icon("note", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z") }
    val Computer by lazy { icon("computer", "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4") }
    val Refresh by lazy { icon("refresh", "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5") }
    val Battery by lazy { icon("battery", "M4 7h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", "M22 11v2", "M6 11v2") }
    val Info by lazy { icon("info", circle(12f, 12f, 10f), "M12 16v-4", "M12 8h.01") }
    val Book by lazy { icon("book", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20") }
    val Settings by lazy { icon("settings", "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", circle(12f, 12f, 3f)) }
    val Box by lazy { icon("box", "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5", "M12 22V12") }

    fun forTool(name: String): ImageVector = when {
        name == "bash" -> Terminal
        name == "read_file" || name == "doc_read" -> File
        name == "write_file" || name == "edit_file" || name.startsWith("doc_") -> FilePen
        name == "list_dir" -> Folder
        name == "glob" || name == "grep" -> Search
        name == "fetch_url" || name == "web_search" -> Globe
        name == "plan" -> ListChecks
        name == "delegate" -> Helpers
        name == "load_skill" -> Book
        name.startsWith("ui_") -> Sky
        name.startsWith("mcp__") -> Box
        else -> Wrench
    }
}
