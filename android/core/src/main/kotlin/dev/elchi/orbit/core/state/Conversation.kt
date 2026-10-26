package dev.elchi.orbit.core.state

import dev.elchi.orbit.core.model.Message
import dev.elchi.orbit.core.model.arr
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.model.obj
import dev.elchi.orbit.core.model.str
import kotlinx.serialization.json.JsonObject

/** One prompt of yours, or one run of Claude's (its tool results fold into the tool rows). */
data class Turn(val role: String, val id: String, val blocks: List<JsonObject>, val createdAt: Long)

/** What a user turn shows: the text, attachments, and whether it was sent mid-run or by a mission. */
data class UserView(val text: String, val steered: Boolean, val mission: String?, val missionHow: String, val attachments: List<String>)

/** One thing drawn in a turn of Claude's. */
sealed interface Item {
    data class Text(val text: String, val live: Boolean) : Item
    data class Thinking(val text: String, val live: Boolean) : Item
    data class Tool(val id: String?, val name: String, val input: JsonObject, val live: Boolean) : Item
    data class Search(val id: String?, val query: String, val results: List<Pair<String, String>>?, val error: String?, val live: Boolean) : Item
    data class Helpers(val blocks: List<JsonObject>, val live: Boolean) : Item
    data class Panel(val title: String, val content: String) : Item
}

data class Source(val n: Int, val url: String, val title: String)

data class Prepared(val items: List<Item>, val sources: List<Source>)

object Conversation {
    /** web/src/components/cockpit/Stream.tsx toTurns. */
    fun turns(messages: List<Message>): List<Turn> {
        val out = mutableListOf<Turn>()
        for (m in messages) {
            val isResults = m.role == "user" && m.content.isNotEmpty() && m.content.all { it.str("type") == "tool_result" }
            if (isResults) continue
            val last = out.lastOrNull()
            if (m.role == "assistant" && last?.role == "assistant") out[out.size - 1] = last.copy(blocks = last.blocks + m.content)
            else out += Turn(m.role, m.id, m.content, m.createdAt)
        }
        return out
    }

    private val MISSION = Regex("""\n\n\[Orbit: this is the mission "([^"]*)"(?: \((?:started by its webhook|on its schedule)\))?[^\]]*\]$""")

    fun userView(t: Turn): UserView {
        val texts = t.blocks.filter { it.str("type") == "text" }.mapNotNull { it.str("text") }
        val steered = texts.any { it.startsWith("<steer>") }
        val raw = texts.filter { !it.startsWith("<attachment") && !it.startsWith("<steer>") }.joinToString("\n")
        val m = MISSION.find(raw)
        val text = if (m != null) raw.substring(0, m.range.first) else raw
        val how = when {
            raw.contains("(started by its webhook)") -> ", started by its webhook"
            raw.contains("(on its schedule)") -> ", on its schedule"
            else -> ""
        }
        val attachments = t.blocks.mapNotNull { b ->
            when (b.str("type")) {
                "image" -> "Image"
                "document" -> "PDF"
                "text" -> b.str("text")?.takeIf { it.startsWith("<attachment") }?.let { Regex("name=\"([^\"]+)\"").find(it)?.groupValues?.get(1) ?: "Attachment" }
                else -> null
            }
        }
        return UserView(text, steered, m?.groupValues?.get(1)?.ifEmpty { "untitled" }, how, attachments)
    }

    /** Joins neighbouring text, numbers citations, pairs web searches with their results (Stream.tsx prepare). */
    fun prepare(blocks: List<JsonObject?>, streaming: Boolean = false): Prepared {
        val sources = LinkedHashMap<String, Source>()
        val items = mutableListOf<Item>()
        blocks.forEachIndexed { i, b ->
            if (b == null) return@forEachIndexed
            val live = streaming && i == blocks.lastIndex
            when (b.str("type")) {
                "text" -> {
                    var t = b.str("text") ?: ""
                    val cites = b.arr("citations")?.mapNotNull { it.asObj() } ?: emptyList()
                    for (c in cites) {
                        val url = c.str("url") ?: continue
                        if (url !in sources) sources[url] = Source(sources.size + 1, url, c.str("title")?.ifEmpty { null } ?: url)
                    }
                    t += cites.mapNotNull { it.str("url") }.distinct().joinToString("") { " [${sources.getValue(it).n}]($it)" }
                    val prev = items.lastOrNull()
                    if (prev is Item.Text) items[items.size - 1] = Item.Text(prev.text + t, live)
                    else if (t.isNotEmpty() || live) items += Item.Text(t, live)
                }
                "thinking" -> {
                    val t = b.str("thinking") ?: b.str("text") ?: ""
                    if (t.isNotBlank() || live) items += Item.Thinking(t, live)
                }
                "web_search_tool_result" -> {
                    val idx = items.indexOfLast { it is Item.Search && it.id == b.str("tool_use_id") }
                    if (idx >= 0) {
                        val s = items[idx] as Item.Search
                        val content = b["content"]
                        val list = content.arr()?.mapNotNull { it.asObj() }?.map { (it.str("title") ?: it.str("url") ?: "") to (it.str("url") ?: "") }
                        val err = if (list == null) content.asObj()?.str("error_code")?.replace('_', ' ') else null
                        items[idx] = s.copy(results = list ?: emptyList(), error = err)
                    }
                }
                "server_tool_use" -> {
                    val q = b.obj("input")?.str("query") ?: Regex("\"query\"\\s*:\\s*\"([^\"]*)").find(b.str("text") ?: "")?.groupValues?.get(1) ?: ""
                    items += Item.Search(b.str("id"), q, null, null, live)
                }
                "tool_use" -> {
                    val name = b.str("name") ?: ""
                    val input = b.obj("input") ?: JsonObject(emptyMap())
                    when (name) {
                        "delegate" -> {
                            val prev = items.lastOrNull()
                            if (prev is Item.Helpers) items[items.size - 1] = Item.Helpers(prev.blocks + b, live) else items += Item.Helpers(listOf(b), live)
                        }
                        "ui_show" -> items += Item.Panel(input.str("title") ?: "", input.str("content") ?: input["content"]?.toString() ?: "")
                        else -> items += Item.Tool(b.str("id"), name, input, live)
                    }
                }
                else -> {}
            }
        }
        return Prepared(items, sources.values.toList())
    }

    /** A live stream's blocks as the JSON shapes [prepare] reads. */
    fun streamBlocks(stream: LiveStream?): List<JsonObject?> = stream?.blocks?.map { b ->
        b?.let {
            when (it.type) {
                "thinking" -> jsonOf("type" to "thinking", "thinking" to it.text)
                "tool_use", "server_tool_use" -> {
                    val input = runCatching { dev.elchi.orbit.core.model.OrbitJson.parseToJsonElement(it.text).asObj() }.getOrNull()
                    jsonOf("type" to it.type, "id" to it.id, "name" to it.name, "input" to input, "text" to it.text)
                }
                else -> jsonOf("type" to it.type, "text" to it.text)
            }
        }
    } ?: emptyList()

    /** Plain text of a turn of Claude's, for copying. */
    fun plainText(t: Turn): String = t.blocks.filter { it.str("type") == "text" }.mapNotNull { it.str("text") }.joinToString("\n\n")
}

private fun kotlinx.serialization.json.JsonElement?.arr() = when (this) {
    is kotlinx.serialization.json.JsonArray -> this
    else -> null
}
