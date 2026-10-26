package dev.elchi.orbit.alerts

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.elchi.orbit.OrbitApp
import dev.elchi.orbit.core.model.asArr
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.model.str
import dev.elchi.orbit.core.net.RemoteException
import dev.elchi.orbit.core.net.withSession
import dev.elchi.orbit.data.AlertMode
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** Starts listening for alerts again after a restart, if you asked for that. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = context.applicationContext as OrbitApp
        val pending = goAsync()
        app.hub.scope.launch {
            try {
                val st = app.hub.store.settings.first()
                val list = app.hub.store.computers.first()
                if (st.alertMode == AlertMode.RELAY && st.startOnBoot && list.isNotEmpty()) AlertService.start(context)
            } finally {
                pending.finish()
            }
        }
    }
}

/**
 * Allow or Deny from a notification, without opening the app: a short session
 * to the computer, the decision, and a round trip to be sure Orbit took it.
 */
class DecisionReceiver : BroadcastReceiver() {
    companion object {
        const val EXTRA_ROOM = "room"
        const val EXTRA_APPROVAL = "approval"
        const val EXTRA_WS = "ws"
        const val EXTRA_DECISION = "decision"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val room = intent.getStringExtra(EXTRA_ROOM) ?: return
        val id = intent.getStringExtra(EXTRA_APPROVAL) ?: return
        val ws = intent.getStringExtra(EXTRA_WS)
        val decision = intent.getStringExtra(EXTRA_DECISION)?.takeIf { it == "allow" || it == "deny" } ?: return
        val app = context.applicationContext as OrbitApp
        val pending = goAsync()
        app.hub.scope.launch {
            val c = app.hub.store.computers.first().firstOrNull { it.room == room }
            try {
                if (c == null) return@launch
                Notifier.decided(app, room, ws, if (decision == "allow") "Allowing..." else "Denying...", ongoing = true)
                val key = app.hub.deviceKey() ?: throw IllegalStateException("This phone has no key.")
                val result = withTimeout(25_000) {
                    withSession(app.hub.http, c.endpoint, key, app.hub.helloInfo()) { s ->
                        fun waiting(body: kotlinx.serialization.json.JsonElement) = body.asObj()?.get("approvals").asArr()?.mapNotNull { it.asObj() }?.any { it.str("id") == id } ?: false
                        if (!waiting(s.request("GET", "/api/state").body)) return@withSession "Already answered"
                        s.message(jsonOf("type" to "approval", "id" to id, "decision" to decision))
                        // Orbit handles frames in order: once this answers, the decision is in
                        if (waiting(s.request("GET", "/api/state").body)) throw IllegalStateException("Orbit didn't take the answer.")
                        if (decision == "allow") "Allowed" else "Denied"
                    }
                }
                Notifier.decided(app, room, ws, result)
                delay(1500)
                Notifier.cancel(app, room, ws)
            } catch (e: Throwable) {
                val why = when (e) {
                    is RemoteException.NoHost -> "Orbit isn't connected to the relay."
                    is RemoteException.Denied -> "This phone is no longer paired."
                    is kotlinx.coroutines.TimeoutCancellationException -> "It took too long."
                    else -> "The connection failed."
                }
                if (c != null) Notifier.failed(app, c, ws, why)
            } finally {
                pending.finish()
            }
        }
    }
}
