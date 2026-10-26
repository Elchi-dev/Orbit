package dev.elchi.orbit.core.state

import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.model.Detail
import dev.elchi.orbit.core.model.Helper
import dev.elchi.orbit.core.model.Message
import dev.elchi.orbit.core.model.ServerInfo
import dev.elchi.orbit.core.model.ToolCall
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.model.arr
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.dbl
import dev.elchi.orbit.core.model.int
import dev.elchi.orbit.core.model.obj
import dev.elchi.orbit.core.model.plus
import dev.elchi.orbit.core.model.str
import kotlinx.serialization.json.JsonObject

/** A block Claude is writing right now, filled by `delta` events. */
data class StreamBlock(val type: String, val text: String, val name: String? = null, val id: String? = null)

data class LiveStream(val id: String, val blocks: List<StreamBlock?>)

data class Ended(val reason: String, val at: Long)

/**
 * Everything the phone knows about one Orbit, kept the way web/src/lib/store.ts
 * keeps it, and changed only by [Reducer].
 */
data class OrbitState(
    val server: ServerInfo? = null,
    val workspaces: Map<String, Workspace> = emptyMap(),
    val details: Map<String, Detail> = emptyMap(),
    val streams: Map<String, LiveStream> = emptyMap(),
    val shellOut: Map<String, String> = emptyMap(),
    val approvals: List<Approval> = emptyList(),
    val ended: Map<String, Ended> = emptyMap(),
    val queued: Map<String, Int> = emptyMap(),
    val tps: Map<String, Double> = emptyMap(),
    /** Set once the workspace list has come in at least once. */
    val loaded: Boolean = false,
) {
    /** Top-level workspaces that aren't archived, the ones the sky shows. */
    val planets: List<Workspace> get() = workspaces.values.filter { !it.archived && it.parentId == null }

    /** The approvals that belong to a workspace or to its helpers. */
    fun approvalsFor(wsId: String): List<Approval> = approvals.filter { it.workspaceId == wsId || it.parentId == wsId }
}

/** Something the reducer can't do by itself: a reload, or a word for the person. */
sealed interface Effect {
    data class ReloadDetail(val wsId: String) : Effect
    data class LoadWorkspace(val wsId: String) : Effect
    data object ReloadServer : Effect
    data class Toast(val title: String, val body: String?, val tone: Tone, val wsId: String?) : Effect
    data class TurnEnded(val wsId: String, val reason: String) : Effect
    data class ApprovalArrived(val approval: Approval) : Effect

    enum class Tone { INFO, GOOD, WARN, BAD }
}

data class Reduction(val state: OrbitState, val effects: List<Effect> = emptyList())

/** Live events to state, as `handle` in web/src/lib/store.ts. Pure, so it can be tested with recorded events. */
object Reducer {
    fun withWorkspaces(s: OrbitState, list: List<JsonObject>): OrbitState =
        s.copy(workspaces = list.map(Workspace::from).associateBy { it.id }, loaded = true)

    fun withServer(s: OrbitState, raw: JsonObject): OrbitState {
        val server = ServerInfo.from(raw)
        val approvals = raw.arr("approvals")?.mapNotNull { it.asObj() }?.map(Approval::from)
        return s.copy(server = server, approvals = approvals ?: s.approvals)
    }

    /** The answer of GET /api/workspaces/:id. */
    fun withDetail(s: OrbitState, raw: JsonObject): OrbitState {
        val ws = raw.obj("workspace")?.let(Workspace::from) ?: return s
        return s.copy(workspaces = s.workspaces + (ws.id to ws), details = s.details + (ws.id to Detail.from(raw)))
    }

