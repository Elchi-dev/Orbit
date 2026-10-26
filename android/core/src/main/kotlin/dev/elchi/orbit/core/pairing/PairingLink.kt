package dev.elchi.orbit.core.pairing

import dev.elchi.orbit.core.crypto.B64u
import dev.elchi.orbit.core.crypto.E2e
import java.net.URI
import java.net.URLDecoder

/** What a pairing QR code carries (docs/REMOTE.md, Pairing). */
data class PairingLink(
    /** The relay's base URL, without a trailing slash. */
    val relay: String,
    val room: String,
    /** Orbit's public key, base64url. */
    val hostKey: String,
    /** The one-use pairing code, base64url; null in a link without one. */
    val code: String?,
    /** The computer's name as Orbit calls itself. */
    val name: String,
) {
    val hostKeyBytes: ByteArray get() = B64u.decode(hostKey)

    class Invalid(message: String) : IllegalArgumentException(message)

    companion object {
        private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2", "[::1]")

        /**
         * Reads `orbit://pair?v=1&relay=...&room=...&h=...&code=...&name=...`.
         * Throws [Invalid] with a message fit to show when the link is wrong.
         */
        fun parse(input: String): PairingLink {
            val link = input.trim()
            val q = link.indexOf('?')
            val head = if (q < 0) link else link.substring(0, q)
            if (!head.equals("orbit://pair", ignoreCase = true) && !head.equals("orbit://pair/", ignoreCase = true)) {
                throw Invalid("That isn't an Orbit pairing link. It starts with orbit://pair.")
            }
            if (q < 0) throw Invalid("The link is missing its details. Copy the whole link from Orbit.")
            val params = HashMap<String, String>()
            for (part in link.substring(q + 1).split('&')) {
                if (part.isEmpty()) continue
                val eq = part.indexOf('=')
                val k = decode(if (eq < 0) part else part.substring(0, eq))
                val v = if (eq < 0) "" else decode(part.substring(eq + 1))
                params.putIfAbsent(k, v)
            }
            val v = params["v"] ?: throw Invalid("The link is missing its version. Copy the whole link from Orbit.")
            if (v != "1") throw Invalid("This link is for a newer version of Orbit. Update the app and scan it again.")

            val relay = normalizeRelay(params["relay"] ?: throw Invalid("The link has no relay address."))
            val h = params["h"] ?: throw Invalid("The link has no computer key.")
            val hBytes = try {
                B64u.decode(h)
            } catch (e: IllegalArgumentException) {
                throw Invalid("The computer key in the link is damaged.")
            }
            if (hBytes.size != 32) throw Invalid("The computer key in the link is damaged.")
            val room = params["room"] ?: throw Invalid("The link has no room.")
            if (room != E2e.roomOf(hBytes)) throw Invalid("The room and the key in the link don't match. Copy the whole link again.")
            val code = params["code"]?.takeIf { it.isNotEmpty() }
            if (code != null) {
                val ok = runCatching { B64u.decode(code).size == 16 }.getOrDefault(false)
                if (!ok) throw Invalid("The pairing code in the link is damaged.")
            }
            val name = params["name"]?.trim()?.take(60)?.takeIf { it.isNotEmpty() } ?: "Orbit"
            return PairingLink(relay, room, B64u.encode(hBytes), code, name)
        }

        /** https://host[:port], or plain http for a relay on this machine (tests, the emulator). */
        fun normalizeRelay(raw: String): String {
            val s = raw.trim().trimEnd('/')
            val uri = try {
                URI(s)
            } catch (e: Exception) {
                throw Invalid("The relay address in the link is damaged.")
            }
            val scheme = uri.scheme?.lowercase()
            val host = uri.host ?: throw Invalid("The relay address in the link is damaged.")
            if (!uri.rawPath.isNullOrEmpty() || uri.rawQuery != null || uri.rawFragment != null || uri.userInfo != null) {
                throw Invalid("The relay address should be just https://relay.example.com.")
            }
            when (scheme) {
                "https" -> {}
                "http" -> if (host.lowercase() !in LOCAL_HOSTS) throw Invalid("The relay has to use https.")
                else -> throw Invalid("The relay has to use https.")
            }
            return s
        }

        private fun decode(s: String): String = try {
            URLDecoder.decode(s, Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            throw Invalid("The link is damaged. Copy the whole link from Orbit.")
        }
    }
}
