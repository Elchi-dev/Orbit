package dev.elchi.orbit.core.net

import dev.elchi.orbit.core.crypto.B64u
import dev.elchi.orbit.core.crypto.E2e
import dev.elchi.orbit.core.crypto.FrameOpener
import dev.elchi.orbit.core.crypto.FrameSealer
import dev.elchi.orbit.core.crypto.KeyPair
import dev.elchi.orbit.core.model.OrbitJson
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.model.long
import dev.elchi.orbit.core.model.obj
import dev.elchi.orbit.core.model.str
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.IOException

/** Where a computer is: the relay, its room and its public key. */
data class Endpoint(val relay: String, val room: String, val hostKey: String) {
    val hostKeyBytes: ByteArray get() = B64u.decode(hostKey)
}

/** What the phone says about itself in `hello`. */
data class HelloInfo(val name: String, val app: String, val push: Push?) {
    sealed interface Push {
        data object Relay : Push
        data class Fcm(val token: String) : Push
    }
}

data class Welcome(val name: String, val version: String)

data class ApiResponse(val status: Int, val body: JsonElement) {
    val ok: Boolean get() = status in 200..299
    val error: String? get() = body.asObj()?.str("error")
}

/**
 * One pipe to Orbit through the relay (docs/REMOTE.md): the handshake, sealed
 * frames both ways, requests matched by id, and live events. A session is used
 * once; [OrbitClient] opens a new one after it closes.
 */
