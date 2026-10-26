package dev.elchi.orbit.core

import dev.elchi.orbit.core.crypto.E2e
import dev.elchi.orbit.core.model.OrbitJson
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.model.str
import dev.elchi.orbit.core.net.Alert
import dev.elchi.orbit.core.net.AlertWaiter
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.net.Endpoint
import dev.elchi.orbit.core.net.HelloInfo
import dev.elchi.orbit.core.net.OrbitClient
import dev.elchi.orbit.core.net.RemoteException
import dev.elchi.orbit.core.net.RemoteSession
import dev.elchi.orbit.core.net.withSession
import dev.elchi.orbit.core.pairing.PairingLink
import dev.elchi.orbit.core.state.OrbitState
import dev.elchi.orbit.core.state.Reducer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * Pairs with a real Orbit (ORBIT_MOCK=1) through a real relay and uses the API
 * the way the app does. Skipped unless -Porbit.it.link is given; see android/README.md.
 */
class IntegrationTest {
    private val link = System.getProperty("orbit.it.link").orEmpty()
    private val orbitUrl = System.getProperty("orbit.it.url").orEmpty()
    private val cookie = System.getProperty("orbit.it.cookie").orEmpty()
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private fun log(s: String) = println("[it] $s")

    @Test fun pairUseAndForget() = runBlocking {
        assumeTrue("set -Porbit.it.link to run", link.isNotEmpty())
        val pairing = PairingLink.parse(link)
        val endpoint = Endpoint(pairing.relay, pairing.room, pairing.hostKey)
        val device = E2e.newKeyPair()
        val hello = HelloInfo("Integration phone", "it", HelloInfo.Push.Relay)

        // a phone Orbit doesn't know is turned away without a code
        val stranger = runCatching { withSession(http, endpoint, E2e.newKeyPair(), hello) { } }.exceptionOrNull()
        assertTrue("stranger: $stranger", stranger is RemoteException.Denied)
        log("unknown phone denied: ${stranger?.message}")

        // first session: pairs with the code
        val welcome = RemoteSession(http, endpoint, device).let { s -> try { s.open(hello, pairing.code) } finally { s.close() } }
        assertEquals(pairing.name, welcome.name)
        log("paired with ${welcome.name} ${welcome.version}")

        // the code was used up: another phone can't reuse it
        val reuse = runCatching { RemoteSession(http, endpoint, E2e.newKeyPair()).let { s -> try { s.open(hello, pairing.code) } finally { s.close() } } }.exceptionOrNull()
        assertTrue("reuse: $reuse", reuse is RemoteException.Denied)

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val client = OrbitClient(http, endpoint, device, { hello }, scope)
        val events = Collections.synchronizedList(mutableListOf<JsonObject>())
        var state = OrbitState()
        val stateLock = Any()
        scope.launch { client.events.collect { e -> events += e; synchronized(stateLock) { state = Reducer.reduce(state, e).state } } }
        client.start()
        withTimeout(20_000) { client.state.first { it is ConnState.Online } }
        log("client online")

        // the API through the pipe
        val st = client.get("/api/state")
        assertEquals(200, st.status)
        synchronized(stateLock) { state = Reducer.withServer(state, st.body.asObj()!!) }
        val list = client.get("/api/workspaces")
        assertEquals(200, list.status)
        assertTrue(list.body is JsonArray)
        synchronized(stateLock) { state = Reducer.withWorkspaces(state, (list.body as JsonArray).mapNotNull { it.asObj() }) }
        assertEquals(403, client.get("/api/remote").status)
        assertEquals(404, client.get("/api/workspaces/w_nope").status)

        // alerts through the relay
        val alerts = Collections.synchronizedList(mutableListOf<Alert>())
        val waiter = AlertWaiter(http, endpoint, device, scope) { alerts += it; log("alert $it") }
        waiter.start()
        withTimeout(10_000) { waiter.state.first { it is AlertWaiter.State.Listening } }

        // make a workspace and start it, as the launch field does
        val created = client.request("POST", "/api/workspaces", jsonOf("title" to "Phone test", "mode" to "manual"))
        assertEquals(200, created.status)
        val wsId = created.body.asObj()!!.str("id")!!
        val detail = client.get("/api/workspaces/$wsId")
        synchronized(stateLock) { state = Reducer.withDetail(state, detail.body.asObj()!!) }
        assertTrue(client.message(jsonOf("type" to "send", "workspaceId" to wsId, "text" to "remove the old snapshots")))
        log("sent the first message to $wsId")

        // the mock model asks to rm -rf: an approval arrives live
        val approval = withTimeout(30_000) {
            while (true) {
                val a = synchronized(stateLock) { state.approvals.firstOrNull { it.workspaceId == wsId } }
                if (a != null) return@withTimeout a
                delay(100)
            }
            @Suppress("UNREACHABLE_CODE") null
        }!!
        log("approval: ${approval.name} ${approval.subject}")
        assertEquals("bash", approval.name)
        assertTrue(synchronized(stateLock) { state.workspaces[wsId]!!.needsYou })

        // Orbit alerts paired phones after a short pause
        withTimeout(20_000) { while (alerts.none { it.t == "needs" }) delay(100) }
        val needs = alerts.first { it.t == "needs" }
        assertEquals(wsId, needs.ws)
        assertEquals("Phone test", needs.title)

        // allow it from the phone
        assertTrue(client.message(jsonOf("type" to "approval", "id" to approval.id, "decision" to "allow")))
        withTimeout(30_000) { while (synchronized(stateLock) { state.workspaces[wsId]?.running != false || state.approvals.isNotEmpty() }) delay(100) }
        withTimeout(10_000) { while (alerts.none { it.t == "clear" }) delay(100) }
        log("run finished, clear alert came")

        val after = client.get("/api/workspaces/$wsId")
        synchronized(stateLock) { state = Reducer.withDetail(state, after.body.asObj()!!) }
        val calls = synchronized(stateLock) { state.details[wsId]!!.calls.values }
        assertTrue(calls.any { it.name == "bash" && it.decidedBy == "user" })
        assertTrue(synchronized(stateLock) { state.details[wsId]!!.messages.size } >= 3)

        // the events of this run are the reducer test's fixture
        File(System.getProperty("orbit.it.out")).apply { mkdirs() }.resolve("events.json")
            .writeText(JsonArray(events.toList()).toString())
        log("recorded ${events.size} events")

        // a request that Orbit answers slowly or never times out cleanly
        assertTrue(runCatching { client.request("GET", "/api/state", timeoutMs = 1) }.exceptionOrNull() is RemoteException.Timeout)

        // forgetting the phone in Orbit is noticed as "no longer paired"
        if (orbitUrl.isNotEmpty() && cookie.isNotEmpty()) {
            val id = E2e.deviceIdOf(device.pub)
            val r = http.newCall(
                Request.Builder().url("$orbitUrl/api/remote/devices/$id").delete()
                    .header("Cookie", "orbit_token=$cookie").header("Origin", orbitUrl).build(),
            ).execute()
            assertEquals(200, r.code)
            r.close()
            val unpaired = withTimeout(30_000) { client.state.first { it is ConnState.Unpaired } }
            log("after forgetting: $unpaired")
            assertNotNull(unpaired)
        }

        waiter.stop()
        client.stop()
        scope.cancel()
    }
}

@Suppress("unused")
private fun JsonObject.pretty() = OrbitJson.encodeToString(JsonObject.serializer(), this)
