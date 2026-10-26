package dev.elchi.orbit.core.state

import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.model.Detail
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.model.arr
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.str
import kotlinx.serialization.json.JsonObject
import java.net.URI
import java.util.Locale

/** Ori's poses (web/src/components/ori/Ori.tsx). */
enum class OriPose { IDLE, HI, THINKING, WORKING, READING, SEARCHING, WRITING, PLANNING, DRAWING, CAMERA, NEEDS, DONE, SLEEPING, OOPS, HELPERS }

data class OriStatus(val pose: OriPose, val doing: String)

/** web/src/lib/ori.ts, without React. */
object OriLogic {
    fun poseForTool(name: String): OriStatus = when {
        name == "bash" -> OriStatus(OriPose.WORKING, "Running a command")
        name in setOf("read_file", "list_dir", "glob", "grep") -> OriStatus(OriPose.READING, "Reading files")
        name == "load_skill" -> OriStatus(OriPose.READING, "Reading a skill")
        name == "knowledge" -> OriStatus(OriPose.READING, "Looking it up")
        name == "fetch_url" || name == "web_search" -> OriStatus(OriPose.SEARCHING, "Looking on the web")
        name in setOf("write_file", "edit_file", "doc_write", "doc_edit", "doc_comment") -> OriStatus(OriPose.WRITING, "Writing")
        name == "doc_read" -> OriStatus(OriPose.READING, "Reading a doc")
        name == "plan" -> OriStatus(OriPose.PLANNING, "Planning")
        name.startsWith("whiteboard") -> OriStatus(OriPose.DRAWING, "On the board")
        name == "screenshot" || name == "preview_open" -> OriStatus(OriPose.CAMERA, "Looking at the page")
        name == "delegate" -> OriStatus(OriPose.HELPERS, "Helpers are working")
        else -> OriStatus(OriPose.WORKING, "Working")
    }

    fun status(ws: Workspace, detail: Detail?, stream: LiveStream?, ended: Ended?, now: Long): OriStatus {
        if (ws.needsYou) return OriStatus(OriPose.NEEDS, "Waiting for you")
        if (ws.running) {
            val last = stream?.blocks?.lastOrNull { it != null }
            val runningCall = detail?.calls?.values?.firstOrNull { it.status == "running" }
            if (runningCall != null) return poseForTool(runningCall.name)
            return when (last?.type) {
                "tool_use", "server_tool_use" -> poseForTool(last.name ?: "")
                "thinking" -> OriStatus(OriPose.THINKING, "Thinking")
                "text" -> OriStatus(OriPose.WORKING, "Writing the answer")
                else -> OriStatus(OriPose.THINKING, "Thinking")
            }
        }
        if (ws.helpersBusy > 0) return OriStatus(OriPose.HELPERS, "Helpers are working")
        if (ended != null && now - ended.at < 25_000) {
            if (ended.reason == "done") return OriStatus(OriPose.DONE, "Done")
            if (ended.reason != "stopped") return OriStatus(OriPose.OOPS, "Something stopped the run")
        }
        if (now - ws.updatedAt > 30 * 60_000) return OriStatus(OriPose.SLEEPING, "Resting")
        return OriStatus(OriPose.IDLE, "Ready")
    }
}

/** web/src/lib/format.ts and helpers.ts. */
object Format {
    fun tokens(n: Long): String = when {
        n <= 0 -> "0"
        n >= 1_000_000 -> String.format(Locale.US, if (n >= 10_000_000) "%.0fM" else "%.1fM", n / 1_000_000.0)
        n >= 1000 -> String.format(Locale.US, if (n >= 100_000) "%.0fk" else "%.1fk", n / 1000.0)
        else -> n.toString()
    }

    fun money(n: Double): String = when {
        n <= 0.0 -> "$0"
        n < 0.01 -> String.format(Locale.US, "$%.4f", n)
        n < 1 -> String.format(Locale.US, "$%.3f", n)
        else -> String.format(Locale.US, "$%.2f", n)
    }

    fun ago(ts: Long, now: Long): String {
        val s = (now - ts) / 1000
        return when {
            s < 60 -> "just now"
            s < 3600 -> "${s / 60} min ago"
            s < 86400 -> "${s / 3600} h ago"
            else -> (s / 86400).let { if (it == 1L) "yesterday" else "$it days ago" }
        }
    }

    fun ms(n: Long?): String = when {
        n == null -> ""
        n < 1000 -> "$n ms"
        else -> String.format(Locale.US, "%.1f s", n / 1000.0)
    }

    fun shortPath(p: String, home: String?): String = if (!home.isNullOrEmpty() && p.startsWith(home)) "~" + p.substring(home.length) else p

    fun helpersLine(w: Workspace): String {
        val n = w.helpersBusy
        if (n == 0) return "working"
        val word = if (n == 1) "1 helper" else "$n helpers"
        return if (w.running) "working, $word" else "$word working"
    }

