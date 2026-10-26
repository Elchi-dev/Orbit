package dev.elchi.orbit.core.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Every value of docs/remote-vectors.json, reproduced from its inputs. */
class VectorsTest {
    private val v: Map<String, String> = run {
        val path = System.getProperty("orbit.vectors")?.takeIf { it.isNotEmpty() } ?: "../../docs/remote-vectors.json"
        Json.parseToJsonElement(File(path).readText()).jsonObject.mapValues { it.value.jsonPrimitive.content }
    }
    private fun b(k: String) = B64u.decode(v.getValue(k))

    @Test fun publicKeys() {
        assertEquals(v["host_pub"], B64u.encode(E2e.pubOf(b("host_priv"))))
        assertEquals(v["device_pub"], B64u.encode(E2e.pubOf(b("device_priv"))))
        assertEquals(v["ephemeral_pub"], B64u.encode(E2e.pubOf(b("ephemeral_priv"))))
    }

    @Test fun roomAndDeviceId() {
        assertEquals(v["room"], E2e.roomOf(b("host_pub")))
        assertEquals(v["device_id"], E2e.deviceIdOf(b("device_pub")))
    }

    @Test fun sessionKeysBothSides() {
        val phone = E2e.sessionKeysPhone(b("ephemeral_priv"), b("device_priv"), b("host_pub"), b("n"))
        assertEquals(v["k_up"], B64u.encode(phone.up))
        assertEquals(v["k_down"], B64u.encode(phone.down))
        val host = E2e.sessionKeysHost(b("host_priv"), b("device_pub"), b("ephemeral_pub"), b("n"))
        assertArrayEquals(phone.up, host.up)
        assertArrayEquals(phone.down, host.down)
    }

    @Test fun sealedFrames() {
        val up = FrameSealer(b("k_up"))
        assertEquals(v["up_0_sealed"], B64u.encode(up.seal(v.getValue("up_0_plain"))))
        assertEquals(v["up_1_sealed"], B64u.encode(up.seal(v.getValue("up_1_plain"))))
        val down = FrameOpener(b("k_down"))
        assertEquals(v["down_0_plain"], down.open(b("down_0_sealed")))
        val upOpen = FrameOpener(b("k_up"))
        assertEquals(v["up_0_plain"], upOpen.open(b("up_0_sealed")))
        assertEquals(v["up_1_plain"], upOpen.open(b("up_1_sealed")))
        assertEquals(v["down_0_sealed"], B64u.encode(FrameSealer(b("k_down")).seal(v.getValue("down_0_plain"))))
    }

    @Test fun alerts() {
        assertEquals(v["alert_key"], B64u.encode(E2e.alertKeyPhone(b("device_priv"), b("host_pub"))))
        assertEquals(v["alert_key"], B64u.encode(E2e.alertKeyHost(b("host_priv"), b("device_pub"))))
        assertEquals(v["alert_sealed"], B64u.encode(E2e.sealAlert(b("alert_key"), v.getValue("alert_plain"), b("alert_nonce"))))
        assertEquals(v["alert_plain"], E2e.openAlert(b("alert_key"), b("alert_sealed")))
    }
}