    fun reduce(s: OrbitState, e: JsonObject, now: Long = System.currentTimeMillis()): Reduction {
        val type = e.str("type") ?: return Reduction(s)
        val wsId = e.str("workspaceId")
        val effects = mutableListOf<Effect>()

        fun OrbitState.patchWs(id: String?, vararg pairs: Pair<String, Any?>): OrbitState {
            val w = id?.let { workspaces[it] } ?: return this
            return copy(workspaces = workspaces + (w.id to w.patch(*pairs)))
        }

        // a helper's state shows in its parent's list as well
        fun OrbitState.patchHelper(id: String?, vararg pairs: Pair<String, Any?>): OrbitState {
            val pid = id?.let { workspaces[it] }?.parentId ?: return this
            val p = workspaces[pid] ?: return this
            return copy(workspaces = workspaces + (pid to p.patchHelper(id, *pairs)))
        }

        fun OrbitState.patchDetail(id: String?, fn: (Detail) -> Detail): OrbitState {
            val d = id?.let { details[it] } ?: return this
            return copy(details = details + (id to fn(d)))
        }

        val next: OrbitState = when (type) {
            "hello" -> e.obj("state")?.let { withServer(s, it) } ?: s
            "state" -> {
                val merged = (s.server?.raw ?: JsonObject(emptyMap())) + JsonObject(e.filterKeys { it != "type" })
                withServer(s.copy(), merged).let { if (e.containsKey("approvals")) it else it.copy(approvals = s.approvals) }
            }
            "workspace" -> {
                val w = e.obj("workspace")
                val id = w?.str("id")
                if (w == null || id == null) s
                else {
                    val old = s.workspaces[id]
                    s.copy(workspaces = s.workspaces + (id to (old?.patch(w) ?: Workspace.from(w))))
                }
            }
            "workspace_deleted" -> s.copy(workspaces = s.workspaces - (wsId ?: ""), details = s.details - (wsId ?: ""))
            "turn_start" -> s.patchWs(wsId, "running" to true).patchHelper(wsId, "running" to true).copy(tps = s.tps - (wsId ?: ""))
            "turn_end" -> {
                val reason = e.str("reason") ?: "done"
                effects += Effect.ReloadServer
                if (wsId != null) effects += Effect.TurnEnded(wsId, reason)
                val t = s.patchWs(wsId, "running" to false).patchHelper(wsId, "running" to false)
                t.copy(streams = t.streams - (wsId ?: ""), tps = t.tps - (wsId ?: ""), ended = if (wsId != null) t.ended + (wsId to Ended(reason, now)) else t.ended)
            }
            "block_start" -> {
                val id = wsId ?: return Reduction(s)
                val streamId = e.str("streamId") ?: ""
                val index = e.int("index") ?: 0
                val b = e.obj("block")
                val cur = s.streams[id]
                val blocks = if (cur != null && cur.id == streamId) cur.blocks.toMutableList() else mutableListOf()
                while (blocks.size <= index) blocks.add(null)
                blocks[index] = StreamBlock(b?.str("type") ?: "text", "", b?.str("name"), b?.str("id"))
                s.copy(streams = s.streams + (id to LiveStream(streamId, blocks)))
            }
            "delta" -> {
                val id = wsId ?: return Reduction(s)
                val cur = s.streams[id] ?: return Reduction(s)
                val index = e.int("index") ?: 0
                val blocks = cur.blocks.toMutableList()
                while (blocks.size <= index) blocks.add(null)
                val b = blocks[index] ?: StreamBlock(if (e.str("kind") == "thinking") "thinking" else "text", "")
                blocks[index] = b.copy(text = b.text + (e.str("text") ?: ""))
                s.copy(streams = s.streams + (id to cur.copy(blocks = blocks)))
            }
            "speed" -> if (wsId != null) s.copy(tps = s.tps + (wsId to (e.dbl("tps") ?: 0.0))) else s
            "message" -> {
                val m = e.obj("message")?.let(Message::from) ?: return Reduction(s)
                var t = s.patchDetail(wsId) { d -> if (d.messages.any { it.id == m.id }) d else d.copy(messages = d.messages + m) }
                if (e.str("streamId") != null && wsId != null) t = t.copy(streams = t.streams - wsId)
                val count = (t.workspaces[wsId]?.messageCount ?: 0) + 1
                t.patchWs(wsId, "messageCount" to count, "updated_at" to now)
            }
            "usage" -> {
                var t = if (e.containsKey("stats")) s.patchWs(wsId, "stats" to e["stats"]) else s
                val srv = t.server
                if (srv != null && e.containsKey("today")) t = t.copy(server = ServerInfo.from(srv.raw + JsonObject(mapOf("today" to e["today"]!!))))
                t
            }
            "tool_call" -> {
                val c = e.obj("call")?.let(ToolCall::from) ?: return Reduction(s)
                s.patchDetail(wsId ?: c.workspaceId) { d -> d.copy(calls = d.calls + (c.id to c)) }
            }
            "tool_status" -> {
                val id = e.str("id") ?: return Reduction(s)
                val status = e.str("status") ?: return Reduction(s)
                s.patchDetail(wsId) { d -> d.calls[id]?.let { d.copy(calls = d.calls + (id to it.copy(status = status))) } ?: d }
            }
            "tool_output" -> {
                val id = e.str("id") ?: return Reduction(s)
                s.copy(shellOut = s.shellOut + (id to ((s.shellOut[id] ?: "") + (e.str("chunk") ?: "")).takeLast(20_000)))
            }
            "approval_request" -> {
                val a = Approval.from(e)
                effects += Effect.ApprovalArrived(a)
                val pending = (s.workspaces[a.workspaceId]?.pending ?: 0) + 1
                s.copy(approvals = s.approvals.filter { it.id != a.id } + a)
                    .patchWs(a.workspaceId, "pending" to pending)
                    .patchHelper(a.workspaceId, "pending" to pending)
            }
            "approval_resolved" -> {
                val id = e.str("id")
                val pending = maxOf(0, (s.workspaces[wsId]?.pending ?: 1) - 1)
                s.copy(approvals = s.approvals.filter { it.id != id })
                    .patchWs(wsId, "pending" to pending)
                    .patchHelper(wsId, "pending" to pending)
            }
            "pins", "file_changed" -> {
                if (wsId != null && s.details.containsKey(wsId) && type == "file_changed") effects += Effect.ReloadDetail(wsId)
                s
            }
            "helper" -> {
                val h = e.obj("helper") ?: return Reduction(s)
                val hid = h.str("id") ?: return Reduction(s)
                var t = s
                val parent = wsId?.let { s.workspaces[it] }
                if (parent != null) {
                    val list = parent.raw.arr("helpers")?.mapNotNull { it.asObj() } ?: emptyList()
                    val old = list.firstOrNull { it.str("id") == hid }
                    val merged = (list.filter { it.str("id") != hid } + ((old ?: JsonObject(emptyMap())) + h))
                        .sortedBy { Helper.from(it).createdAt }
                    t = t.patchWs(parent.id, "helpers" to merged)
                }
                val child = t.workspaces[hid]
                if (child != null) t = t.patchWs(hid, "helper_state" to h["state"], "report" to h["report"], "title" to h["title"])
                else effects += Effect.LoadWorkspace(hid)
                t
            }
            "queued" -> if (wsId != null) s.copy(queued = s.queued + (wsId to (e.int("count") ?: 0))) else s
            "plan" -> s.patchWs(wsId, "plan" to e["plan"])
            "compacted" -> {
                if (wsId != null) effects += Effect.ReloadDetail(wsId)
                val n = e.int("compacted") ?: 0
                effects += Effect.Toast(if (n > 0) "Folded $n older messages into the summary" else "Nothing older to fold", null, Effect.Tone.GOOD, wsId)
                s
            }
            "cleared" -> {
                if (wsId != null) effects += Effect.ReloadDetail(wsId)
                s.patchDetail(wsId) { it.copy(messages = emptyList(), calls = emptyMap()) }
            }
            "notify" -> {
                effects += Effect.Toast(e.str("title") ?: "Orbit", e.str("body"), Effect.Tone.INFO, wsId)
                s
            }
            "error" -> {
                val budget = e.str("kind") == "budget"
                effects += Effect.Toast(if (budget) "Budget reached" else "Something stopped the run", e.str("message"), if (budget) Effect.Tone.WARN else Effect.Tone.BAD, wsId)
                s
            }
            else -> s
        }
        return Reduction(next, effects)
    }
}
