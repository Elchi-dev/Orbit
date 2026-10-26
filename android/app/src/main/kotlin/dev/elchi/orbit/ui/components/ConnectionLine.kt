package dev.elchi.orbit.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.ui.theme.Motion
import dev.elchi.orbit.ui.theme.Orbit
import dev.elchi.orbit.ui.workspace.Spinner
import kotlinx.coroutines.delay

/** One quiet line about the connection: nothing while online. */
@Composable
fun ConnectionLine(conn: ConnState, onRetry: () -> Unit, onPairAgain: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    // a brief "connecting" right after start isn't worth a line
    var shownSince by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(conn) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    LaunchedEffect(conn is ConnState.Online) { if (conn !is ConnState.Online) shownSince = System.currentTimeMillis() }
    val visible = when (conn) {
        is ConnState.Online, ConnState.Idle -> false
        is ConnState.Connecting -> conn.attempt > 1 || now - shownSince > 1500
        else -> true
    }
    AnimatedVisibility(visible, modifier, enter = expandVertically(tween(Motion.MOVE, easing = Motion.Glide)) + fadeIn(), exit = shrinkVertically(tween(Motion.QUICK)) + fadeOut()) {
        val unpaired = conn is ConnState.Unpaired
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp)
                .clip(Orbit.Shape)
                .background(if (unpaired) Orbit.Peach.copy(alpha = 0.1f) else Orbit.Surface)
                .clickable(role = Role.Button, onClickLabel = if (unpaired) "Pair again" else "Try again now") { if (unpaired) onPairAgain?.invoke() else onRetry() }
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
                .heightIn(min = 40.dp)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when (conn) {
                is ConnState.Connecting -> {
                    Spinner(14.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("Connecting to Orbit", style = MaterialTheme.typography.labelMedium, color = Orbit.Star2)
                }
                is ConnState.Offline -> {
                    Icon(Ic.WifiOff, null, tint = Orbit.Star3, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(10.dp))
                    val secs = ((conn.retryAt - now) / 1000).coerceAtLeast(0)
                    Text(
                        conn.reason + if (secs > 0) " Trying again in $secs s." else "",
                        style = MaterialTheme.typography.labelMedium, color = Orbit.Star2, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Retry", style = MaterialTheme.typography.labelLarge, color = Orbit.Peach)
                }
                is ConnState.Unpaired -> {
                    Icon(Ic.Alert, null, tint = Orbit.Peach, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(if (conn.reason.contains("expired")) conn.reason else "This phone is no longer paired.", style = MaterialTheme.typography.labelMedium, color = Orbit.Star, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (onPairAgain != null) {
                        Spacer(Modifier.width(8.dp))
                        Text("Pair again", style = MaterialTheme.typography.labelLarge, color = Orbit.Peach)
                    }
                }
                else -> {}
            }
        }
    }
}
