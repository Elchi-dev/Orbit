package dev.elchi.orbit.push

import dev.elchi.orbit.BuildConfig

/** Firebase Cloud Messaging, when this build has it (see android/README.md). */
interface PushProvider {
    /** The current FCM token, or null if Firebase can't give one now. */
    suspend fun token(): String?
}

object Push {
    /** Set only in builds made with app/google-services.json. */
    val provider: PushProvider? by lazy {
        if (!BuildConfig.HAS_FIREBASE) null
        else runCatching { Class.forName("dev.elchi.orbit.push.FirebasePush").getField("INSTANCE").get(null) as PushProvider }.getOrNull()
    }

    val available: Boolean get() = provider != null
}
