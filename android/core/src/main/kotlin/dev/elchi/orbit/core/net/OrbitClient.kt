package dev.elchi.orbit.core.net

import dev.elchi.orbit.core.crypto.KeyPair
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient

/** How the phone's connection to one Orbit is doing. */
sealed interface ConnState {
    data object Idle : ConnState
    data class Connecting(val attempt: Int) : ConnState
    data class Online(val welcome: Welcome) : ConnState
    data class Offline(val reason: String, val retryAt: Long) : ConnState

    /** Orbit no longer knows this phone; only pairing again helps. */
    data class Unpaired(val reason: String) : ConnState
}

/**
 * Keeps a session to one Orbit open: connects, subscribes to live events,
 * pings every 25 seconds, and reconnects with backoff when the pipe drops.
 */
class OrbitClient(
    private val http: OkHttpClient,
    val endpoint: Endpoint,
    private val device: KeyPair,
    private val hello: () -> HelloInfo,
    private val scope: CoroutineScope,
    private val pingEveryMs: Long = 25_000,
    private val deadAfterMs: Long = 70_000,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow<ConnState>(ConnState.Idle)
    val state: StateFlow<ConnState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<JsonObject>(extraBufferCapacity = 512, onBufferOverflow = BufferOverflow.SUSPEND)

    /** Live events from whichever session is open. */
    val events: SharedFlow<JsonObject> = _events.asSharedFlow()

    @Volatile private var session: RemoteSession? = null
    private var loop: Job? = null
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val backoff = Backoff()

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch { run() }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        session?.close()
        session = null
        _state.value = ConnState.Idle
    }

    /** Try again now instead of waiting out the backoff (the network came back, the app came to the front). */
    fun kick() {
        backoff.reset()
        wake.trySend(Unit)
        if (loop?.isActive != true && _state.value !is ConnState.Unpaired) start()
    }

    private suspend fun run() {
        var attempt = 0
        while (scope.isActive) {
            attempt++
            _state.value = ConnState.Connecting(attempt)
            val s = RemoteSession(http, endpoint, device)
            session = s
            val reason: String = try {
                val w = s.open(hello())
                backoff.reset()
                attempt = 0
                s.subscribe()
                _state.value = ConnState.Online(w)
                val forward = scope.launch { s.events.collect { _events.emit(it) } }
                val pinger = scope.launch {
                    while (isActive) {
                        delay(pingEveryMs)
                        if (clock() - s.lastFrameAt > deadAfterMs) {
                            s.close()
                            break
                        }
                        s.ping()
                    }
                }
                val why = s.closed.await()
                pinger.cancel()
                forward.join()
                if (why is RemoteException.Denied) {
                    _state.value = ConnState.Unpaired(why.message ?: "This phone is no longer paired.")
                    return
                }
                why.message ?: "Lost the connection."
            } catch (e: RemoteException.Denied) {
                _state.value = ConnState.Unpaired(e.message ?: "This phone is no longer paired.")
                return
            } catch (e: RemoteException) {
                e.message ?: "Lost the connection."
            } finally {
                s.close()
                if (session === s) session = null
            }
            val wait = backoff.next()
            _state.value = ConnState.Offline(reason, clock() + wait)
            select {
                wake.onReceive {}
                onTimeout(wait) {}
            }
        }
    }

    /** The open session, waiting up to [waitMs] for one. */
    private suspend fun ready(waitMs: Long): RemoteSession {
        session?.takeIf { it.isOpen }?.let { return it }
        if (_state.value is ConnState.Offline) kick()
        withTimeoutOrNull(waitMs) { state.first { it is ConnState.Online || it is ConnState.Unpaired } }
        return session?.takeIf { it.isOpen } ?: throw RemoteException.Offline()
    }

    suspend fun request(method: String, path: String, body: JsonElement? = null, timeoutMs: Long = 20_000): ApiResponse =
        ready(timeoutMs).request(method, path, body, timeoutMs)

    suspend fun get(path: String) = request("GET", path)

    /** Sends an interface message (send, approval, stop, kill); false when offline. */
    fun message(m: JsonObject): Boolean = session?.takeIf { it.isOpen }?.message(m) ?: false
}
