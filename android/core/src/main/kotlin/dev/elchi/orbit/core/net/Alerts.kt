package dev.elchi.orbit.core.net

import dev.elchi.orbit.core.crypto.B64u
import dev.elchi.orbit.core.crypto.E2e
import dev.elchi.orbit.core.crypto.KeyPair
import dev.elchi.orbit.core.model.OrbitJson
import dev.elchi.orbit.core.model.int
import dev.elchi.orbit.core.model.long
import dev.elchi.orbit.core.model.str
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

/** A sealed alert, opened (docs/REMOTE.md, Alerts). It says that something needs you, never what. */
data class Alert(val t: String, val ws: String?, val title: String?, val count: Int, val at: Long) {
    companion object {
        fun parse(json: String): Alert {
            val o = OrbitJson.parseToJsonElement(json) as? JsonObject ?: throw IllegalArgumentException("not an alert")
            val t = o.str("t") ?: throw IllegalArgumentException("not an alert")
            return Alert(t, o.str("ws"), o.str("title"), o.int("count") ?: 0, o.long("at") ?: 0)
        }

        /** Opens a frame from the relay or Firebase with the phone's key for that computer. Throws if it doesn't open. */
        fun open(devicePriv: ByteArray, hostKey: ByteArray, frame: ByteArray): Alert =
            parse(E2e.openAlert(E2e.alertKeyPhone(devicePriv, hostKey), frame))

        /** The same for Firebase, which carries the frame as base64url. */
        fun openBase64(devicePriv: ByteArray, hostKey: ByteArray, frame: String): Alert = open(devicePriv, hostKey, B64u.decode(frame))
    }
}

/**
 * The phone's alert socket for one computer: `/v1/wait?room&device`. Reconnects
 * with backoff; [kick] tries at once (the network came back).
 */
class AlertWaiter(
    private val http: OkHttpClient,
    private val endpoint: Endpoint,
    private val device: KeyPair,
    private val scope: CoroutineScope,
    private val onAlert: (Alert) -> Unit,
) {
    sealed interface State {
        data object Idle : State
        data object Connecting : State
        data object Listening : State
        data class Waiting(val reason: String, val retryAt: Long) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val backoff = Backoff(startMs = 2000, maxMs = 5 * 60_000)
    private var job: Job? = null
    @Volatile private var socket: WebSocket? = null

    private val alertKey by lazy { E2e.alertKeyPhone(device.priv, endpoint.hostKeyBytes) }

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch { run() }
    }

    fun stop() {
        job?.cancel()
        job = null
        socket?.cancel()
        _state.value = State.Idle
    }

    fun kick() {
        backoff.reset()
        wake.trySend(Unit)
    }

    private suspend fun run() {
        val deviceId = E2e.deviceIdOf(device.pub)
        while (scope.isActive) {
            _state.value = State.Connecting
            val ended = CompletableDeferred<String>()
            val req = Request.Builder().url("${endpoint.relay}/v1/wait?room=${endpoint.room}&device=$deviceId").build()
            val ws = http.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    backoff.reset()
                    _state.value = State.Listening
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    val alert = runCatching { Alert.parse(E2e.openAlert(alertKey, bytes.toByteArray())) }.getOrNull() ?: return
                    onAlert(alert)
                }

                // the relay's {"type":"ping"} text frames need no answer
                override fun onMessage(webSocket: WebSocket, text: String) {}

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                    ended.complete(reason.ifBlank { "The relay closed the alert connection." })
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    ended.complete(reason.ifBlank { "The relay closed the alert connection." })
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    ended.complete(if (response != null) "The relay answered ${response.code}." else "Can't reach the relay.")
                }
            })
            socket = ws
            val reason = try {
                ended.await()
            } finally {
                ws.cancel()
            }
            val wait = backoff.next()
            _state.value = State.Waiting(reason, System.currentTimeMillis() + wait)
            select {
                wake.onReceive {}
                onTimeout(wait) {}
            }
        }
    }
}

/** Opens a session just long enough for [block], for work done while the app is closed (an Allow from a notification). */
suspend fun <T> withSession(http: OkHttpClient, endpoint: Endpoint, device: KeyPair, hello: HelloInfo, block: suspend (RemoteSession) -> T): T {
    val s = RemoteSession(http, endpoint, device)
    try {
        s.open(hello)
        return block(s)
    } finally {
        s.close()
    }
}
