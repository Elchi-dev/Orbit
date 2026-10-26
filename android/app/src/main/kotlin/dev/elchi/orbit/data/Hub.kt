package dev.elchi.orbit.data

import android.content.Context
import dev.elchi.orbit.BuildConfig
import dev.elchi.orbit.core.crypto.KeyPair
import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.model.JsonObjectOrEmpty
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.model.asArr
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.net.ApiResponse
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.net.HelloInfo
import dev.elchi.orbit.core.net.OrbitClient
import dev.elchi.orbit.core.net.RemoteException
import dev.elchi.orbit.core.net.RemoteSession
import dev.elchi.orbit.core.net.Welcome
import dev.elchi.orbit.core.net.withSession
import dev.elchi.orbit.core.pairing.PairingLink
import dev.elchi.orbit.core.state.Effect
import dev.elchi.orbit.core.state.OrbitState
import dev.elchi.orbit.core.state.Reducer
import dev.elchi.orbit.push.Push
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Something to tell the person, shown as a toast with Ori. */
data class Notice(val title: String, val body: String? = null, val tone: Effect.Tone = Effect.Tone.INFO, val wsId: String? = null)

/**
 * The live connection to one computer and everything known about it: the
 * reducer's state, kept up to date from events and reloaded after reconnects.
 */
class Connection(
    val computer: Computer,
    private val client: OrbitClient,
    private val scope: CoroutineScope,
    private val notices: MutableSharedFlow<Notice>,
) {
    private val _state = MutableStateFlow(OrbitState())
    val state: StateFlow<OrbitState> = _state.asStateFlow()
    val conn: StateFlow<ConnState> = client.state

    private val _arrivals = MutableSharedFlow<Approval>(extraBufferCapacity = 16)

    /** Approvals as they come in, for a little buzz. */
    val arrivals: SharedFlow<Approval> = _arrivals.asSharedFlow()

    /** The workspace on screen, reloaded after a reconnect. */
    @Volatile var openWorkspace: String? = null

    init {
        scope.launch {
            client.events.collect { e ->
                val r = Reducer.reduce(_state.value, e)
                _state.value = r.state
                for (fx in r.effects) handle(fx)
            }
        }
        scope.launch {
            client.state.map { it is ConnState.Online }.distinctUntilChanged().collect { online -> if (online) refresh() }
        }
    }

    private fun handle(fx: Effect) {
        when (fx) {
            is Effect.ReloadDetail -> scope.launch { loadDetail(fx.wsId) }
            is Effect.LoadWorkspace -> scope.launch { loadDetail(fx.wsId, keepDetail = false) }
            Effect.ReloadServer -> scope.launch { loadServer() }
            is Effect.Toast -> notices.tryEmit(Notice(fx.title, fx.body, fx.tone, fx.wsId))
            is Effect.ApprovalArrived -> _arrivals.tryEmit(fx.approval)
            is Effect.TurnEnded -> {}
        }
    }

    fun start() = client.start()
    fun stop() = client.stop()
    fun kick() = client.kick()

    /** Loads the server state and the workspace list, and the open workspace. */
    suspend fun refresh(): Boolean {
        val a = runCatching { loadServer(); loadWorkspaces() }.isSuccess
        openWorkspace?.let { runCatching { loadDetail(it) } }
        return a
    }

    private suspend fun loadServer() {
        val r = client.get("/api/state")
        r.body.asObj()?.takeIf { r.ok }?.let { body -> _state.update { Reducer.withServer(it, body) } }
    }

    private suspend fun loadWorkspaces() {
        val r = client.get("/api/workspaces")
        val list = r.body.asArr()?.mapNotNull { it.asObj() } ?: return
        if (r.ok) _state.update { Reducer.withWorkspaces(it, list) }
    }

    /** Fetches one workspace with its conversation. */
    suspend fun loadDetail(id: String, keepDetail: Boolean = true): Boolean {
        val r = runCatching { client.get("/api/workspaces/$id") }.getOrNull() ?: return false
        val body = r.body.asObj() ?: return false
        if (r.status == 404) {
            _state.update { it.copy(workspaces = it.workspaces - id, details = it.details - id) }
            return false
        }
        if (!r.ok) return false
        _state.update { s ->
            val next = Reducer.withDetail(s, body)
            if (keepDetail) next else next.copy(details = s.details)
        }
        return true
    }

    private suspend fun call(method: String, path: String, body: JsonElement? = null): Result<ApiResponse> = runCatching {
        val r = client.request(method, path, body)
        if (!r.ok) throw IllegalStateException(r.error ?: "Orbit answered ${r.status}.")
        r
    }

    suspend fun createWorkspace(profile: String?, mode: String?): Result<Workspace> = call(
        "POST", "/api/workspaces",
        jsonOf("profile" to profile, "mode" to mode).let { o -> JsonObject(o.filterValues { it !is kotlinx.serialization.json.JsonNull }) },
    ).map { r ->
        val w = Workspace.from(r.body.asObj() ?: JsonObjectOrEmpty)
        _state.update { it.copy(workspaces = it.workspaces + (w.id to w)) }
        w
    }

    suspend fun patchWorkspace(id: String, vararg fields: Pair<String, Any?>): Result<Unit> = call("PATCH", "/api/workspaces/$id", jsonOf(*fields)).map { r ->
        r.body.asObj()?.let { w -> _state.update { s -> s.copy(workspaces = s.workspaces + (id to Workspace.from(w))) } }
    }

    suspend fun deleteWorkspace(id: String): Result<Unit> = call("DELETE", "/api/workspaces/$id").map { }

    /** Sends a message; while a run goes on, it joins at the next step. */
    fun send(wsId: String, text: String, effort: String?, web: Boolean?): Boolean =
        client.message(jsonOf("type" to "send", "workspaceId" to wsId, "text" to text, "effort" to effort, "web" to web).let { o -> JsonObject(o.filterValues { it !is kotlinx.serialization.json.JsonNull }) })

    fun decide(a: Approval, decision: String, pattern: String? = null, note: String? = null): Boolean {
        val m = mutableListOf<Pair<String, Any?>>("type" to "approval", "id" to a.id, "decision" to decision)
        if (decision == "always" && !pattern.isNullOrBlank()) m += "pattern" to pattern
        if (decision == "deny" && !note.isNullOrBlank()) m += "note" to "You denied it: $note"
        val ok = client.message(jsonOf(*m.toTypedArray()))
        // answer right away on screen; the event confirms it
        if (ok) _state.update { s -> s.copy(approvals = s.approvals.filter { it.id != a.id }) }
        return ok
    }

    fun stopRun(wsId: String) = client.message(jsonOf("type" to "stop", "workspaceId" to wsId))
    fun kill(wsId: String) = client.message(jsonOf("type" to "kill", "workspaceId" to wsId))

    internal fun close() {
        client.stop()
        scope.cancel()
    }
}

