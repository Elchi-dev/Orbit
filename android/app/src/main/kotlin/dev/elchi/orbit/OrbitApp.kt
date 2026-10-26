package dev.elchi.orbit

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.elchi.orbit.alerts.AlertService
import dev.elchi.orbit.alerts.Notifier
import dev.elchi.orbit.data.Hub

class OrbitApp : Application() {
    lateinit var hub: Hub
        private set

    /** Whether the app is on screen, so alerts for what you're looking at stay quiet. */
    @Volatile var inFront = false
        private set

    override fun onCreate() {
        super.onCreate()
        hub = Hub(this)
        Notifier.channels(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                inFront = true
                hub.onForeground()
            }

            override fun onStop(owner: LifecycleOwner) {
                inFront = false
                hub.onBackground()
            }
        })
        getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                hub.networkBack()
            }
        })
        AlertService.sync(this)
    }
}
