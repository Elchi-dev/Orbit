package dev.elchi.orbit.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.data.AlertMode
import dev.elchi.orbit.data.AppSettings
import dev.elchi.orbit.data.Computer
import dev.elchi.orbit.ui.components.Dot
import dev.elchi.orbit.ui.components.Hairline
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.components.OrbitButton
import dev.elchi.orbit.ui.components.OrbitField
import dev.elchi.orbit.ui.components.OrbitIconButton
import dev.elchi.orbit.ui.components.OrbitSwitch
import dev.elchi.orbit.ui.components.SectionLabel
import dev.elchi.orbit.ui.components.Tone
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.theme.MonoStyle
import dev.elchi.orbit.ui.theme.Orbit

data class SettingsUi(
    val computers: List<Computer>,
    val active: String?,
    val settings: AppSettings,
    val firebase: Boolean,
    val notificationsOn: Boolean,
    val batteryFree: Boolean,
    val appVersion: String,
    val orbitVersion: String?,
)

@Composable
fun SettingsScreen(
    ui: SettingsUi,
    onBack: () -> Unit,
    onSwitch: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onForget: (String) -> Unit,
    onAddComputer: () -> Unit,
    onAlertMode: (AlertMode) -> Unit,
    onStartOnBoot: (Boolean) -> Unit,
    onPhoneName: (String) -> Unit,
    onBattery: () -> Unit,
    onNotifications: () -> Unit,
    onLicenses: () -> Unit,
) {
    var renaming by remember { mutableStateOf<Computer?>(null) }
    var forgetting by remember { mutableStateOf<Computer?>(null) }
    Column(Modifier.fillMaxSize().background(Orbit.Ink)) {
        Row(Modifier.statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            OrbitIconButton(Ic.ChevronLeft, "Back", onBack)
            Text("Settings", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            SectionLabel("Computers")
            Group {
                ui.computers.forEachIndexed { i, c ->
                    if (i > 0) Hairline()
                    ComputerRow(c, c.room == ui.active, { onSwitch(c.room) }, { renaming = c }, { forgetting = c })
                }
                if (ui.computers.isNotEmpty()) Hairline()
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onAddComputer).heightIn(min = 52.dp).padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Ic.Plus, null, tint = Orbit.Peach, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(12.dp))
                    Text("Pair another computer", style = MaterialTheme.typography.labelLarge, color = Orbit.Peach)
                }
            }

            SectionLabel("This phone")
            Group {
                var name by rememberSaveable(ui.settings.phoneName) { mutableStateOf(ui.settings.phoneName) }
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Its name in Orbit", style = MaterialTheme.typography.labelMedium)
                    OrbitField(name, { name = it }, "Phone name", Modifier.fillMaxWidth(), onDone = { onPhoneName(name) })
                    if (name.trim() != ui.settings.phoneName) OrbitButton("Save", { onPhoneName(name) }, tone = Tone.LIGHT)
                    Text("Orbit shows it under Settings, Your phone. It changes there the next time this phone connects.", style = MaterialTheme.typography.bodySmall)
                }
            }

            SectionLabel("Alerts when the app is closed")
            Group {
                ModeRow(
                    "Through the relay", "Works for everyone. Orbit keeps one small connection to your relay and Android shows a quiet “Orbit is connected” notification while it does.",
                    ui.settings.alertMode == AlertMode.RELAY, true,
                ) { onAlertMode(AlertMode.RELAY) }
                Hairline()
                ModeRow(
                    "Firebase",
                    if (ui.firebase) "No background connection. Orbit sends alerts through Firebase Cloud Messaging; paste the project's service account key in Orbit, Settings, Your phone first."
                    else "This build of the app has no Firebase project, so alerts come through your relay.",
                    ui.settings.alertMode == AlertMode.FIREBASE, ui.firebase,
                ) { onAlertMode(AlertMode.FIREBASE) }
            }
            Group {
                if (ui.settings.alertMode == AlertMode.RELAY) {
                    SwitchRow("Start when the phone starts", "Listen again after a restart.", ui.settings.startOnBoot, onStartOnBoot)
                    Hairline()
                    ActionRow(
                        Ic.Battery, "Battery",
                        if (ui.batteryFree) "Orbit may keep its connection while the phone sleeps." else "Android may pause the connection to save power, and alerts can come late.",
                        if (ui.batteryFree) null else "Allow", onBattery,
                    )
                    Hairline()
                }
                ActionRow(
                    Ic.Bell, "Notifications",
                    if (ui.notificationsOn) "On. Approvals can be answered right from the notification." else "Off. Turn them on to hear when Claude needs you.",
                    if (ui.notificationsOn) null else "Turn on", onNotifications,
                )
            }
            Group {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                    Ori(OriPose.NEEDS, 44.dp, still = true)
                    Spacer(Modifier.width(12.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Send a test alert", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "The phone can't send one itself. In Orbit on the computer, open Settings, Your phone and choose Send a test alert. It arrives here in a few seconds, even with the app closed.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            SectionLabel("About")
            Group {
                InfoRow("App", ui.appVersion)
                Hairline()
                InfoRow("Orbit on ${ui.computers.firstOrNull { it.room == ui.active }?.displayName ?: "the computer"}", ui.orbitVersion ?: "not connected")
                Hairline()
                InfoRow("Encryption", "X25519, HKDF-SHA256, AES-256-GCM")
                Hairline()
                ActionRow(Ic.Book, "Licenses", "Fonts and libraries in this app", "Show", onLicenses)
            }
        }
    }

    renaming?.let { c ->
        var label by remember(c.room) { mutableStateOf(c.displayName) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            containerColor = Orbit.Surface,
            title = { Text("Rename") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Only on this phone. Orbit calls itself “${c.name}”.", color = Orbit.Star2, style = MaterialTheme.typography.bodySmall)
                    OrbitField(label, { label = it }, c.name, Modifier.fillMaxWidth())
                }
            },
            confirmButton = { TextButton({ onRename(c.room, label); renaming = null }) { Text("Save", color = Orbit.Peach) } },
            dismissButton = { TextButton({ renaming = null }) { Text("Cancel", color = Orbit.Star) } },
        )
    }
    forgetting?.let { c ->
        AlertDialog(
            onDismissRequest = { forgetting = null },
            containerColor = Orbit.Surface,
            title = { Text("Forget ${c.displayName}?") },
            text = { Text("This phone stops reaching it and gets no more alerts from it. To remove the phone on the computer as well, use Orbit, Settings, Your phone.", color = Orbit.Star2) },
            confirmButton = { TextButton({ onForget(c.room); forgetting = null }) { Text("Forget", color = Orbit.Danger) } },
            dismissButton = { TextButton({ forgetting = null }) { Text("Keep", color = Orbit.Star) } },
        )
    }
}

