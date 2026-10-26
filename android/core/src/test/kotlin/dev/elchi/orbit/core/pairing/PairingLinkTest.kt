package dev.elchi.orbit.core.pairing

import dev.elchi.orbit.core.crypto.B64u
import dev.elchi.orbit.core.crypto.E2e
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLEncoder

class PairingLinkTest {
    private val host = E2e.newKeyPair()
    private val h = B64u.encode(host.pub)
    private val room = E2e.roomOf(host.pub)
    private val code = B64u.encode(E2e.randomBytes(16))

    private fun enc(s: String) = URLEncoder.encode(s, Charsets.UTF_8)
    private fun link(relay: String = "https://relay.example.com", r: String = room, key: String = h, c: String? = code, name: String? = "Kim's Mac mini", v: String = "1") =
        buildString {
            append("orbit://pair?v=$v&relay=${enc(relay)}&room=$r&h=$key")
            if (c != null) append("&code=$c")
            if (name != null) append("&name=${enc(name)}")
        }

    @Test fun readsAGoodLink() {
        val p = PairingLink.parse(link())
        assertEquals("https://relay.example.com", p.relay)
        assertEquals(room, p.room)
        assertEquals(h, p.hostKey)
        assertEquals(code, p.code)
        assertEquals("Kim's Mac mini", p.name)
    }

    @Test fun readsTheLinkOrbitMakes() {
        // URLSearchParams writes spaces as + and escapes the colon and slashes of the relay
        val raw = "orbit://pair?v=1&relay=https%3A%2F%2Frelay.example.com&room=$room&h=$h&code=$code&name=Work+laptop"
        val p = PairingLink.parse("  $raw\n")
        assertEquals("Work laptop", p.name)
        assertEquals("https://relay.example.com", p.relay)
    }

    @Test fun acceptsMissingNameAndCodeAndTrailingSlash() {
        val p = PairingLink.parse(link(relay = "https://relay.example.com:8443/", c = null, name = null))
        assertNull(p.code)
        assertEquals("Orbit", p.name)
        assertEquals("https://relay.example.com:8443", p.relay)
    }

    @Test fun localRelayOverHttpIsAllowedOnlyLocally() {
        assertEquals("http://localhost:8787", PairingLink.parse(link(relay = "http://localhost:8787")).relay)
        assertThrows(PairingLink.Invalid::class.java) { PairingLink.parse(link(relay = "http://relay.example.com")) }
    }

    @Test fun refusesBadLinks() {
        val bad = listOf(
            "",
            "https://example.com/pair?v=1",
            "orbit://pair",
            "orbit://other?v=1&relay=x",
            link(v = "2"),
            link(relay = "ftp://relay.example.com"),
            link(relay = "https://relay.example.com/path"),
            link(relay = "not a url"),
            link(key = "short"),
            link(key = B64u.encode(ByteArray(31))),
            link(r = "AAAAAAAAAAAAAAAAAAAAAA"),
            link(c = "nope!"),
            link(c = B64u.encode(ByteArray(8))),
            "orbit://pair?v=1&room=$room&h=$h",
            "orbit://pair?v=1&relay=https://r.example.com&h=$h",
            "orbit://pair?v=1&relay=https://r.example.com&room=$room",
        )
        for (b in bad) {
            val e = runCatching { PairingLink.parse(b) }.exceptionOrNull()
            assertTrue("should refuse: $b", e is PairingLink.Invalid)
            assertTrue("should say why: $b", !e!!.message.isNullOrBlank())
        }
    }
}
