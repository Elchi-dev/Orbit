package dev.elchi.orbit.core.state

import dev.elchi.orbit.core.model.Detail
import dev.elchi.orbit.core.model.OrbitJson
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.model.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReducerTest {
    /** A run recorded from a real Orbit in mock mode: a message, an approval, a command, the answer. */
    private val events: List<JsonObject> = (OrbitJson.parseToJsonElement(javaClass.getResource("/events-run.json")!!.readText()) as JsonArray).map { it as JsonObject }

    @Test fun recordedRun() {
        val wsJson = events.first { it.str("type") == "workspace" }["workspace"] as JsonObject
        val ws = Workspace.from(wsJson)
        // the phone had the workspace open, so its detail is loaded
        var s = OrbitState(details = mapOf(ws.id to Detail.EMPTY))
        val effects = mutableListOf<Effect>()
        var sawStreamText = ""
        var sawPendingWhileWaiting = false
        var oriWhileWaiting: OriPose? = null
        for (e in events) {
            val r = Reducer.reduce(s, e, now = 1_000)
            s = r.state
            effects += r.effects
            s.streams[ws.id]?.blocks?.filterNotNull()?.firstOrNull { it.type == "text" }?.let { sawStreamText = it.text }
            if (e.str("type") == "approval_request") {
                sawPendingWhileWaiting = s.workspaces[ws.id]!!.needsYou && s.approvals.size == 1
                oriWhileWaiting = OriLogic.status(s.workspaces[ws.id]!!, s.details[ws.id], s.streams[ws.id], s.ended[ws.id], 1_000).pose
            }
        }
        assertEquals("Phone test", s.server?.let { s.workspaces[ws.id]!!.title })
        assertTrue("the hello event filled the server", s.server!!.mock)
        assertTrue(sawPendingWhileWaiting)
        assertEquals(OriPose.NEEDS, oriWhileWaiting)
        assertTrue("deltas built the text as it streamed: $sawStreamText", sawStreamText.isNotEmpty())

        val w = s.workspaces[ws.id]!!
        assertFalse(w.running)
        assertEquals(0, w.pending)
        assertTrue(s.approvals.isEmpty())
        assertNull("the stream ends with its message", s.streams[ws.id])
        assertEquals("done", s.ended[ws.id]?.reason)

        val d = s.details[ws.id]!!
        assertEquals(4, d.messages.size)
        val turns = Conversation.turns(d.messages)
        assertEquals(listOf("user", "assistant"), turns.map { it.role })
        val call = d.calls.values.single()
        assertEquals("bash", call.name)
        assertEquals("done", call.status)
        assertEquals("user", call.decidedBy)
        assertEquals("rm -rf ./old-snapshots/2025-*", call.inputJson.str("command"))
        val items = Conversation.prepare(turns[1].blocks).items
        assertTrue(items.first() is Item.Thinking)
        assertTrue(items.any { it is Item.Tool && it.name == "bash" })
        assertTrue(items.last() is Item.Text)

        assertTrue(effects.any { it is Effect.ApprovalArrived })
        assertTrue(effects.contains(Effect.TurnEnded(ws.id, "done")))
        assertEquals(OriPose.DONE, OriLogic.status(w, d, null, s.ended[ws.id], 2_000).pose)
    }

    private fun ws(id: String, vararg extra: Pair<String, Any?>) = jsonOf("id" to id, "title" to id, "updated_at" to 0, *extra)

    @Test fun rawRowsAndHelpers() {
        var s = Reducer.withWorkspaces(OrbitState(), listOf(ws("w_p", "helpers" to listOf(jsonOf("id" to "w_h", "title" to "Check", "state" to "running", "created_at" to 1))), ws("w_h", "parent_id" to "w_p")))
        assertEquals(listOf("w_p"), s.planets.map { it.id })
        // agent.ts sends the database row: style as a JSON string, plan as a string
        s = Reducer.reduce(s, jsonOf("type" to "workspace", "workspace" to jsonOf("id" to "w_p", "style" to """{"color":"#7A64E0","surface":"lava","rings":1}""", "plan" to "[]"))).state
        val p = s.workspaces["w_p"]!!
        assertEquals(0xFF7A64E0, p.style.color)
        assertEquals("lava", p.style.surface)
        assertTrue(p.style.rings)
        assertEquals(1, p.helpers.size)

        // a helper's run and its question show on the parent
        s = Reducer.reduce(s, jsonOf("type" to "turn_start", "workspaceId" to "w_h")).state
        assertTrue(s.workspaces["w_p"]!!.helpers.single().running)
        assertTrue(s.workspaces["w_p"]!!.busy)
        s = Reducer.reduce(s, jsonOf("type" to "approval_request", "id" to "a1", "workspaceId" to "w_h", "parentId" to "w_p", "name" to "bash", "subject" to "ls")).state
        assertTrue(s.workspaces["w_p"]!!.needsYou)
        assertEquals(1, s.approvalsFor("w_p").size)
        s = Reducer.reduce(s, jsonOf("type" to "approval_resolved", "id" to "a1", "workspaceId" to "w_h")).state
        assertFalse(s.workspaces["w_p"]!!.needsYou)

        // a helper event merges into the list and asks to load a child it doesn't know
        val r = Reducer.reduce(s, jsonOf("type" to "helper", "workspaceId" to "w_p", "helper" to jsonOf("id" to "w_new", "title" to "New", "state" to "running", "created_at" to 0)))
        assertEquals(listOf("w_new", "w_h"), r.state.workspaces["w_p"]!!.helpers.map { it.id })
        assertTrue(r.effects.contains(Effect.LoadWorkspace("w_new")))

        s = Reducer.reduce(r.state, jsonOf("type" to "plan", "workspaceId" to "w_p", "plan" to listOf(jsonOf("text" to "a", "status" to "done"), jsonOf("text" to "b", "status" to "doing")))).state
        assertEquals(2, s.workspaces["w_p"]!!.plan.size)
        s = Reducer.reduce(s, jsonOf("type" to "workspace_deleted", "workspaceId" to "w_p")).state
        assertNull(s.workspaces["w_p"])
    }

    @Test fun stateEventsMergeAndErrorsBecomeToasts() {
        var s = Reducer.reduce(OrbitState(), jsonOf("type" to "hello", "state" to jsonOf("version" to "0.5.0", "approvals" to emptyList<Any>(), "today" to jsonOf("cost" to 1.5)))).state
        s = Reducer.reduce(s, jsonOf("type" to "state", "mock" to true)).state
        assertEquals("0.5.0", s.server!!.version)
        assertTrue(s.server!!.mock)
        assertEquals(1.5, s.server!!.todayCost, 0.0)
        val r = Reducer.reduce(s, jsonOf("type" to "error", "workspaceId" to "w", "message" to "Over budget", "kind" to "budget"))
        assertEquals(Effect.Toast("Budget reached", "Over budget", Effect.Tone.WARN, "w"), r.effects.single())
        // events for workspaces the phone doesn't hold are harmless
        val quiet = Reducer.reduce(s, jsonOf("type" to "delta", "workspaceId" to "w_x", "index" to 0, "text" to "hi"))
        assertEquals(s, quiet.state)
        assertEquals(s, Reducer.reduce(s, jsonOf("type" to "something_new")).state)
    }
}
