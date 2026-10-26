package dev.elchi.orbit.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.model.Profile
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.state.Format
import dev.elchi.orbit.core.state.OrbitState
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.data.Computer
import dev.elchi.orbit.ui.components.ConnectionLine
import dev.elchi.orbit.ui.components.Dot
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.components.OrbitButton
import dev.elchi.orbit.ui.components.OrbitField
import dev.elchi.orbit.ui.components.OrbitIconButton
import dev.elchi.orbit.ui.components.OriEmpty
import dev.elchi.orbit.ui.components.Tone
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.sky.Sky
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Motion
import dev.elchi.orbit.ui.theme.Orbit
import dev.elchi.orbit.ui.theme.Unbounded
import dev.elchi.orbit.ui.workspace.Spinner
import kotlinx.coroutines.launch

data class HomeUi(
    val computer: Computer?,
    val computers: List<Computer>,
    val conn: ConnState,
    val state: OrbitState,
    val asList: Boolean,
    val profile: String?,
    val now: Long = System.currentTimeMillis(),
)

/** The ones that need you on top, then the busy ones, then the newest. */
fun homeOrder(list: List<Workspace>): List<Workspace> =
    list.sortedWith(compareByDescending<Workspace> { it.needsYou }.thenByDescending { it.busy }.thenByDescending { it.updatedAt })

@Composable
fun HomeScreen(
    ui: HomeUi,
    onOpen: (String) -> Unit,
    onLaunch: suspend (text: String, profile: String?) -> Boolean,
    onToggleList: () -> Unit,
    onApprovals: () -> Unit,
    onSettings: () -> Unit,
    onSwitch: (String) -> Unit,
    onAddComputer: () -> Unit,
    onRefresh: suspend () -> Unit,
    onRetry: () -> Unit,
    onProfile: (String) -> Unit,
    onArchive: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    val planets = ui.state.planets
    val waiting = ui.state.approvals
    Column(Modifier.fillMaxSize().background(Orbit.Void)) {
        TopBar(ui, planets.size, waiting.size, onApprovals, onToggleList, onSettings, onSwitch, onAddComputer)
        ConnectionLine(ui.conn, onRetry, onPairAgain = onAddComputer)
        val motion = LocalMotion.current
        AnimatedContent(
            ui.asList,
            transitionSpec = {
                if (motion.reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                else fadeIn(tween(Motion.MOVE, easing = Motion.Glide)) togetherWith fadeOut(tween(Motion.QUICK, easing = Motion.EaseIn))
            },
            modifier = Modifier.weight(1f),
            label = "home",
        ) { asList ->
            if (asList) WorkspaceList(ui, onOpen, onRefresh, onArchive, onDelete)
            else Box(Modifier.fillMaxSize()) {
                Sky(planets, onOpen, Modifier.fillMaxSize(), ui.now)
                if (planets.isEmpty() && ui.state.loaded) Text(
                    "Your first workspace starts here. Say what you want done.",
                    style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = 32.dp, vertical = 16.dp),
                )
                NeedsCards(ui, onOpen, Modifier.align(Alignment.BottomEnd).padding(12.dp))
            }
        }
        LaunchBar(ui, onLaunch, onProfile)
    }
}

