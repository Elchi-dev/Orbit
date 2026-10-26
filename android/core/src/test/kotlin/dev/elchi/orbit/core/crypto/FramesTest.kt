package dev.elchi.orbit.core.crypto

import dev.elchi.orbit.core.net.Alert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FramesTest {
    private val key = E2e.randomBytes(32)

    @Test fun roundTripInOrder() {
        val s = FrameSealer(key)
        val o = FrameOpener(key)
        repeat(5) { assertEquals("m$it", o.open(s.seal("m$it"))) }
        assertEquals(5L, o.next)
    }

    @Test fun skippedFrameFails() {
        val s = FrameSealer(key)
        val o = FrameOpener(key)
        s.seal("lost")
        val second = s.seal("second")
        assertThrows(Exception::class.java) { o.open(second) }
        // the counter did not move: the session is dead, as the protocol wants
        assertEquals(0L, o.next)
    }

    @Test fun replayedFrameFails() {
        val s = FrameSealer(key)
        val o = FrameOpener(key)
        val first = s.seal("hello")
        assertEquals("hello", o.open(first))
        assertThrows(Exception::class.java) { o.open(first) }
    }

    @Test fun changedByteFails() {
        val f = FrameSealer(key).seal("hello")
        f[3] = (f[3].toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { FrameOpener(key).open(f) }
    }

    @Test fun wrongKeyAndShortFramesFail() {
        val f = FrameSealer(key).seal("hello")
        assertThrows(Exception::class.java) { FrameOpener(E2e.randomBytes(32)).open(f) }
        assertThrows(Exception::class.java) { FrameOpener(key).open(ByteArray(10)) }
    }

    @Test fun counterNonceLayout() {
        val n = E2e.counterNonce(0x0102030405060708)
        assertEquals("000000000102030405060708", n.joinToString("") { "%02x".format(it) })
    }

    @Test fun bothDirectionsUseSeparateKeysAndCounters() {
        val host = E2e.newKeyPair()
        val dev = E2e.newKeyPair()
        val eph = E2e.newKeyPair()
        val n = E2e.randomBytes(16)
        val phone = E2e.sessionKeysPhone(eph.priv, dev.priv, host.pub, n)
        val orbit = E2e.sessionKeysHost(host.priv, dev.pub, eph.pub, n)
        val up = FrameSealer(phone.up)
        val down = FrameSealer(orbit.down)
        val upOpen = FrameOpener(orbit.up)
        val downOpen = FrameOpener(phone.down)
        assertEquals("a", upOpen.open(up.seal("a")))
        assertEquals("b", downOpen.open(down.seal("b")))
        assertEquals("c", upOpen.open(up.seal("c")))
        // a frame sealed for one direction does not open in the other
        assertThrows(Exception::class.java) { downOpen.open(up.seal("d")) }
    }

    @Test fun badPublicKeysAreRefused() {
        val me = E2e.newKeyPair()
        assertThrows(IllegalArgumentException::class.java) { E2e.x25519(me.priv, ByteArray(32)) }
        assertThrows(IllegalArgumentException::class.java) { E2e.x25519(me.priv, ByteArray(31)) }
    }

    @Test fun alertsOpenWithThePhonesKey() {
        val host = E2e.newKeyPair()
        val dev = E2e.newKeyPair()
        val frame = E2e.sealAlert(E2e.alertKeyHost(host.priv, dev.pub), """{"t":"needs","ws":"w_1","title":"Backups","count":2,"at":1761200000000}""")
        val a = Alert.open(dev.priv, host.pub, frame)
        assertEquals(Alert("needs", "w_1", "Backups", 2, 1761200000000), a)
        assertEquals(a, Alert.openBase64(dev.priv, host.pub, B64u.encode(frame)))
        val clear = Alert.open(dev.priv, host.pub, E2e.sealAlert(E2e.alertKeyHost(host.priv, dev.pub), """{"t":"clear","count":0,"at":5}"""))
        assertEquals("clear", clear.t)
        // another phone's key, or a changed frame, does not open it
        assertThrows(Exception::class.java) { Alert.open(E2e.newKeyPair().priv, host.pub, frame) }
        frame[frame.size - 1] = (frame.last().toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { Alert.open(dev.priv, host.pub, frame) }
    }
}