class RemoteSession(
    private val http: OkHttpClient,
    private val endpoint: Endpoint,
    private val device: KeyPair,
) {
    private var ws: WebSocket? = null
    private var sealer: FrameSealer? = null
    private var opener: FrameOpener? = null
    private val welcome = CompletableDeferred<Welcome>()
    private val pending = PendingRequests<ApiResponse>()
    private val eventChannel = Channel<JsonObject>(Channel.UNLIMITED)

    /** Completes with why the pipe ended. */
    val closed = CompletableDeferred<RemoteException>()

    /** Live events after [subscribe], in the order Orbit sent them. */
    val events: Flow<JsonObject> = eventChannel.receiveAsFlow()

    /** When the last frame came in, for noticing a dead pipe. */
    @Volatile var lastFrameAt: Long = System.currentTimeMillis()
        private set

    /** Connects, does the handshake and says hello; returns Orbit's welcome or throws [RemoteException]. */
    suspend fun open(hello: HelloInfo, code: String? = null, timeoutMs: Long = 25_000): Welcome {
        val url = "${endpoint.relay}/v1/connect?room=${endpoint.room}"
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, Listener(hello, code))
        return try {
            withTimeout(timeoutMs) { welcome.await() }
        } catch (e: TimeoutCancellationException) {
            fail(RemoteException.Timeout("The relay or Orbit didn't answer in time."))
            throw RemoteException.Timeout("The relay or Orbit didn't answer in time.")
        }
    }

    private inner class Listener(private val hello: HelloInfo, private val code: String?) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            try {
                val e = E2e.newKeyPair()
                val n = E2e.randomBytes(16)
                val k = E2e.sessionKeysPhone(e.priv, device.priv, endpoint.hostKeyBytes, n)
                sealer = FrameSealer(k.up)
                opener = FrameOpener(k.down)
                webSocket.send(jsonOf("v" to 1, "d" to B64u.encode(device.pub), "e" to B64u.encode(e.pub), "n" to B64u.encode(n)).toString())
                send(helloMessage(hello, code))
            } catch (t: Throwable) {
                fail(RemoteException.Crypto("Couldn't start an encrypted session.", t))
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            lastFrameAt = System.currentTimeMillis()
            val o = opener ?: return
            val msg = try {
                OrbitJson.parseToJsonElement(o.open(bytes.toByteArray())) as? JsonObject ?: return
            } catch (t: Throwable) {
                fail(RemoteException.Crypto("A message from Orbit didn't open. The connection was closed to be safe.", t))
                return
            }
            handle(msg)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            // nothing comes in clear inside a pipe after the handshake
            lastFrameAt = System.currentTimeMillis()
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            fail(closeError(code, reason))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            fail(closeError(code, reason))
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val status = response?.code
            fail(
                when {
                    status == 404 || status == 400 -> RemoteException.Network("The relay doesn't know this address. Check the relay in Orbit, Settings, Remote.")
                    status == 429 -> RemoteException.Network("The relay is busy. Trying again shortly.")
                    status != null -> RemoteException.Network("The relay answered ${status}.")
                    t is IOException -> RemoteException.Network("Can't reach the relay. ${t.message ?: ""}".trim(), t)
                    else -> RemoteException.Network("Lost the connection.", t)
                },
            )
        }
    }

    internal fun handle(msg: JsonObject) {
        when (msg.str("t")) {
            "welcome" -> welcome.complete(Welcome(msg.str("name") ?: "Orbit", msg.str("version") ?: ""))
            "denied" -> fail(RemoteException.Denied(msg.str("reason") ?: "This phone is not paired with this computer."))
            "res" -> {
                val id = msg.long("id") ?: return
                pending.complete(id, ApiResponse(msg.long("status")?.toInt() ?: 0, msg["body"] ?: JsonNull))
            }
            "ev" -> msg.obj("e")?.let { eventChannel.trySend(it) }
            "ping" -> send(jsonOf("t" to "pong"))
            else -> {}
        }
    }

    private fun closeError(code: Int, reason: String): RemoteException = when {
        code == 4404 -> RemoteException.NoHost()
        reason == "denied" -> RemoteException.Denied("This phone is not paired with this computer.")
        reason == "not paired" || reason == "removed" -> RemoteException.Denied("This phone is no longer paired with this computer.")
        else -> RemoteException.Closed(code, if (reason.isBlank()) "The connection closed." else "The connection closed: $reason")
    }

    private fun fail(e: RemoteException, cancel: Boolean = true) {
        // the first reason wins: a denied before the close says more than the close
        if (closed.complete(e)) {
            welcome.completeExceptionally(e)
            pending.failAll(e)
            eventChannel.close()
            if (cancel) ws?.cancel()
        }
    }

    val isOpen: Boolean get() = welcome.isCompleted && !welcome.isCancelled && !closed.isCompleted

    /** Seals and sends one message; false if the pipe is gone. */
    fun send(msg: JsonObject): Boolean {
        val s = sealer ?: return false
        val w = ws ?: return false
        if (closed.isCompleted) return false
        return w.send(s.seal(msg.toString()).toByteString())
    }

    /** Calls Orbit's HTTP API through the pipe. */
    suspend fun request(method: String, path: String, body: JsonElement? = null, timeoutMs: Long = 20_000): ApiResponse {
        if (closed.isCompleted) throw closed.getCompleted()
        val (id, d) = pending.register()
        if (!send(jsonOf("t" to "req", "id" to id, "method" to method, "path" to path, "body" to (body ?: JsonNull)))) {
            pending.complete(id, ApiResponse(0, JsonNull))
            throw RemoteException.Offline()
        }
        return pending.await(id, d, timeoutMs)
    }

    fun subscribe() = send(jsonOf("t" to "sub"))

    /** An interface message: send, approval, stop, kill. */
    fun message(m: JsonObject) = send(jsonOf("t" to "msg", "m" to m))

    fun ping() = send(jsonOf("t" to "ping"))

    /** Closes after what was already sent has gone out. */
    fun close() {
        ws?.close(1000, null)
        fail(RemoteException.Closed(1000, "Closed."), cancel = false)
    }

    companion object {
        fun helloMessage(hello: HelloInfo, code: String?): JsonObject {
            val push = when (val p = hello.push) {
                null -> null
                HelloInfo.Push.Relay -> jsonOf("kind" to "relay")
                is HelloInfo.Push.Fcm -> jsonOf("kind" to "fcm", "token" to p.token)
            }
            val pairs = mutableListOf<Pair<String, Any?>>("t" to "hello")
            if (code != null) pairs += "code" to code
            pairs += "name" to hello.name
            pairs += "app" to hello.app
            if (push != null) pairs += "push" to push
            return jsonOf(*pairs.toTypedArray())
        }
    }
}
