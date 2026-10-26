package dev.elchi.orbit.alerts

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import dev.elchi.orbit.MainActivity
import dev.elchi.orbit.R
import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.net.Alert
import dev.elchi.orbit.core.state.ToolWords
import dev.elchi.orbit.data.Computer

/** Every notification Orbit shows, in one place. */
object Notifier {
    const val CH_NEEDS = "needs"
    const val CH_DONE = "done"
    const val CH_SERVICE = "service"
    const val SERVICE_ID = 1
    private const val PEACH = 0xFFFFB199.toInt()

    const val EXTRA_ROOM = "orbit.room"
    const val EXTRA_WS = "orbit.ws"

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_NEEDS, ctx.getString(R.string.channel_needs), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = ctx.getString(R.string.channel_needs_desc)
                    enableVibration(true)
                },
                NotificationChannel(CH_DONE, ctx.getString(R.string.channel_done), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = ctx.getString(R.string.channel_done_desc)
                },
                NotificationChannel(CH_SERVICE, ctx.getString(R.string.channel_service), NotificationManager.IMPORTANCE_MIN).apply {
                    description = ctx.getString(R.string.channel_service_desc)
                    setShowBadge(false)
                },
            ),
        )
    }

    fun idFor(room: String, ws: String?) = ("$room:${ws ?: ""}").hashCode() and 0x7fffffff or 0x100

    fun openIntent(ctx: Context, room: String, ws: String?): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ROOM, room)
            .apply { if (ws != null) putExtra(EXTRA_WS, ws) }
        return PendingIntent.getActivity(ctx, idFor(room, ws), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun decision(ctx: Context, c: Computer, a: Approval, ws: String, decision: String): PendingIntent {
        val i = Intent(ctx, DecisionReceiver::class.java)
            .setAction("dev.elchi.orbit.DECIDE.$decision")
            .putExtra(DecisionReceiver.EXTRA_ROOM, c.room)
            .putExtra(DecisionReceiver.EXTRA_APPROVAL, a.id)
            .putExtra(DecisionReceiver.EXTRA_WS, ws)
            .putExtra(DecisionReceiver.EXTRA_DECISION, decision)
        return PendingIntent.getBroadcast(ctx, (a.id + decision).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun post(ctx: Context, tag: String, id: Int, n: Notification) {
        try {
            NotificationManagerCompat.from(ctx).notify(tag, id, n)
        } catch (_: SecurityException) {
            // notifications are off for Orbit; the app shows everything when opened
        }
    }

    private fun base(ctx: Context, channel: String) = NotificationCompat.Builder(ctx, channel)
        .setSmallIcon(R.drawable.ic_stat_orbit)
        .setColor(PEACH)
        .setAutoCancel(true)

    /**
     * "Backups needs you". With the one approval that waits, it says what and
     * offers Allow and Deny; without it (offline, or several) it opens the app.
     */
    fun needs(ctx: Context, c: Computer, alert: Alert, approval: Approval?, waiting: Int, multi: Boolean) {
        val ws = alert.ws
        val title = "${alert.title?.ifBlank { null } ?: "Orbit"} needs you"
        val text = when {
            approval != null && !multi -> "${ToolWords.headline(approval)}: ${ToolWords.approvalBody(approval).lineSequence().first().take(120)}"
            waiting > 1 -> "$waiting things wait for your approval."
            else -> "Claude waits for your approval."
        }
        val b = base(ctx, CH_NEEDS)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText(c.displayName)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(true)
            .setWhen(if (alert.at > 0) alert.at else System.currentTimeMillis())
            .setContentIntent(openIntent(ctx, c.room, ws))
        if (approval != null && !multi) {
            val big = buildString {
                append(ToolWords.headline(approval))
                append('\n')
                append(ToolWords.approvalBody(approval).take(400))
                approval.judge?.reason?.takeIf { it.isNotBlank() }?.let { append("\n\nThe judge wasn't sure. ").append(it) }
            }
            b.setStyle(NotificationCompat.BigTextStyle().bigText(big))
            b.addAction(0, "Allow", decision(ctx, c, approval, ws ?: approval.homeId, "allow"))
            b.addAction(0, "Deny", decision(ctx, c, approval, ws ?: approval.homeId, "deny"))
        }
        post(ctx, c.room, idFor(c.room, ws), b.build())
    }

    /** After Allow or Deny from the notification: a short word, then it goes. */
    fun decided(ctx: Context, room: String, ws: String?, text: String, ongoing: Boolean = false) {
        val n = base(ctx, CH_NEEDS)
            .setContentTitle(text)
            .setSilent(true)
            .setOngoing(ongoing)
            .setTimeoutAfter(if (ongoing) 30_000 else 4_000)
            .setContentIntent(openIntent(ctx, room, ws))
            .build()
        post(ctx, room, idFor(room, ws), n)
    }

    fun failed(ctx: Context, c: Computer, ws: String?, why: String) {
        val n = base(ctx, CH_NEEDS)
            .setContentTitle("Couldn't reach ${c.displayName}")
            .setContentText("$why Open Orbit to decide.")
            .setSilent(true)
            .setContentIntent(openIntent(ctx, c.room, ws))
            .build()
        post(ctx, c.room, idFor(c.room, ws), n)
    }

    /** Nothing waits any more: take back every "needs you" for that computer. */
    fun clear(ctx: Context, room: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        for (s in nm.activeNotifications) if (s.tag == room && s.notification.channelId == CH_NEEDS) nm.cancel(s.tag, s.id)
    }

    fun cancel(ctx: Context, room: String, ws: String?) {
        NotificationManagerCompat.from(ctx).cancel(room, idFor(room, ws))
    }

    fun done(ctx: Context, c: Computer, alert: Alert) {
        val n = base(ctx, CH_DONE)
            .setContentTitle("${alert.title?.ifBlank { null } ?: "A workspace"} finished")
            .setContentText("Open it to see what Claude did.")
            .setSubText(c.displayName)
            .setContentIntent(openIntent(ctx, c.room, alert.ws))
            .build()
        post(ctx, c.room, idFor(c.room, "done:${alert.ws}"), n)
    }

    fun test(ctx: Context, c: Computer, alert: Alert) {
        val n = base(ctx, CH_NEEDS)
            .setContentTitle(alert.title?.ifBlank { null } ?: "Test from Orbit")
            .setContentText("Alerts from ${c.displayName} reach this phone.")
            .setContentIntent(openIntent(ctx, c.room, null))
            .build()
        post(ctx, c.room, idFor(c.room, "test"), n)
    }

    fun service(ctx: Context, text: String): Notification = NotificationCompat.Builder(ctx, CH_SERVICE)
        .setSmallIcon(R.drawable.ic_stat_orbit)
        .setColor(PEACH)
        .setContentTitle("Orbit is connected")
        .setContentText(text)
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        .build()
}
