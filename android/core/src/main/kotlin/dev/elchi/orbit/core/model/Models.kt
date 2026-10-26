package dev.elchi.orbit.core.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** A planet's look, picked by Orbit when the workspace is made (web/src/lib/types.ts PlanetStyle). */
data class PlanetStyle(val color: Long, val surface: String, val rings: Boolean) {
    companion object {
        val DEFAULT = PlanetStyle(0xFFB8A6FF, "gas", false)

        fun from(o: JsonObject?): PlanetStyle {
            if (o == null) return DEFAULT
            return PlanetStyle(parseColor(o.str("color")) ?: DEFAULT.color, o.str("surface") ?: "gas", o.bool("rings") ?: false)
        }

        /** #RGB, #RRGGBB or #RRGGBBAA to 0xAARRGGBB. */
        fun parseColor(s: String?): Long? {
            val h = s?.trim()?.removePrefix("#") ?: return null
            if (!h.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
            return when (h.length) {
                3 -> 0xFF000000 or (h.map { "$it$it" }.joinToString("").toLong(16))
                6 -> 0xFF000000 or h.toLong(16)
                8 -> (h.substring(6, 8).toLong(16) shl 24) or h.substring(0, 6).toLong(16)
                else -> null
            }
        }
    }
}

data class PlanItem(val text: String, val status: String) {
    val finished get() = status == "done" || status == "skipped"
}

data class Helper(
    val id: String,
    val title: String,
    val agent: String,
    val state: String,
    val report: String,
    val callId: String,
    val createdAt: Long,
    val running: Boolean,
    val pending: Int,
) {
    companion object {
        fun from(o: JsonObject) = Helper(
            id = o.str("id") ?: "",
            title = o.str("title") ?: "Helper",
            agent = o.str("agent") ?: "",
            state = o.str("state") ?: "",
            report = o.str("report") ?: "",
            callId = o.str("call_id") ?: "",
            createdAt = o.long("created_at") ?: 0,
            running = o.bool("running") ?: false,
            pending = o.int("pending") ?: 0,
        )
    }
}

/**
 * A workspace as the server sends it. [raw] keeps every field, so a later
 * partial update merges like `{...old, ...new}` in the web app.
 */
data class Workspace(
    val raw: JsonObject,
    val id: String,
    val title: String,
    val cwd: String,
    val model: String?,
    val mode: String,
    val style: PlanetStyle,
    val summary: String,
    val archived: Boolean,
    val incognito: Boolean,
    val profile: String,
    val plan: List<PlanItem>,
    val createdAt: Long,
    val updatedAt: Long,
    val tokens: Long,
    val cost: Double,
    val running: Boolean,
    val pending: Int,
    val messageCount: Int,
    val parentId: String?,
    val agent: String,
    val helperState: String,
    val report: String,
    val helpers: List<Helper>,
) {
    val helpersBusy: Int get() = helpers.count { it.running }
    val needsYou: Boolean get() = pending > 0 || helpers.any { it.pending > 0 }
    val busy: Boolean get() = running || helpersBusy > 0

    /** Lays [patch] over this workspace's fields and reads it again. */
    fun patch(patch: JsonObject): Workspace = from(raw + patch)
    fun patch(vararg pairs: Pair<String, Any?>): Workspace = from(raw.with(*pairs))

    fun patchHelper(id: String, vararg pairs: Pair<String, Any?>): Workspace {
        val list = raw.arr("helpers") ?: return this
        if (list.none { it.asObj()?.str("id") == id }) return this
        return patch("helpers" to JsonArray(list.map { h -> val o = h.asObj(); if (o?.str("id") == id) o.with(*pairs) else h }))
    }

    companion object {
        fun from(o: JsonObject): Workspace {
            val stats = o.obj("stats")
            return Workspace(
                raw = o,
                id = o.str("id") ?: "",
                title = o.str("title") ?: "Workspace",
                cwd = o.str("cwd") ?: "",
                model = o.str("model"),
                mode = o.str("mode") ?: "manual",
                style = PlanetStyle.from(o.obj("style")),
                summary = o.str("summary") ?: "",
                archived = o.bool("archived") ?: false,
                incognito = o.bool("incognito") ?: false,
                profile = o.str("profile") ?: "",
                plan = o.arr("plan")?.mapNotNull { it.asObj() }?.map { PlanItem(it.str("text") ?: "", it.str("status") ?: "todo") } ?: emptyList(),
                createdAt = o.long("created_at") ?: 0,
                updatedAt = o.long("updated_at") ?: 0,
                tokens = stats?.long("tokens") ?: 0,
                cost = stats?.dbl("cost") ?: 0.0,
                running = o.bool("running") ?: false,
                pending = o.int("pending") ?: 0,
                messageCount = o.int("messageCount") ?: 0,
                parentId = o.str("parent_id")?.takeIf { it.isNotEmpty() },
                agent = o.str("agent") ?: "",
                helperState = o.str("helper_state") ?: "",
                report = o.str("report") ?: "",
                helpers = o.arr("helpers")?.mapNotNull { it.asObj() }?.map(Helper::from) ?: emptyList(),
            )
        }
    }
}

data class ToolCall(
    val id: String,
    val workspaceId: String,
    val name: String,
    /** The input as the server stored it: a JSON string. */
    val input: String,
    val subject: String,
    val status: String,
    val output: String?,
    val isError: Boolean,
    val decidedBy: String?,
    val reason: String?,
    val judgeMs: Long?,
    val durationMs: Long?,
    val createdAt: Long,
) {
    val inputJson: JsonObject get() = runCatching { OrbitJson.parseToJsonElement(input) as? JsonObject }.getOrNull() ?: JsonObject(emptyMap())

    companion object {
        fun from(o: JsonObject) = ToolCall(
            id = o.str("id") ?: "",
            workspaceId = o.str("workspace_id") ?: "",
            name = o.str("name") ?: "",
            input = when (val i = o["input"]) {
                null, JsonNull -> "{}"
                is JsonObject, is JsonArray -> i.toString()
                else -> i.asStr() ?: "{}"
            },
            subject = o.str("subject") ?: "",
            status = o.str("status") ?: "pending",
            output = o.str("output"),
            isError = o.bool("is_error") ?: false,
            decidedBy = o.str("decided_by"),
            reason = o.str("reason"),
            judgeMs = o.long("judge_ms"),
            durationMs = o.long("duration_ms"),
            createdAt = o.long("created_at") ?: 0,
        )
    }
}

/** One message: its content blocks stay JSON, since their shapes vary by type. */
data class Message(val id: String, val role: String, val content: List<JsonObject>, val createdAt: Long) {
    companion object {
        fun from(o: JsonObject) = Message(
            id = o.str("id") ?: "",
            role = o.str("role") ?: "assistant",
            content = o.arr("content")?.mapNotNull { it.asObj() } ?: emptyList(),
            createdAt = o.long("created_at") ?: 0,
        )
    }
}

data class Judge(val verdict: String, val reason: String)

/** Something Claude wants to do that waits for you (server/gate.ts askUser). */
data class Approval(
    val id: String,
    val workspaceId: String,
    val workspaceTitle: String,
    val parentId: String?,
    val parentTitle: String?,
    val agent: String?,
    val name: String,
    val input: JsonElement,
    val subject: String,
    val suggestion: String,
    val judge: Judge?,
) {
    val inputObj: JsonObject get() = input.asObj() ?: JsonObject(emptyMap())

    /** The workspace a person thinks of: a helper's question belongs to its parent. */
    val homeId: String get() = parentId ?: workspaceId
    val homeTitle: String get() = parentTitle ?: workspaceTitle

    companion object {
        fun from(o: JsonObject): Approval {
            val j = o.obj("judge")
            return Approval(
                id = o.str("id") ?: "",
                workspaceId = o.str("workspaceId") ?: "",
                workspaceTitle = o.str("workspaceTitle") ?: "",
                parentId = o.str("parentId")?.takeIf { it.isNotEmpty() },
                parentTitle = o.str("parentTitle"),
                agent = o.str("agent"),
                name = o.str("name") ?: "",
                input = o["input"] ?: JsonNull,
                subject = o.str("subject") ?: "",
                suggestion = o.str("suggestion") ?: o.str("subject") ?: "",
                judge = j?.let { Judge(it.str("verdict") ?: "", it.str("reason") ?: "") },
            )
        }
    }
}

data class Profile(
    val id: String,
    val name: String,
    val description: String,
    val icon: String,
    val mode: String,
    val web: Boolean,
    val effort: String,
) {
    companion object {
        fun from(o: JsonObject) = Profile(
            id = o.str("id") ?: "",
            name = o.str("name") ?: o.str("id") ?: "",
            description = o.str("description") ?: "",
            icon = o.str("icon") ?: "",
            mode = o.str("mode") ?: "manual",
            web = o.bool("web") ?: false,
            effort = o.str("effort") ?: "",
        )
    }
}

/** The parts of Orbit's /api/state the phone uses. [raw] keeps the rest for merging. */
data class ServerInfo(
    val raw: JsonObject,
    val version: String,
    val mock: Boolean,
    val hasKey: Boolean,
    val home: String,
    val profiles: List<Profile>,
    val defaultMode: String,
    val defaultProfile: String,
    val defaultEffort: String,
    val todayCost: Double,
    val todayTokens: Long,
    val monthCost: Double,
    val motion: String,
) {
    companion object {
        fun from(o: JsonObject): ServerInfo {
            val cfg = o.obj("config")
            return ServerInfo(
                raw = o,
                version = o.str("version") ?: "",
                mock = o.bool("mock") ?: false,
                hasKey = o.bool("hasKey") ?: false,
                home = o.str("home") ?: "",
                profiles = o.arr("profiles")?.mapNotNull { it.asObj() }?.map(Profile::from) ?: emptyList(),
                defaultMode = cfg?.obj("permissions")?.str("default_mode") ?: "manual",
                defaultProfile = cfg?.obj("workspaces")?.str("default_profile") ?: "",
                defaultEffort = cfg?.obj("models")?.str("effort") ?: "medium",
                todayCost = o.obj("today")?.dbl("cost") ?: 0.0,
                todayTokens = o.obj("today")?.long("tokens") ?: 0,
                monthCost = o.obj("month")?.dbl("cost") ?: 0.0,
                motion = cfg?.obj("ui")?.str("motion") ?: "full",
            )
        }
    }
}

/** A workspace's conversation and tool calls (GET /api/workspaces/:id). */
data class Detail(val messages: List<Message>, val calls: Map<String, ToolCall>) {
    companion object {
        val EMPTY = Detail(emptyList(), emptyMap())

        fun from(o: JsonObject) = Detail(
            messages = o.arr("messages")?.mapNotNull { it.asObj() }?.map(Message::from) ?: emptyList(),
            calls = o.arr("calls")?.mapNotNull { it.asObj() }?.map(ToolCall::from)?.associateBy { it.id } ?: emptyMap(),
        )
    }
}

/** The approval modes of web/src/components/cockpit/ModeSwitch.tsx. */
enum class Mode(val id: String, val label: String, val tip: String) {
    MANUAL("manual", "Manual", "You approve every action that isn't read-only or covered by a rule"),
    AUTO("auto", "Auto", "A judge model approves safe actions and asks you about the rest"),
    RULES("rules", "Rules", "Only your rules decide; anything else is blocked. For unattended runs"),
    FULL("full", "Full", "Claude decides on its own. Only what reaches outside the folder or escalates goes to the judge");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: MANUAL
    }
}

/** Thinking effort, as the composer offers it. */
enum class Effort(val id: String, val label: String, val hint: String) {
    LOW("low", "Low", "Fastest, for simple steps"),
    MEDIUM("medium", "Medium", "Balanced default"),
    HIGH("high", "High", "Thinks harder"),
    XHIGH("xhigh", "Extra high", "Hard problems"),
    MAX("max", "Max", "Slowest, most thorough");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id }
    }
}