    fun agentLabel(a: String?): String = when {
        a.isNullOrEmpty() -> "Helper"
        a == "explorer" -> "Explorer"
        a == "builder" -> "Builder"
        a == "reviewer" -> "Reviewer"
        a == "tester" -> "Tester"
        else -> a.replace(Regex("[-_]"), " ").replaceFirstChar { it.uppercase() }
    }

    fun helperState(state: String, running: Boolean, pending: Int): String = when {
        pending > 0 -> "needs you"
        running || state == "running" -> "working"
        else -> mapOf("done" to "done", "failed" to "failed", "stopped" to "stopped", "merged" to "merged", "discarded" to "discarded")[state] ?: ""
    }
}

/** A tool call in words: the label, with the part to show as code split out. */
data class ToolText(val before: String, val code: String?, val after: String = "")

object ToolWords {
    private fun base(p: String?): String = p?.split('/', '\\')?.filter { it.isNotEmpty() }?.takeLast(2)?.joinToString("/") ?: ""

    fun label(name: String, input: JsonObject): ToolText = when (name) {
        "bash" -> ToolText("", (input.str("command") ?: "").lineSequence().firstOrNull()?.take(140) ?: "")
        "read_file" -> ToolText("Read ", base(input.str("path")))
        "write_file" -> ToolText("Wrote ", base(input.str("path")))
        "edit_file" -> ToolText("Edited ", base(input.str("path")))
        "list_dir" -> ToolText("Looked in ", base(input.str("path")).ifEmpty { "the folder" })
        "glob" -> ToolText("Found files matching ", input.str("pattern") ?: "")
        "grep" -> ToolText("Searched for ", input.str("pattern") ?: "")
        "fetch_url" -> ToolText("Fetched ", runCatching { URI(input.str("url")).host }.getOrNull() ?: input.str("url") ?: "")
        "plan" -> {
            val items = input.arr("items")?.mapNotNull { it.asObj() } ?: emptyList()
            ToolText("Updated the plan, ${items.count { it.str("status") == "done" }} of ${items.size} done", null)
        }
        "doc_write" -> ToolText(if (input.str("id") != null) "Rewrote the doc " else "Wrote the doc ", input.str("title") ?: input.str("id") ?: "Untitled")
        "doc_edit" -> ToolText("Edited a doc", null)
        "doc_read" -> ToolText(if (input.str("id") != null) "Read a doc and its comments" else "Listed the docs", null)
        "doc_comment" -> ToolText("Commented on a doc", null)
        "whiteboard" -> {
            val n = input.arr("ops")?.size ?: 0
            ToolText("Updated the board" + if (n > 0) ", $n ${if (n == 1) "change" else "changes"}" else "", null)
        }
        "whiteboard_read" -> ToolText("Looked at the board", null)
        "preview_open" -> ToolText("Showed ", input.str("target") ?: "", " in the preview")
        "screenshot" -> ToolText("Looked at ", input.str("target")?.ifEmpty { null } ?: "the preview")
        "load_skill" -> ToolText("Loaded the skill ", input.str("name") ?: "")
        "ui_set_title" -> ToolText("Renamed the workspace to “${input.str("title") ?: ""}”", null)
        "ui_set_planet" -> ToolText("Restyled this planet", null)
        "ui_notify" -> ToolText("Sent you a notification", null)
        "ui_pin" -> ToolText("Pinned to memory: ${input.str("text") ?: ""}", null)
        "ui_widget" -> ToolText("Built ${input.str("title") ?: "a widget"}", null)
        else -> if (name.startsWith("mcp__")) {
            val parts = name.split("__")
            ToolText("${parts.getOrElse(1) { "" }} ", parts.getOrElse(2) { "" })
        } else ToolText(name, null)
    }

    /** Who let an action through, in words, and how loud to say it. */
    fun verdict(status: String?, decidedBy: String?): Pair<String, String> = when (status) {
        null -> "preparing" to "quiet"
        "pending" -> "waiting for you" to "peach"
        "judging" -> "judge looking" to "lav"
        "denied" -> "denied" to "bad"
        "cancelled" -> "stopped" to "bad"
        else -> when (decidedBy) {
            "readonly" -> "read-only" to "quiet"
            "rule" -> "your rule" to "quiet"
            "judge" -> "judge" to "lav"
            "user" -> "you" to "peach"
            "builtin" -> "interface" to "quiet"
            "mode" -> "blocked" to "bad"
            "full" -> "full autonomy" to "quiet"
            else -> "allowed" to "quiet"
        }
    }

    /** The approval card's headline (web/src/components/Approval.tsx). */
    fun headline(a: Approval): String = when (a.name) {
        "bash" -> "Claude wants to run a command"
        "write_file" -> "Claude wants to write a file"
        "edit_file" -> "Claude wants to edit a file"
        "fetch_url" -> "Claude wants to open a web address"
        else -> "Claude wants to use ${a.name}"
    }

    /** The command or subject to show on an approval. */
    fun approvalBody(a: Approval): String = if (a.name == "bash") a.inputObj.str("command") ?: a.subject else a.subject
}