@Composable
private fun TopBar(
    ui: HomeUi, count: Int, waiting: Int,
    onApprovals: () -> Unit, onToggleList: () -> Unit, onSettings: () -> Unit,
    onSwitch: (String) -> Unit, onAddComputer: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Ori(OriPose.IDLE, 26.dp, still = true, label = "Orbit")
                Spacer(Modifier.width(8.dp))
                Text("orbit", fontFamily = Unbounded, fontSize = 19.sp, color = Orbit.Star, modifier = Modifier.semantics { heading() })
            }
            Box {
                Row(
                    Modifier
                        .clip(Orbit.Shape)
                        .clickable(role = Role.Button, onClickLabel = "Switch computer") { menu = true }
                        .heightIn(min = 36.dp)
                        .padding(end = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val online = ui.conn is ConnState.Online
                    Dot(if (online) Orbit.Good else if (ui.conn is ConnState.Unpaired) Orbit.Peach else Orbit.Star3, 7.dp)
                    Spacer(Modifier.width(6.dp))
                    Text(ui.computer?.displayName ?: "No computer", style = MaterialTheme.typography.labelMedium, color = Orbit.Star2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp))
                    Icon(Ic.ChevronDown, null, tint = Orbit.Star3, modifier = Modifier.padding(start = 2.dp).size(14.dp))
                }
                DropdownMenu(menu, { menu = false }, containerColor = Orbit.Surface2) {
                    for (c in ui.computers) DropdownMenuItem(
                        text = { Text(c.displayName, color = if (c.room == ui.computer?.room) Orbit.Peach else Orbit.Star) },
                        leadingIcon = { Icon(Ic.Computer, null, tint = Orbit.Star2, modifier = Modifier.size(18.dp)) },
                        trailingIcon = { if (c.room == ui.computer?.room) Icon(Ic.Check, null, tint = Orbit.Peach, modifier = Modifier.size(16.dp)) },
                        onClick = { menu = false; onSwitch(c.room) },
                    )
                    HorizontalDivider(color = Orbit.Line)
                    DropdownMenuItem(text = { Text("Pair another computer") }, leadingIcon = { Icon(Ic.Plus, null, tint = Orbit.Star2, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; onAddComputer() })
                }
            }
            Row {
                Text("$count ${if (count == 1) "workspace" else "workspaces"}", style = MaterialTheme.typography.labelSmall)
                if (waiting > 0) Text(", $waiting ${if (waiting == 1) "needs" else "need"} you", style = MaterialTheme.typography.labelSmall.copy(color = Orbit.Peach))
            }
        }
        Box {
            OrbitIconButton(Ic.Bell, if (waiting > 0) "$waiting waiting for you" else "Waiting for you", onApprovals, tint = if (waiting > 0) Orbit.Peach else Orbit.Star2)
            if (waiting > 0) Box(
                Modifier.align(Alignment.TopEnd).offset(x = (-6).dp, y = 6.dp).size(16.dp).clip(CircleShape).background(Orbit.Peach),
                contentAlignment = Alignment.Center,
            ) { Text("$waiting", color = Orbit.PeachInk, fontSize = 10.sp, style = MaterialTheme.typography.labelSmall.copy(color = Orbit.PeachInk)) }
        }
        OrbitIconButton(if (ui.asList) Ic.Sky else Ic.List, if (ui.asList) "Show the sky" else "Show as a list", onToggleList)
        OrbitIconButton(Ic.Settings, "Settings", onSettings)
    }
}