/**
 * The app's one place for pairings, connections and settings. It keeps a live
 * connection to the active computer while the app is in front.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Hub(private val context: Context) {
    val store = Store(context)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    val computers: StateFlow<List<Computer>> = store.computers.stateIn(scope, SharingStarted.Eagerly, emptyList())
    val settings: StateFlow<AppSettings> = store.settings.stateIn(scope, SharingStarted.Eagerly, AppSettings())
    private val _loaded = MutableStateFlow(false)

    /** True once the stored pairings have been read. */
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    private val _notices = MutableSharedFlow<Notice>(extraBufferCapacity = 16)
    val notices: SharedFlow<Notice> = _notices.asSharedFlow()

    private val _connection = MutableStateFlow<Connection?>(null)

    /** The connection to the active computer, or null when none is paired. */
    val connection: StateFlow<Connection?> = _connection.asStateFlow()

    @Volatile private var foreground = false
    private var device: KeyPair? = null

    init {
        scope.launch {
            store.computers.first()
            _loaded.value = true
        }
        scope.launch {
            combine(computers, settings.map { it.activeRoom }.distinctUntilChanged()) { list, room -> list.firstOrNull { it.room == room } ?: list.firstOrNull() }
                .distinctUntilChanged()
                .collect { c -> switchTo(c) }
        }
    }

    private suspend fun switchTo(c: Computer?) {
        _connection.value?.close()
        _connection.value = null
        if (c == null) return
        val key = device ?: store.deviceKey(create = false) ?: return
        device = key
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val conn = Connection(c, OrbitClient(http, c.endpoint, key, { helloInfo() }, s), s, _notices)
        _connection.value = conn
        if (foreground) conn.start()
    }

    fun helloInfo(): HelloInfo {
        val st = settings.value
        val push: HelloInfo.Push = if (st.alertMode == AlertMode.FIREBASE && Push.available && st.fcmToken != null) HelloInfo.Push.Fcm(st.fcmToken) else HelloInfo.Push.Relay
        return HelloInfo(st.phoneName, BuildConfig.VERSION_NAME, push)
    }

    suspend fun deviceKey(): KeyPair? = device ?: store.deviceKey(create = false)?.also { device = it }

    fun onForeground() {
        foreground = true
        _connection.value?.let { it.start(); it.kick() }
    }

    fun onBackground() {
        foreground = false
        _connection.value?.stop()
    }

    fun networkBack() {
        _connection.value?.kick()
    }

    /**
     * Pairs with the computer of [link]: a session with the code, then saves
     * the pairing. Makes the device key on first use.
     */
    suspend fun pair(link: PairingLink): Result<Welcome> = withContext(Dispatchers.IO) {
        runCatching {
            val key = device ?: store.deviceKey(create = true)!!
            device = key
            val s = RemoteSession(http, dev.elchi.orbit.core.net.Endpoint(link.relay, link.room, link.hostKey), key)
            val w = try {
                s.open(helloInfo(), link.code)
            } finally {
                s.close()
            }
            store.saveComputer(Computer(link.room, link.relay, link.hostKey, w.name.ifBlank { link.name }, addedAt = System.currentTimeMillis()))
            w
        }.recoverCatching { e -> throw IllegalStateException(pairError(e), e) }
    }

    private fun pairError(e: Throwable): String = when (e) {
        is RemoteException.Denied -> e.message ?: "Orbit said no. Show a new code in Orbit and scan it again."
        is RemoteException.NoHost -> "Orbit isn't connected to the relay right now. Check Settings, Your phone on the computer."
        is RemoteException -> e.message ?: "Couldn't reach Orbit."
        else -> e.message ?: "Couldn't pair."
    }

    suspend fun setActive(room: String) = store.setActive(room)
    suspend fun rename(room: String, label: String?) = store.rename(room, label)
    suspend fun forget(room: String) = store.forget(room)

    /**
     * Tells every paired computer how this phone gets alerts now (after the
     * mode or the Firebase token changed). Each gets a short session.
     */
    fun announcePush() {
        scope.launch(Dispatchers.IO) {
            val key = deviceKey() ?: return@launch
            for (c in computers.value) {
                if (_connection.value?.computer?.room == c.room && _connection.value?.conn?.value is ConnState.Online) {
                    // the open session said hello with the old push; a fresh one says the new
                    _connection.value?.let { it.stop(); if (foreground) it.start() }
                    continue
                }
                runCatching { withSession(http, c.endpoint, key, helloInfo()) { } }
            }
        }
    }

    fun notice(n: Notice) {
        _notices.tryEmit(n)
    }

    fun shutdown() {
        scope.cancel()
    }
}
