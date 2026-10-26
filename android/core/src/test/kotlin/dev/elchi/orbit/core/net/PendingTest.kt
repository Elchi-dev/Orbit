package dev.elchi.orbit.core.net

import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingTest {
    @Test fun answersFindTheirRequestsInAnyOrder() = runTest {
        val p = PendingRequests<String>()
        val (a, da) = p.register()
        val (b, db) = p.register()
        assertEquals(1L, a)
        assertEquals(2L, b)
        val ra = async { p.await(a, da, 5000) }
        val rb = async { p.await(b, db, 5000) }
        assertTrue(p.complete(b, "second"))
        assertTrue(p.complete(a, "first"))
        assertEquals("first", ra.await())
        assertEquals("second", rb.await())
        assertEquals(0, p.size)
    }

    @Test fun unknownAndDuplicateAnswersAreDropped() {
        val p = PendingRequests<String>()
        val (a, _) = p.register()
        assertFalse(p.complete(99, "nobody asked"))
        assertTrue(p.complete(a, "x"))
        assertFalse(p.complete(a, "again"))
    }

    @Test fun timeoutForgetsTheRequest() = runTest {
        val p = PendingRequests<String>()
        val (a, da) = p.register()
        val r = async { runCatching { p.await(a, da, 1000) } }
        advanceTimeBy(1500)
        val e = r.await().exceptionOrNull()
        assertTrue(e is RemoteException.Timeout)
        assertEquals(0, p.size)
        // a late answer finds nobody
        assertFalse(p.complete(a, "late"))
    }

    @Test fun failAllWakesEveryone() = runTest {
        val p = PendingRequests<String>()
        val (a, da) = p.register()
        val (b, db) = p.register()
        val ra = async { runCatching { p.await(a, da, 5000) } }
        val rb = async { runCatching { p.await(b, db, 5000) } }
        p.failAll(RemoteException.Offline())
        assertTrue(ra.await().exceptionOrNull() is RemoteException.Offline)
        assertTrue(rb.await().exceptionOrNull() is RemoteException.Offline)
    }

    @Test fun backoffDoublesUpToTheCapAndResets() {
        val b = Backoff(1000, 8000, jitter = 0.0)
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 8000L), List(5) { b.next() })
        b.reset()
        assertEquals(1000L, b.next())
        val j = Backoff(1000, 8000, jitter = 0.2, random = { 1.0 })
        assertEquals(1200L, j.next())
    }

    @Test fun helloCarriesCodeAndPushOnlyWhenGiven() {
        val first = RemoteSession.helloMessage(HelloInfo("Pixel 9", "0.5.0", HelloInfo.Push.Relay), "CODE")
        assertEquals("""{"t":"hello","code":"CODE","name":"Pixel 9","app":"0.5.0","push":{"kind":"relay"}}""", first.toString())
        val later = RemoteSession.helloMessage(HelloInfo("Pixel 9", "0.5.0", HelloInfo.Push.Fcm("tok")), null)
        assertEquals("""{"t":"hello","name":"Pixel 9","app":"0.5.0","push":{"kind":"fcm","token":"tok"}}""", later.toString())
        assertEquals("""{"t":"hello","name":"P","app":"1"}""", RemoteSession.helloMessage(HelloInfo("P", "1", null), null).toString())
    }
}
