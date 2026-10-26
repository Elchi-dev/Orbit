package dev.elchi.orbit.push

import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.elchi.orbit.OrbitApp
import dev.elchi.orbit.alerts.AlertHandler
import dev.elchi.orbit.data.AlertMode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Found by name from [Push], so builds without Firebase never reference it. */
object FirebasePush : PushProvider {
    override suspend fun token(): String? = suspendCancellableCoroutine { c ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { c.resume(it) }
            .addOnFailureListener { c.resume(null) }
    }
}

/**
 * Alerts through Firebase: a data message `{"orbit": "<base64url sealed frame>"}`.
 * Google carries it but can't read it; it opens with the same key as relay alerts.
 */
class OrbitMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val frame = message.data["orbit"] ?: return
        val app = application as OrbitApp
        // runs on Firebase's own worker thread; finish before returning
        runBlocking { AlertHandler.fromFirebase(app, frame) }
    }

    override fun onNewToken(token: String) {
        val app = application as OrbitApp
        app.hub.scope.launch {
            app.hub.store.setFcmToken(token)
            if (app.hub.store.settings.first().alertMode == AlertMode.FIREBASE) app.hub.announcePush()
        }
    }
}