@Composable
private fun NeedsCards(ui: HomeUi, onOpen: (String) -> Unit, modifier: Modifier) {
    val list = ui.state.approvals.take(3)
    val motion = LocalMotion.current
    Column(modifier.widthIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.End) {
        list.forEach { a ->
            AnimatedVisibility(
                true,
                enter = if (motion.reduced) fadeIn(tween(0)) else slideInHorizontally(tween(Motion.MOVE, easing = Motion.Glide)) { it / 4 } + fadeIn(),
                exit = slideOutHorizontally { it / 4 } + fadeOut(),
            ) {
                Row(
                    Modifier
                        .clip(Orbit.ShapeL)
                        .background(Color(0xF013131F))
                        .border(1.dp, Orbit.Line, Orbit.ShapeL)
                        .clickable(role = Role.Button, onClickLabel = "Open") { onOpen(a.homeId) }
                        .semantics(mergeDescendants = true) {}
                        .padding(start = 0.dp, end = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(width = 2.dp, height = 52.dp).background(Orbit.Peach))
                    Spacer(Modifier.width(12.dp))
                    Icon(Ic.Alert, null, tint = Orbit.Peach, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.padding(vertical = 9.dp)) {
                        Text("${ui.state.workspaces[a.homeId]?.title ?: a.homeTitle} needs you", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(a.subject.take(48), style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkspaceList(ui: HomeUi, onOpen: (String) -> Unit, onRefresh: suspend () -> Unit, onArchive: (String) -> Unit, onDelete: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val list = homeOrder(ui.state.planets)
    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; runCatching { onRefresh() }; refreshing = false } }, Modifier.fillMaxSize()) {
        if (list.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                OriEmpty(OriPose.HI, "Nothing here yet", "Start one below: say what you want done.")
            }
        } else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)) {
            itemsIndexed(list, key = { _, w -> w.id }) { _, w -> WorkspaceRow(w, ui, onOpen, onArchive, onDelete) }
        }
    }
}

@Composable
private fun WorkspaceRow(w: Workspace, ui: HomeUi, onOpen: (String) -> Unit, onArchive: (String) -> Unit, onDelete: (String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val state = when {
        w.needsYou -> "needs you"
        w.busy -> Format.helpersLine(w)
        else -> Format.ago(w.updatedAt, ui.now)
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Orbit.Shape)
            .clickable(role = Role.Button, onClickLabel = "Open") { onOpen(w.id) }
            .semantics(mergeDescendants = true) { contentDescription = "${w.title}, $state" }
            .heightIn(min = 60.dp)
            .padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(Color(w.style.color.toInt()), 11.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(w.title, style = MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${Format.shortPath(w.cwd, ui.state.server?.home)}, ${Format.ago(w.updatedAt, ui.now)}",
                style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        when {
            w.needsYou -> Text("needs you", style = MaterialTheme.typography.labelMedium, color = Orbit.Peach)
            w.busy -> Row(verticalAlignment = Alignment.CenterVertically) {
                Spinner(13.dp)
                Spacer(Modifier.width(6.dp))
                Text(Format.helpersLine(w), style = MaterialTheme.typography.labelMedium, color = Orbit.Lav)
            }
        }
        Box {
            OrbitIconButton(Ic.ChevronDown, "More for ${w.title}", { menu = true }, tint = Orbit.Star3)
            DropdownMenu(menu, { menu = false }, containerColor = Orbit.Surface2) {
                DropdownMenuItem(text = { Text("Archive") }, onClick = { menu = false; onArchive(w.id) })
                DropdownMenuItem(text = { Text("Delete", color = Orbit.Danger) }, onClick = { menu = false; confirm = true })
            }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        containerColor = Orbit.Surface,
        title = { Text("Delete “${w.title}”?") },
        text = { Text("Its history goes. Files in the folder stay.", color = Orbit.Star2) },
        confirmButton = { TextButton({ confirm = false; onDelete(w.id) }) { Text("Delete", color = Orbit.Danger) } },
        dismissButton = { TextButton({ confirm = false }) { Text("Keep it", color = Orbit.Star) } },
    )
}

/** "What are we working on?": makes a workspace with the chosen profile and sends the first message. */
@Composable
private fun LaunchBar(ui: HomeUi, onLaunch: suspend (String, String?) -> Boolean, onProfile: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val profiles: List<Profile> = ui.state.server?.profiles ?: emptyList()
    val chosen = profiles.firstOrNull { it.id == ui.profile } ?: profiles.firstOrNull { it.id == ui.state.server?.defaultProfile } ?: profiles.firstOrNull()
    val online = ui.conn is ConnState.Online
    fun go() {
        if (busy || !online) return
        scope.launch {
            busy = true
            if (onLaunch(text.trim(), chosen?.id)) text = ""
            busy = false
        }
    }
    Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            Modifier.fillMaxWidth().clip(Orbit.ShapeL).background(Color(0xF013131F)).border(1.dp, Orbit.Line, Orbit.ShapeL).padding(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box {
                Row(
                    Modifier.clip(Orbit.Shape).clickable(enabled = profiles.isNotEmpty(), role = Role.Button, onClickLabel = "Choose a profile") { menu = true }
                        .heightIn(min = 44.dp).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(chosen?.name ?: "Profile", style = MaterialTheme.typography.labelMedium, color = Orbit.Star2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 96.dp))
                    Icon(Ic.ChevronUp, null, tint = Orbit.Star3, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                }
                DropdownMenu(menu, { menu = false }, containerColor = Orbit.Surface2) {
                    for (p in profiles) DropdownMenuItem(
                        text = {
                            Column(Modifier.widthIn(max = 280.dp)) {
                                Text(p.name, style = MaterialTheme.typography.labelLarge, color = if (p.id == chosen?.id) Orbit.Peach else Orbit.Star)
                                if (p.description.isNotBlank()) Text(p.description, style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        },
                        onClick = { menu = false; onProfile(p.id) },
                    )
                }
            }
            OrbitField(text, { text = it }, "What are we working on?", Modifier.weight(1f), imeAction = ImeAction.Go, onDone = { go() })
            Spacer(Modifier.width(6.dp))
            OrbitButton(if (busy) "Starting" else "Launch", { go() }, tone = Tone.PEACH, icon = Ic.ArrowUpRight, enabled = online && !busy, haptic = true)
        }
    }
}
