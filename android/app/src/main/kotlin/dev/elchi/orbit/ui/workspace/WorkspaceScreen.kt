package dev.elchi.orbit.ui.workspace

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.model.Detail
import dev.elchi.orbit.core.model.Effort
import dev.elchi.orbit.core.model.Mode
import dev.elchi.orbit.core.model.ServerInfo
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.state.Conversation
import dev.elchi.orbit.core.state.Ended
import dev.elchi.orbit.core.state.LiveStream
import dev.elchi.orbit.core.state.OriLogic
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.ui.components.ConnectionLine
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.components.OrbitButton
import dev.elchi.orbit.ui.components.OrbitIconButton
import dev.elchi.orbit.ui.components.OriEmpty
import dev.elchi.orbit.ui.components.Tone
import dev.elchi.orbit.ui.components.pressDip
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Motion
import dev.elchi.orbit.ui.theme.Orbit
import kotlinx.coroutines.launch

/** What the workspace screen shows; plain data so previews can fill it. */
data class WorkspaceUi(
    val ws: Workspace,
    val detail: Detail?,
    val stream: LiveStream?,
    val shellOut: Map<String, String>,
    val ended: Ended?,
    val queued: Int,
    val server: ServerInfo?,
    val conn: ConnState,
    val children: List<Workspace>,
    val waiting: Int,
    val now: Long = System.currentTimeMillis(),
)

@Composable
fun WorkspaceScreen(
    ui: WorkspaceUi,
    onBack: () -> Unit,
    onSend: (text: String, effort: String?, web: Boolean) -> Boolean,
    onStop: () -> Unit,
    onMode: (Mode) -> Unit,
    onRefresh: suspend () -> Unit,
    onOpenWorkspace: (String) -> Unit,
    onShowApproval: () -> Unit,
    onRetry: () -> Unit,
) {
    val ws = ui.ws
    val detail = ui.detail
    val turns = remember(detail?.messages) { Conversation.turns(detail?.messages ?: emptyList()) }
    val streamBlocks = remember(ui.stream) { Conversation.streamBlocks(ui.stream) }
    val lastIsUser = turns.lastOrNull()?.role == "user"
    val showLive = ws.running && (streamBlocks.isNotEmpty() || lastIsUser)
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val atBottom by remember { derivedStateOf { !list.canScrollForward } }
    val liveLength = streamBlocks.sumOf { (it?.toString()?.length ?: 0) }
    val count = turns.size + (if (showLive) 1 else 0)

    // stay pinned to the newest unless the reader scrolled up
    var pinned by remember { mutableStateOf(true) }
    LaunchedEffect(list.isScrollInProgress) { if (!list.isScrollInProgress) pinned = atBottom }
    LaunchedEffect(count, liveLength, detail?.calls?.size) {
        if (pinned && count > 0) list.scrollToItem(count + 1)
    }

    val ori = OriLogic.status(ws, detail, ui.stream, ui.ended, ui.now)
    val profile = ui.server?.profiles?.firstOrNull { it.id == ws.profile }

    Column(Modifier.fillMaxSize().background(Orbit.Ink)) {
        Header(ws, ori.pose, ori.doing, profile?.name, onBack, onMode)
        ConnectionLine(ui.conn, onRetry)
        Box(Modifier.weight(1f)) {
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; runCatching { onRefresh() }; refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    state = list,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 8.dp, bottom = 24.dp),
                ) {
                    if (ws.summary.isNotBlank()) item("summary") { Summary(ws.summary) }
                    if (detail == null) item("loading") {
                        OriEmpty(OriPose.THINKING, "Loading the conversation", null, Modifier.fillMaxWidth(), size = 96.dp)
                    } else if (turns.isEmpty() && !ws.running) item("empty") {
                        OriEmpty(OriPose.HI, "What should happen here?", "Claude works in ${ws.cwd} with a real shell. Anything that changes the computer passes the approval gate first.", Modifier.fillMaxWidth())
                    }
                    items(turns, key = { it.id }) { t ->
                        if (t.role == "user") UserTurn(t)
                        else AssistantTurn(t.blocks, detail ?: Detail.EMPTY, ui.shellOut, ui.children, onOpenWorkspace)
                    }
                    if (showLive) item("live") {
                        AssistantTurn(streamBlocks, detail ?: Detail.EMPTY, ui.shellOut, ui.children, onOpenWorkspace, live = true)
                    }
                    item("end") { Spacer(Modifier.size(1.dp)) }
                }
            }
            androidx.compose.animation.AnimatedVisibility(
                !atBottom && count > 2,
                enter = fadeIn(tween(Motion.QUICK)) + scaleIn(initialScale = 0.9f),
                exit = fadeOut(tween(Motion.TAP)),
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            ) {
                OrbitButton("Latest", { pinned = true; scope.launch { list.animateScrollToItem(count + 1) } }, tone = Tone.OUTLINE, icon = Ic.ArrowDown, modifier = Modifier.background(Orbit.Surface, Orbit.Shape))
            }
        }
        Column(
            Modifier.fillMaxWidth().background(Orbit.Ink).navigationBarsPadding().imePadding().padding(horizontal = 12.dp).padding(bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (ui.waiting > 0) WaitingBar(ui.waiting, onShowApproval)
            PlanBar(ws.plan)
            if (ui.queued > 0) Text(
                if (ui.queued == 1) "1 message waits for Claude's next step" else "${ui.queued} messages wait for Claude's next step",
                style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp),
            )
            Composer(ws, ui.server, onSend, onStop, enabled = ui.conn is ConnState.Online)
        }
    }
}

