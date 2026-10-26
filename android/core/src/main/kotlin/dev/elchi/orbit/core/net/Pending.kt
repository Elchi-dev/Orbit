package dev.elchi.orbit.core.net

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Requests waiting for their answers, matched by id. Ids start at 1 and only
 * grow within a session; an answer for an unknown id (late, after a timeout)
 * is dropped.
 */
class PendingRequests<T> {
    private val ids = AtomicLong(0)
    private val waiting = ConcurrentHashMap<Long, CompletableDeferred<T>>()

    fun register(): Pair<Long, CompletableDeferred<T>> {
        val id = ids.incrementAndGet()
        val d = CompletableDeferred<T>()
        waiting[id] = d
        return id to d
    }

    /** True if someone was waiting for [id]. */
    fun complete(id: Long, value: T): Boolean = waiting.remove(id)?.complete(value) ?: false

    fun failAll(e: Throwable) {
        val all = waiting.values.toList()
        waiting.clear()
        all.forEach { it.completeExceptionally(e) }
    }

    val size: Int get() = waiting.size

    /** Waits for the answer; on timeout forgets the id and throws [RemoteException.Timeout]. */
    suspend fun await(id: Long, d: CompletableDeferred<T>, timeoutMs: Long): T = try {
        withTimeout(timeoutMs) { d.await() }
    } catch (e: TimeoutCancellationException) {
        waiting.remove(id)
        throw RemoteException.Timeout("Orbit didn't answer in time.")
    }
}

/** Why talking to Orbit failed, in words fit to show. */
sealed class RemoteException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** Orbit said no: the phone isn't paired (any more) or the code expired. */
    class Denied(reason: String) : RemoteException(reason)

    /** The relay has no Orbit for this room right now (close code 4404). */
    class NoHost : RemoteException("Orbit isn't connected to the relay. Is the computer on, with Orbit running?")

    class Closed(val code: Int, reason: String) : RemoteException(reason)
    class Timeout(message: String) : RemoteException(message)
    class Network(message: String, cause: Throwable? = null) : RemoteException(message, cause)

    /** A frame did not open: something between the phone and Orbit changed it. */
    class Crypto(message: String, cause: Throwable? = null) : RemoteException(message, cause)
    class Offline : RemoteException("Not connected to Orbit right now.")
}

/** Waits that double from [startMs] up to [maxMs], with a little jitter so phones don't line up. */
class Backoff(private val startMs: Long = 1000, private val maxMs: Long = 60_000, private val jitter: Double = 0.2, private val random: () -> Double = Math::random) {
    private var current = startMs

    fun next(): Long {
        val base = current
        current = minOf(current * 2, maxMs)
        val j = 1 + (random() * 2 - 1) * jitter
        return (base * j).toLong().coerceAtLeast(0)
    }

    fun reset() {
        current = startMs
    }
}
