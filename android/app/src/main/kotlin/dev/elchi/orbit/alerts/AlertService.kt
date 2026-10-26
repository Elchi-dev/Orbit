package dev.elchi.orbit.alerts

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.elchi.orbit.OrbitApp
import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.model.asArr
import dev.elchi.orbit.core.model.asObj
import dev.elchi.orbit.core.net.Alert
import dev.elchi.orbit.core.net.AlertWaiter
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.net.withSession
import dev.elchi.orbit.data.AlertMode
import dev.elchi.orbit.data.Computer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Alerts through the relay: a foreground service with a quiet "Orbit is
 * connected" notification that keeps one `/v1/wait` socket per paired
 * computer. Each alert is opened with that computer's alert key and becomes a
 * notification.
 */
class AlertService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val waiters = HashMap<String, AlertWaiter>()
    private var watch: Job? = null
    private var net: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startInFront("Listening for alerts")
        val app = application as OrbitApp
        watch = scope.launch {
            combine(app.hub.computers, app.hub.settings) { list, st -> list to st }.collect { (list, st) ->
                if (st.alertMode != AlertMode.RELAY || list.isEmpty()) {
                    stopSelf()
                    return@collect
                }
                val key = app.hub.deviceKey() ?: return@collect stopSelf()
                // one socket per computer; computers you forgot lose theirs
                for (room in waiters.keys - list.map { it.room }.toSet()) waiters.remove(room)?.stop()
                for (c in list) if (c.room !in waiters) {
                    val w = AlertWaiter(app.hub.http, c.endpoint, key, scope) { alert -> scope.launch { AlertHandler.handle(app, c, alert) } }
                    waiters[c.room] = w
                    w.start()
                    scope.launch { w.state.collect { updateText(list) } }
                }
                updateText(list)
            }
        }
        net = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                waiters.values.forEach { it.kick() }
            }
        }.also { getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(it) }
    }

    private fun updateText(list: List<Computer>) {
        val listening = list.filter { waiters[it.room]?.state?.value is AlertWaiter.State.Listening }
        val text = when {
            listening.size == list.size && list.size == 1 -> "Listening for alerts from ${list[0].displayName}"
            listening.size == list.size -> "Listening for alerts from ${list.size} computers"
            listening.isEmpty() -> "Waiting for the network"
            else -> "Listening for ${listening.joinToString { it.displayName }}"
        }
        startInFront(text)
    }

    private fun startInFront(text: String) {
        val n = Notifier.service(this, text)
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        runCatching { ServiceCompat.startForeground(this, Notifier.SERVICE_ID, n, type) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        watch?.cancel()
        waiters.values.forEach { it.stop() }
        waiters.clear()
        net?.let { runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) } }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        /** Starts or stops the service to match the settings. Safe to call from anywhere. */
        fun sync(ctx: Context) {
            val app = ctx.applicationContext as OrbitApp
            app.hub.scope.launch {
                val (list, st) = app.hub.store.snapshot()
                if (st.alertMode == AlertMode.RELAY && list.isNotEmpty()) start(ctx) else stop(ctx)
            }
        }

        fun start(ctx: Context) {
            // from the background Android may refuse; the next app start or boot tries again
            runCatching { ContextCompat.startForegroundService(ctx, Intent(ctx, AlertService::class.java)) }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, AlertService::class.java))
        }
    }
}

/** What happens to an opened alert, the same for the relay and Firebase. */
object AlertHandler {
    suspend fun fromFirebase(app: OrbitApp, frame: String) {
        val key = app.hub.deviceKey() ?: return
        for (c in app.hub.store.computers.first()) {
            val a = runCatching { Alert.openBase64(key.priv, c.hostKeyBytes, frame) }.getOrNull() ?: continue
            handle(app, c, a)
            return
        }
    }

    suspend fun handle(app: OrbitApp, c: Computer, alert: Alert) {
        val conn = app.hub.connection.value
        val watching = app.inFront && conn?.computer?.room == c.room && conn.conn.value is ConnState.Online
        when (alert.t) {
            "needs" -> {
                // the app is open on this computer: the approval sheet is already there
                if (watching) return
                Notifier.needs(app, c, alert, null, alert.count, multi = alert.count > 1)
                enrich(app, c, alert)
            }
            "clear" -> Notifier.clear(app, c.room)
            "done" -> if (!watching) Notifier.done(app, c, alert)
            "test" -> Notifier.test(app, c, alert)
        }
    }

    /** Fetches what waits over a short session, so the notification can say it and offer Allow and Deny. */
    private suspend fun enrich(app: OrbitApp, c: Computer, alert: Alert) {
        val key = app.hub.deviceKey() ?: return
        val list = withTimeoutOrNull(15_000) {
            runCatching {
                withSession(app.hub.http, c.endpoint, key, app.hub.helloInfo()) { s ->
                    s.request("GET", "/api/state").body.asObj()?.get("approvals").asArr()?.mapNotNull { it.asObj() }?.map(Approval::from)
                }
            }.getOrNull()
        } ?: return
        val here = list.filter { alert.ws == null || it.homeId == alert.ws || it.workspaceId == alert.ws }
        when {
            here.isEmpty() && list.isEmpty() -> Notifier.cancel(app, c.room, alert.ws)
            here.isEmpty() -> Notifier.needs(app, c, alert, null, list.size, multi = true)
            else -> Notifier.needs(app, c, alert, here.first(), here.size, multi = here.size > 1)
        }
    }
}