@Composable
private fun Summary(text: String) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(Orbit.Shape).background(Orbit.Surface).clickable { open = !open }.padding(12.dp)) {
        Text("Earlier work in this workspace was summarised", style = MaterialTheme.typography.labelMedium, color = Orbit.Star2)
        AnimatedVisibility(open) { MarkdownView(text, small = true, modifier = Modifier.padding(top = 8.dp)) }
    }
}

@Composable
private fun Header(ws: Workspace, pose: OriPose, doing: String, profile: String?, onBack: () -> Unit, onMode: (Mode) -> Unit) {
    Column(Modifier.fillMaxWidth().background(Orbit.Ink).statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OrbitIconButton(Ic.ChevronLeft, "Back to the sky", onBack)
            // Ori is the status: a quick cross-fade when it changes
            AnimatedContent(pose, transitionSpec = { fadeIn(tween(Motion.QUICK)) togetherWith fadeOut(tween(Motion.QUICK)) }, label = "ori") { p ->
                Ori(p, 40.dp, label = "Ori: $doing")
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(ws.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                val c = when (pose) { OriPose.NEEDS -> Orbit.Peach; OriPose.IDLE, OriPose.SLEEPING, OriPose.DONE -> Orbit.Star3; OriPose.OOPS -> Orbit.Danger; else -> Orbit.Lav }
                Text(doing, style = MaterialTheme.typography.labelSmall.copy(color = c), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
        Row(Modifier.padding(start = 8.dp, end = 4.dp, top = 2.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (profile != null) Text(profile, style = MaterialTheme.typography.labelMedium, color = Orbit.Star2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).padding(end = 8.dp))
            Spacer(Modifier.weight(1f))
            ModeSwitch(Mode.of(ws.mode), onMode)
        }
    }
}

/** The four approval modes as a segmented switch; the chosen one shows its name. */
@Composable
fun ModeSwitch(value: Mode, onChange: (Mode) -> Unit, modifier: Modifier = Modifier) {
    val h = LocalHapticFeedback.current
    Row(modifier.clip(Orbit.Shape).background(Orbit.Well).border(1.dp, Orbit.Line, Orbit.Shape).padding(3.dp).semantics { contentDescription = "Approval mode" }) {
        for (m in Mode.entries) {
            val on = m == value
            val icon = when (m) { Mode.MANUAL -> Ic.Hand; Mode.AUTO -> Ic.Scale; Mode.RULES -> Ic.ListChecks; Mode.FULL -> Ic.Zap }
            Row(
                Modifier
                    .clip(RoundedShape)
                    .background(if (on) Orbit.Surface3 else Color.Transparent)
                    .clickable(role = Role.RadioButton, onClickLabel = m.tip) {
                        if (!on) {
                            h.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onChange(m)
                        }
                    }
                    .semantics { selected = on; contentDescription = "${m.label}: ${m.tip}" }
                    .heightIn(min = 36.dp)
                    .padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, null, tint = if (on) Orbit.Star else Orbit.Star3, modifier = Modifier.size(15.dp))
                if (on) {
                    Spacer(Modifier.width(6.dp))
                    Text(m.label, style = MaterialTheme.typography.labelMedium, color = Orbit.Star)
                }
            }
        }
    }
}

private val RoundedShape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)

@Composable
private fun WaitingBar(n: Int, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Orbit.ShapeL)
            .background(Orbit.Peach.copy(alpha = 0.1f))
            .border(1.dp, Orbit.Peach.copy(alpha = 0.4f), Orbit.ShapeL)
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 48.dp)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Ori(OriPose.NEEDS, 28.dp, still = true)
        Spacer(Modifier.width(10.dp))
        Text(if (n == 1) "Claude is waiting for your approval" else "$n things wait for your approval", style = MaterialTheme.typography.labelLarge, color = Orbit.Peach, modifier = Modifier.weight(1f))
        Icon(Ic.ChevronRight, null, tint = Orbit.Peach, modifier = Modifier.size(18.dp))
    }
}