@Composable
private fun Group(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(Orbit.ShapeL).background(Orbit.Surface).border(1.dp, Orbit.Line, Orbit.ShapeL)) { content() }
}

@Composable
private fun ComputerRow(c: Computer, active: Boolean, onSwitch: () -> Unit, onRename: () -> Unit, onForget: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(active, role = Role.RadioButton, onClick = onSwitch).heightIn(min = 60.dp).padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(20.dp).clip(CircleShape).border(2.dp, if (active) Orbit.Peach else Orbit.Line2, CircleShape), contentAlignment = Alignment.Center) {
            if (active) Dot(Orbit.Peach, 10.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(c.displayName, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(c.relay.removePrefix("https://"), style = MonoStyle.copy(color = Orbit.Star3, fontSize = MaterialTheme.typography.labelSmall.fontSize), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        OrbitIconButton(Ic.Pencil, "Rename ${c.displayName}", onRename, tint = Orbit.Star3)
        OrbitIconButton(Ic.Trash, "Forget ${c.displayName}", onForget, tint = Orbit.Star3)
    }
}

@Composable
private fun ModeRow(title: String, body: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.padding(top = 2.dp).size(20.dp).clip(CircleShape).border(2.dp, if (selected) Orbit.Peach else Orbit.Line2, CircleShape), contentAlignment = Alignment.Center) {
            if (selected) Dot(Orbit.Peach, 10.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall, color = if (enabled) Orbit.Star else Orbit.Star3)
            Spacer(Modifier.height(2.dp))
            Text(body, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SwitchRow(title: String, body: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(body, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(10.dp))
        OrbitSwitch(on, onChange, title)
    }
}

@Composable
private fun ActionRow(icon: ImageVector, title: String, body: String, action: String?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = action != null, role = Role.Button, onClick = onClick).heightIn(min = 56.dp).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = Orbit.Star2, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(body, style = MaterialTheme.typography.bodySmall)
        }
        if (action != null) {
            Spacer(Modifier.width(8.dp))
            Text(action, style = MaterialTheme.typography.labelLarge, color = Orbit.Peach)
        }
    }
}

@Composable
private fun InfoRow(k: String, v: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(k, style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, modifier = Modifier.weight(1f))
        Text(v, style = MaterialTheme.typography.labelMedium, modifier = Modifier.widthIn(max = 220.dp), maxLines = 2)
    }
}

/** The fonts' licence and the libraries the app is built with. */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val ofl = remember { runCatching { context.resources.openRawResource(dev.elchi.orbit.R.raw.ofl).bufferedReader().readText() }.getOrDefault("") }
    Column(Modifier.fillMaxSize().background(Orbit.Ink)) {
        Row(Modifier.statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            OrbitIconButton(Ic.ChevronLeft, "Back", onBack)
            Text("Licenses", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${stringResource(dev.elchi.orbit.R.string.app_name)} uses these libraries under the Apache License 2.0:", style = MaterialTheme.typography.bodyMedium)
            Text(LIBRARIES.joinToString("\n") { "• $it" }, style = MaterialTheme.typography.bodySmall)
            Text("ZXing is under the Apache License 2.0 as well. The full text is at apache.org/licenses/LICENSE-2.0.", style = MaterialTheme.typography.bodySmall)
            Hairline()
            Text("Fonts: Figtree, Unbounded and JetBrains Mono, under the SIL Open Font License 1.1.", style = MaterialTheme.typography.bodyMedium)
            Text(ofl, style = MonoStyle.copy(fontSize = MaterialTheme.typography.labelSmall.fontSize, color = Orbit.Star2))
        }
    }
}

private val LIBRARIES = listOf(
    "AndroidX: Activity, Compose, Core, DataStore, Lifecycle, CameraX",
    "Kotlin, kotlinx.coroutines, kotlinx.serialization",
    "OkHttp and Okio",
    "Google Tink",
    "ZXing",
)
