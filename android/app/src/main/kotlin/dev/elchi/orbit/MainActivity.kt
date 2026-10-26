package dev.elchi.orbit

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.elchi.orbit.alerts.Notifier
import dev.elchi.orbit.ui.Incoming
import dev.elchi.orbit.ui.OrbitAppRoot
import dev.elchi.orbit.ui.theme.OrbitTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

class MainActivity : ComponentActivity() {
    private val incoming = MutableStateFlow<Incoming?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val app = application as OrbitApp
        if (savedInstanceState == null) read(intent)
        setContent {
            // Orbit's own "calm" motion setting slows Ori's loops, like on the web
            val calm by app.hub.connection.map { it?.state?.value?.server?.motion == "calm" }.collectAsStateWithLifecycle(false)
            OrbitTheme(calm = calm) {
                OrbitAppRoot(app, incoming)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        read(intent)
    }

    private fun read(i: Intent?) {
        i ?: return
        val data = i.data
        if (i.action == Intent.ACTION_VIEW && data?.scheme == "orbit") {
            incoming.value = Incoming(link = data.toString())
            return
        }
        val room = i.getStringExtra(Notifier.EXTRA_ROOM) ?: return
        incoming.value = Incoming(room = room, ws = i.getStringExtra(Notifier.EXTRA_WS))
    }
}