/** Text, send, stop while running; a message sent while running joins the run. Effort and web below. */
@Composable
private fun Composer(ws: Workspace, server: ServerInfo?, onSend: (String, String?, Boolean) -> Boolean, onStop: () -> Unit, enabled: Boolean) {
    val profile = server?.profiles?.firstOrNull { it.id == ws.profile }
    var text by rememberSaveable(ws.id) { mutableStateOf("") }
    var effort by rememberSaveable(ws.id) { mutableStateOf<String?>(null) }
    var web by rememberSaveable(ws.id) { mutableStateOf(profile?.web ?: false) }
    var effortOpen by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    val h = LocalHapticFeedback.current
    val motion = LocalMotion.current
    val running = ws.running
    // while Claude works, the border breathes peach slowly
    val breath = if (running && !motion.reduced) rememberInfiniteTransition(label = "c").animateFloat(0.15f, 0.45f, infiniteRepeatable(tween(2400), RepeatMode.Reverse), label = "b").value else 0f
    val border = when {
        focused -> Orbit.Lav.copy(alpha = 0.6f)
        running -> Orbit.Peach.copy(alpha = breath)
        else -> Orbit.Line
    }
    val defaultEffort = profile?.effort?.ifBlank { null } ?: server?.defaultEffort ?: "medium"
    val shownEffort = Effort.of(effort ?: defaultEffort)?.label ?: (effort ?: defaultEffort)

    fun submit() {
        val t = text.trim()
        if (t.isEmpty()) return
        if (onSend(t, effort, web)) {
            h.performHapticFeedback(HapticFeedbackType.Confirm)
            text = ""
        }
    }

    Column(Modifier.fillMaxWidth().clip(Orbit.ShapeL).background(Orbit.Surface).border(1.dp, border, Orbit.ShapeL).padding(start = 6.dp, end = 6.dp, top = 4.dp, bottom = 6.dp)) {
        BasicTextField(
            value = text,
            onValueChange = { text = it },
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = Orbit.Star, fontSize = 15.5.sp),
            cursorBrush = SolidColor(Orbit.Peach),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Default),
            maxLines = 8,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp)
                .padding(horizontal = 10.dp, vertical = 10.dp)
                .onFocusChanged { focused = it.isFocused }
                .semantics { contentDescription = "Message to Claude" },
            decorationBox = { inner ->
                Box {
                    if (text.isEmpty()) Text(
                        if (running) "Claude is working. Anything you send now joins in at its next step." else "Tell Claude what to do next",
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.5.sp), color = Orbit.Star3,
                    )
                    inner()
                }
            },
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pill(if (web) "Web on" else "Web", Ic.Globe, on = web, label = if (web) "Web search is on" else "Let Claude search the web") { web = !web }
            Spacer(Modifier.width(4.dp))
            Box {
                Pill(shownEffort, Ic.Gauge, on = effort != null, label = "Thinking effort: $shownEffort") { effortOpen = true }
                DropdownMenu(effortOpen, { effortOpen = false }, containerColor = Orbit.Surface2) {
                    for (e in Effort.entries) DropdownMenuItem(
                        text = {
                            Column {
                                Text(e.label, style = MaterialTheme.typography.labelLarge, color = if ((effort ?: defaultEffort) == e.id) Orbit.Peach else Orbit.Star)
                                Text(e.hint, style = MaterialTheme.typography.labelSmall)
                            }
                        },
                        onClick = { effort = if (e.id == defaultEffort) null else e.id; effortOpen = false },
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            if (running) {
                RoundAction(Ic.Stop, "Stop", Orbit.Surface3, Orbit.Star) { h.performHapticFeedback(HapticFeedbackType.Reject); onStop() }
                Spacer(Modifier.width(6.dp))
            }
            val canSend = text.isNotBlank() && enabled
            RoundAction(Ic.ArrowUp, if (running) "Send now, joins the run" else "Send", if (canSend) Orbit.Peach else Orbit.Surface3, if (canSend) Orbit.PeachInk else Orbit.Star3, enabled = canSend) { submit() }
        }
    }
}

@Composable
private fun Pill(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, on: Boolean, label: String, onClick: () -> Unit) {
    val source = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Row(
        Modifier
            .pressDip(source)
            .clip(Orbit.Shape)
            .background(if (on) Orbit.Hover else Color.Transparent)
            .clickable(source, androidx.compose.material3.ripple(), role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label; stateDescription = if (on) "on" else "off" }
            .heightIn(min = 40.dp)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (on) Orbit.Peach else Orbit.Star2, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = if (on) Orbit.Star else Orbit.Star2)
    }
}

@Composable
private fun RoundAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, bg: Color, fg: Color, enabled: Boolean = true, onClick: () -> Unit) {
    val source = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    val s by animateFloatAsState(if (enabled) 1f else 0.96f, tween(Motion.QUICK), label = "s")
    Box(
        Modifier
            .pressDip(source, 0.92f)
            .size(44.dp)
            .clip(CircleShape)
            .background(bg)
            .clickable(source, androidx.compose.material3.ripple(color = fg), enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = fg, modifier = Modifier.size((19 * s).dp)) }
}
