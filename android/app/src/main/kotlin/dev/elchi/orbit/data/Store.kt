package dev.elchi.orbit.data

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dev.elchi.orbit.core.crypto.B64u
import dev.elchi.orbit.core.crypto.E2e
import dev.elchi.orbit.core.crypto.KeyPair
import dev.elchi.orbit.core.net.Endpoint
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

val Context.orbitPrefs: DataStore<Preferences> by preferencesDataStore(name = "orbit")

/** A computer this phone is paired with. */
@Serializable
data class Computer(
    val room: String,
    val relay: String,
    val hostKey: String,
    /** What Orbit calls itself. */
    val name: String,
    /** What you called it here, if you renamed it. */
    val label: String? = null,
    val addedAt: Long = 0,
) {
    val displayName: String get() = label?.takeIf { it.isNotBlank() } ?: name
    val endpoint: Endpoint get() = Endpoint(relay, room, hostKey)
    val hostKeyBytes: ByteArray get() = B64u.decode(hostKey)
}

enum class AlertMode(val id: String) {
    RELAY("relay"),
    FIREBASE("firebase");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: RELAY
    }
}

data class AppSettings(
    val alertMode: AlertMode = AlertMode.RELAY,
    val startOnBoot: Boolean = true,
    val phoneName: String = defaultPhoneName(),
    val askedNotifications: Boolean = false,
    val fcmToken: String? = null,
    val activeRoom: String? = null,
    val skyAsList: Boolean = false,
    val lastProfile: String? = null,
) {
    companion object {
        fun defaultPhoneName(): String {
            val m = Build.MODEL ?: ""
            val brand = Build.MANUFACTURER ?: ""
            return (if (m.startsWith(brand, ignoreCase = true) || brand.isBlank()) m else "${brand.replaceFirstChar { it.uppercase() }} $m").ifBlank { "Phone" }.take(60)
        }
    }
}

/** Pairings and settings in one DataStore file. */
class Store(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }
    private val list = ListSerializer(Computer.serializer())

    private object K {
        val computers = stringPreferencesKey("computers")
        val active = stringPreferencesKey("active_room")
        val alertMode = stringPreferencesKey("alert_mode")
        val boot = booleanPreferencesKey("start_on_boot")
        val phoneName = stringPreferencesKey("phone_name")
        val asked = booleanPreferencesKey("asked_notifications")
        val fcm = stringPreferencesKey("fcm_token")
        val asList = booleanPreferencesKey("sky_as_list")
        val profile = stringPreferencesKey("last_profile")
        val deviceKey = stringPreferencesKey("device_key_wrapped")
    }

    val computers: Flow<List<Computer>> = context.orbitPrefs.data.map { p ->
        p[K.computers]?.let { runCatching { json.decodeFromString(list, it) }.getOrNull() } ?: emptyList()
    }

    val settings: Flow<AppSettings> = context.orbitPrefs.data.map { p ->
        AppSettings(
            alertMode = AlertMode.of(p[K.alertMode]),
            startOnBoot = p[K.boot] ?: true,
            phoneName = p[K.phoneName] ?: AppSettings.defaultPhoneName(),
            askedNotifications = p[K.asked] ?: false,
            fcmToken = p[K.fcm],
            activeRoom = p[K.active],
            skyAsList = p[K.asList] ?: false,
            lastProfile = p[K.profile],
        )
    }

    suspend fun saveComputer(c: Computer) = context.orbitPrefs.edit { p ->
        val cur = p[K.computers]?.let { runCatching { json.decodeFromString(list, it) }.getOrNull() } ?: emptyList()
        val old = cur.firstOrNull { it.room == c.room }
        // pairing again keeps your name for it
        val next = cur.filter { it.room != c.room } + c.copy(label = c.label ?: old?.label, addedAt = old?.addedAt ?: c.addedAt)
        p[K.computers] = json.encodeToString(list, next)
        p[K.active] = c.room
    }

    suspend fun rename(room: String, label: String?) = editComputers { l -> l.map { if (it.room == room) it.copy(label = label?.trim()?.take(60)?.ifBlank { null }) else it } }

    suspend fun forget(room: String) = context.orbitPrefs.edit { p ->
        val cur = p[K.computers]?.let { runCatching { json.decodeFromString(list, it) }.getOrNull() } ?: emptyList()
        val next = cur.filter { it.room != room }
        p[K.computers] = json.encodeToString(list, next)
        if (p[K.active] == room) next.firstOrNull()?.let { p[K.active] = it.room } ?: p.remove(K.active)
    }

    private suspend fun editComputers(fn: (List<Computer>) -> List<Computer>) = context.orbitPrefs.edit { p ->
        val cur = p[K.computers]?.let { runCatching { json.decodeFromString(list, it) }.getOrNull() } ?: emptyList()
        p[K.computers] = json.encodeToString(list, fn(cur))
    }

    suspend fun setActive(room: String) = context.orbitPrefs.edit { it[K.active] = room }
    suspend fun setAlertMode(m: AlertMode) = context.orbitPrefs.edit { it[K.alertMode] = m.id }
    suspend fun setStartOnBoot(on: Boolean) = context.orbitPrefs.edit { it[K.boot] = on }
    suspend fun setPhoneName(n: String) = context.orbitPrefs.edit { it[K.phoneName] = n.trim().take(60).ifBlank { AppSettings.defaultPhoneName() } }
    suspend fun setAskedNotifications() = context.orbitPrefs.edit { it[K.asked] = true }
    suspend fun setFcmToken(t: String?) = context.orbitPrefs.edit { if (t == null) it.remove(K.fcm) else it[K.fcm] = t }
    suspend fun setSkyAsList(on: Boolean) = context.orbitPrefs.edit { it[K.asList] = on }
    suspend fun setLastProfile(id: String) = context.orbitPrefs.edit { it[K.profile] = id }

    suspend fun snapshot(): Pair<List<Computer>, AppSettings> = computers.first() to settings.first()

    // ---------- the device key ----------

    /**
     * The phone's X25519 key pair, made on first pairing. The private key is
     * kept wrapped by an AES key that lives in the Android Keystore and never
     * leaves it; [create] makes one when there is none.
     */
    suspend fun deviceKey(create: Boolean): KeyPair? {
        val wrapped = context.orbitPrefs.data.first()[K.deviceKey]
        if (wrapped != null) {
            runCatching { return KeyVault.unwrap(wrapped) }
            // the Keystore key is gone (a restore to another phone): the old pairings can't work
            if (!create) return null
        }
        if (!create) return null
        val kp = E2e.newKeyPair()
        val w = KeyVault.wrap(kp.priv)
        context.orbitPrefs.edit { it[K.deviceKey] = w }
        return kp
    }
}

/** Wraps the device's private key with an AES-GCM key kept in the Android Keystore. */
object KeyVault {
    private const val ALIAS = "orbit.device.wrap"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun wrap(priv: ByteArray): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        return B64u.encode(c.iv + c.doFinal(priv))
    }

    fun unwrap(s: String): KeyPair {
        val b = B64u.decode(s)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b.copyOfRange(0, 12)))
        val priv = c.doFinal(b.copyOfRange(12, b.size))
        return KeyPair(priv, E2e.pubOf(priv))
    }
}
