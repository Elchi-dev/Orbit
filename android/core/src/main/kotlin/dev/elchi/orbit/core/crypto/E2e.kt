package dev.elchi.orbit.core.crypto

import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Base64url without padding, the encoding of every byte string in the protocol. */
object B64u {
    private val enc = Base64.getUrlEncoder().withoutPadding()
    private val dec = Base64.getUrlDecoder()

    fun encode(b: ByteArray): String = enc.encodeToString(b)

    /** Accepts padded or unpadded base64url; throws IllegalArgumentException on anything else. */
    fun decode(s: String): ByteArray = dec.decode(s.trimEnd('='))
}

class KeyPair(val priv: ByteArray, val pub: ByteArray) {
    init {
        require(priv.size == 32 && pub.size == 32) { "X25519 keys are 32 bytes" }
    }
}

class SessionKeys(val up: ByteArray, val down: ByteArray)

/**
 * The end to end encryption of docs/REMOTE.md: X25519 for keys, HKDF-SHA256 to
 * derive, AES-256-GCM to seal. Mirrors server/e2e.ts byte for byte.
 */
object E2e {
    private val random = SecureRandom()
    private const val INFO = "orbit-e2e-v1"
    private const val ALERT_SALT = "orbit-alert"

    fun newKeyPair(): KeyPair {
        val priv = X25519.generatePrivateKey()
        return KeyPair(priv, X25519.publicFromPrivate(priv))
    }

    fun pubOf(priv: ByteArray): ByteArray = X25519.publicFromPrivate(priv)

    fun x25519(priv: ByteArray, pub: ByteArray): ByteArray {
        require(pub.size == 32) { "bad public key" }
        val s = try {
            X25519.computeSharedSecret(priv, pub)
        } catch (e: java.security.InvalidKeyException) {
            throw IllegalArgumentException("bad public key", e)
        }
        require(s.any { it.toInt() != 0 }) { "bad public key" }
        return s
    }

    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, len: Int): ByteArray =
        Hkdf.computeHkdf("HMACSHA256", ikm, salt, info, len)

    fun randomBytes(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b)

    /** The relay's name for one Orbit: the first 22 characters of base64url(SHA-256(H)). */
    fun roomOf(hostPub: ByteArray): String = B64u.encode(sha256(hostPub)).substring(0, 22)

    /** A device id, the same way from the phone's public key. */
    fun deviceIdOf(devicePub: ByteArray): String = roomOf(devicePub)

    /** The phone's side of the handshake: its ephemeral and device private keys, Orbit's public key and the nonce. */
    fun sessionKeysPhone(ePriv: ByteArray, dPriv: ByteArray, hostPub: ByteArray, n: ByteArray): SessionKeys {
        val s1 = x25519(ePriv, hostPub)
        val s2 = x25519(dPriv, hostPub)
        return derive(s1, s2, n, hostPub, pubOf(dPriv), pubOf(ePriv))
    }

    /** Orbit's side, used by tests to stand in for the computer. */
    fun sessionKeysHost(hostPriv: ByteArray, d: ByteArray, e: ByteArray, n: ByteArray): SessionKeys {
        val s1 = x25519(hostPriv, e)
        val s2 = x25519(hostPriv, d)
        return derive(s1, s2, n, pubOf(hostPriv), d, e)
    }

    private fun derive(s1: ByteArray, s2: ByteArray, n: ByteArray, h: ByteArray, d: ByteArray, e: ByteArray): SessionKeys {
        val okm = hkdf(s1 + s2, n, INFO.toByteArray(Charsets.UTF_8) + h + d + e, 64)
        return SessionKeys(okm.copyOfRange(0, 32), okm.copyOfRange(32, 64))
    }

    fun alertKeyPhone(dPriv: ByteArray, hostPub: ByteArray): ByteArray =
        hkdf(x25519(dPriv, hostPub), ALERT_SALT.toByteArray(Charsets.UTF_8), hostPub + pubOf(dPriv), 32)

    fun alertKeyHost(hostPriv: ByteArray, devicePub: ByteArray): ByteArray =
        hkdf(x25519(hostPriv, devicePub), ALERT_SALT.toByteArray(Charsets.UTF_8), pubOf(hostPriv) + devicePub, 32)

    fun gcmSeal(key: ByteArray, nonce: ByteArray, plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return c.doFinal(plain)
    }

    /** Throws on a wrong key, nonce or a changed byte (javax.crypto.AEADBadTagException). */
    fun gcmOpen(key: ByteArray, nonce: ByteArray, sealed: ByteArray): ByteArray {
        if (sealed.size < 16) throw java.security.GeneralSecurityException("too short")
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return c.doFinal(sealed)
    }

    /** 4 zero bytes, then the counter as a 64-bit big-endian number. */
    fun counterNonce(n: Long): ByteArray {
        val b = ByteArray(12)
        for (i in 0 until 8) b[4 + i] = (n ushr (56 - 8 * i)).toByte()
        return b
    }

    /** An alert frame: 12 random nonce bytes, then the sealed JSON. */
    fun sealAlert(key: ByteArray, json: String, nonce: ByteArray = randomBytes(12)): ByteArray =
        nonce + gcmSeal(key, nonce, json.toByteArray(Charsets.UTF_8))

    fun openAlert(key: ByteArray, frame: ByteArray): String {
        if (frame.size < 12 + 16) throw java.security.GeneralSecurityException("too short")
        return gcmOpen(key, frame.copyOfRange(0, 12), frame.copyOfRange(12, frame.size)).toString(Charsets.UTF_8)
    }
}

/** One direction of a session: seals with the counter nonce, starting at 0. */
class FrameSealer(private val key: ByteArray) {
    private var n = 0L

    @Synchronized
    fun seal(plain: String): ByteArray = E2e.gcmSeal(key, E2e.counterNonce(n++), plain.toByteArray(Charsets.UTF_8))
}

/**
 * The other direction: opens only the frame with the next counter. A skipped,
 * replayed or changed frame throws, and the counter does not move, so the
 * session has to be dropped (as the protocol says).
 */
class FrameOpener(private val key: ByteArray) {
    private var n = 0L

    val next: Long @Synchronized get() = n

    @Synchronized
    fun open(frame: ByteArray): String {
        val plain = E2e.gcmOpen(key, E2e.counterNonce(n), frame)
        n++
        return plain.toString(Charsets.UTF_8)
    }
}
