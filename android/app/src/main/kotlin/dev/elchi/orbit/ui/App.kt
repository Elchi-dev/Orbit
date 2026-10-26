package dev.elchi.orbit.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.PredictiveBackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.elchi.orbit.BuildConfig
import dev.elchi.orbit.OrbitApp
import dev.elchi.orbit.alerts.AlertService
import dev.elchi.orbit.core.model.Mode
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.pairing.PairingLink
import dev.elchi.orbit.core.state.Effect
import dev.elchi.orbit.core.state.OrbitState
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.data.AlertMode
import dev.elchi.orbit.data.Notice
import dev.elchi.orbit.push.Push
import dev.elchi.orbit.ui.approval.ApprovalSheet
import dev.elchi.orbit.ui.approval.ApprovalsScreen
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.components.OrbitButton
import dev.elchi.orbit.ui.components.OriEmpty
import dev.elchi.orbit.ui.components.Tone
import dev.elchi.orbit.ui.home.HomeScreen
import dev.elchi.orbit.ui.home.HomeUi
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.pair.PairState
import dev.elchi.orbit.ui.pair.PairingScreen
import dev.elchi.orbit.ui.pair.ScanScreen
import dev.elchi.orbit.ui.pair.WelcomeScreen
import dev.elchi.orbit.ui.settings.LicensesScreen
import dev.elchi.orbit.ui.settings.SettingsScreen
import dev.elchi.orbit.ui.settings.SettingsUi
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Motion
import dev.elchi.orbit.ui.theme.Orbit
import dev.elchi.orbit.ui.workspace.WorkspaceScreen
import dev.elchi.orbit.ui.workspace.WorkspaceUi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Where the app is. Kept as strings so the back stack survives a recreate. */
sealed interface Route {
    data object Welcome : Route
    data object Scan : Route
    data object Pairing : Route
    data object Home : Route
    data class Ws(val id: String) : Route
    data object Approvals : Route
    data object Settings : Route
    data object Licenses : Route

    fun key(): String = when (this) {
        is Ws -> "ws:$id"
        else -> this::class.simpleName!!.lowercase()
    }

    companion object {
        fun of(s: String): Route = when {
            s.startsWith("ws:") -> Ws(s.removePrefix("ws:"))
            s == "scan" -> Scan
            s == "pairing" -> Pairing
            s == "approvals" -> Approvals
            s == "settings" -> Settings
            s == "licenses" -> Licenses
            s == "welcome" -> Welcome
            else -> Home
        }
    }
}

/** Requests from outside the app: a pairing link, or a notification's workspace. */
data class Incoming(val link: String? = null, val room: String? = null, val ws: String? = null, val nonce: Long = System.nanoTime())

private val stackSaver = listSaver<SnapshotStateList<Route>, String>({ it.map(Route::key) }, { mutableStateListOf<Route>().apply { addAll(it.map(Route::of)) } })

@Composable
fun OrbitAppRoot(app: OrbitApp, incoming: StateFlow<Incoming?>) {
    val hub = app.hub
    val loaded by hub.loaded.collectAsStateWithLifecycle()
    val computers by hub.computers.collectAsStateWithLifecycle()
    val settings by hub.settings.collectAsStateWithLifecycle()
    val connection by hub.connection.collectAsStateWithLifecycle()
    val conn by (connection?.conn ?: remember { MutableStateFlow<ConnState>(ConnState.Idle) }).collectAsStateWithLifecycle()
    val state by (connection?.state ?: remember { MutableStateFlow(OrbitState()) }).collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val stack = rememberSaveable(saver = stackSaver) { mutableStateListOf<Route>() }
    var pairState by remember { mutableStateOf<PairState?>(null) }
    var askNotifications by rememberSaveable { mutableStateOf(false) }
    var sheetId by rememberSaveable { mutableStateOf<String?>(null) }
    val dismissed = remember { mutableStateListOf<String>() }
    val notice = remember { mutableStateOf<Notice?>(null) }

    if (!loaded) {
        Box(Modifier.fillMaxSize().background(Orbit.Void))
        return
    }
    if (stack.isEmpty()) stack.add(if (computers.isEmpty()) Route.Welcome else Route.Home)
    val route = stack.last()

    fun go(r: Route) {
        if (stack.lastOrNull() != r) stack.add(r)
    }
    fun back() {
        if (stack.size > 1) stack.removeAt(stack.lastIndex)
    }
    fun home() {
        stack.clear()
        stack.add(if (hub.computers.value.isEmpty()) Route.Welcome else Route.Home)
    }

    fun startPairing(link: String) {
        val p = runCatching { PairingLink.parse(link) }.getOrElse {
            pairState = PairState.Failed(it.message ?: "That link doesn't work.")
            go(Route.Pairing)
            return
        }
        pairState = PairState.Working(p.name)
        go(Route.Pairing)
        scope.launch {
            hub.pair(p).fold(
                { w -> pairState = PairState.Done(w.name.ifBlank { p.name }); haptic.performHapticFeedback(HapticFeedbackType.Confirm) },
                { e -> pairState = PairState.Failed(e.message ?: "Couldn't pair.") },
            )
        }
    }

    // a link from outside, or a notification
    val inc by incoming.collectAsState()
    LaunchedEffect(inc?.nonce) {
        val i = inc ?: return@LaunchedEffect
        if (i.link != null) startPairing(i.link)
        else if (i.room != null) {
            hub.setActive(i.room)
            home()
            if (i.ws != null) go(Route.Ws(i.ws))
        }
    }

    // gone from the computer list (forgot the last one): back to the start
    LaunchedEffect(computers.isEmpty()) {
        if (computers.isEmpty() && route != Route.Pairing && route != Route.Scan) home()
    }

    LaunchedEffect(Unit) { hub.notices.collect { notice.value = it } }
    LaunchedEffect(connection) {
        connection?.arrivals?.collect { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    }

    // keep the open workspace fresh after reconnects
    LaunchedEffect(route, connection) {
        val c = connection ?: return@LaunchedEffect
        c.openWorkspace = (route as? Route.Ws)?.id
        if (route is Route.Ws) c.loadDetail(route.id)
    }

    // predictive back: the screen shrinks a little as you pull, like going back to the sky
    var backProgress by remember { mutableFloatStateOf(0f) }
    PredictiveBackHandler(enabled = stack.size > 1) { progress ->
        try {
            progress.collect { backProgress = it.progress }
            backProgress = 0f
            back()
        } catch (e: CancellationException) {
            backProgress = 0f
            throw e
        }
    }

    val motion = LocalMotion.current
    Box(Modifier.fillMaxSize().background(Orbit.Void)) {
        AnimatedContent(
            route,
            transitionSpec = { routeTransition(initialState, targetState, stack, motion.reduced) },
            contentKey = { it.key() },
            label = "route",
            modifier = Modifier.graphicsLayer {
                val s = 1f - 0.08f * backProgress
                scaleX = s
                scaleY = s
                alpha = 1f - 0.3f * backProgress
            },
        ) { r ->
            when (r) {
                Route.Welcome -> WelcomeScreen(onScan = { go(Route.Scan) }, onLink = ::startPairing)
                Route.Scan -> ScanScreen(onBack = ::back, onLink = ::startPairing)
                Route.Pairing -> PairingScreen(
                    pairState ?: PairState.Failed("Nothing to pair."),
                    onContinue = {
                        home()
                        if (!settings.askedNotifications) askNotifications = true
                        AlertService.sync(context)
                    },
                    onRetry = { back(); if (stack.last() != Route.Scan) go(Route.Scan) },
                    onBack = { home() },
                )
                Route.Home -> {
                    val c = connection
                    HomeScreen(
                        HomeUi(c?.computer, computers, conn, state, settings.skyAsList, settings.lastProfile),
                        onOpen = { go(Route.Ws(it)) },
                        onLaunch = { text, profile ->
                            val cc = connection ?: return@HomeScreen false
                            val ws = cc.createWorkspace(profile, null).getOrElse {
                                hub.notice(Notice("Couldn't create the workspace", it.message, Effect.Tone.BAD))
                                return@HomeScreen false
                            }
                            go(Route.Ws(ws.id))
                            if (text.isNotBlank()) {
                                delay(150)
                                cc.send(ws.id, text, null, null)
                            }
                            true
                        },
                        onToggleList = { scope.launch { hub.store.setSkyAsList(!settings.skyAsList) } },
                        onApprovals = { go(Route.Approvals) },
                        onSettings = { go(Route.Settings) },
                        onSwitch = { scope.launch { hub.setActive(it) } },
                        onAddComputer = { go(Route.Scan) },
                        onRefresh = { connection?.refresh() },
                        onRetry = { connection?.kick() },
                        onProfile = { scope.launch { hub.store.setLastProfile(it) } },
                        onArchive = { id -> scope.launch { connection?.patchWorkspace(id, "archived" to 1)?.onFailure { hub.notice(Notice("Couldn't archive it", it.message, Effect.Tone.BAD)) }; connection?.refresh() } },
                        onDelete = { id -> scope.launch { connection?.deleteWorkspace(id)?.onFailure { hub.notice(Notice("Couldn't delete it", it.message, Effect.Tone.BAD)) } } },
                    )
                }
                is Route.Ws -> {
                    val ws = state.workspaces[r.id]
                    val c = connection
                    if (ws == null || c == null) Box(Modifier.fillMaxSize().background(Orbit.Ink).statusBarsPadding(), contentAlignment = Alignment.Center) {
                        OriEmpty(
                            if (state.loaded) OriPose.OOPS else OriPose.THINKING,
                            if (state.loaded) "This workspace is gone" else "Loading",
                            if (state.loaded) "It may have been deleted or archived on the computer." else null,
                            action = { OrbitButton("Back to the sky", ::back, tone = Tone.OUTLINE) },
                        )
                    } else {
                        val waiting = state.approvalsFor(ws.id)
                        WorkspaceScreen(
                            WorkspaceUi(
                                ws, state.details[ws.id], state.streams[ws.id], state.shellOut, state.ended[ws.id], state.queued[ws.id] ?: 0,
                                state.server, conn, state.workspaces.values.filter { it.parentId == ws.id }, waiting.size,
                            ),
                            onBack = ::back,
                            onSend = { text, effort, web -> c.send(ws.id, text, effort, web) },
                            onStop = { c.stopRun(ws.id) },
                            onMode = { m: Mode -> scope.launch { c.patchWorkspace(ws.id, "mode" to m.id).onFailure { hub.notice(Notice("Couldn't change the mode", it.message, Effect.Tone.BAD)) } } },
                            onRefresh = { c.loadDetail(ws.id) },
                            onOpenWorkspace = { go(Route.Ws(it)) },
                            onShowApproval = { waiting.firstOrNull()?.let { dismissed.remove(it.id); sheetId = it.id } },
                            onRetry = { c.kick() },
                        )
                    }
                }
                Route.Approvals -> ApprovalsScreen(state.approvals, connection?.computer?.displayName ?: "", ::back) { a -> dismissed.remove(a.id); sheetId = a.id }
                Route.Settings -> {
                    val pm = context.getSystemService(PowerManager::class.java)
                    var refresh by remember { mutableStateOf(0) }
                    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh++ }
                    LifecycleResumeCounter { refresh++ }
                    val ui = remember(refresh, computers, settings, state.server, connection) {
                        SettingsUi(
                            computers, connection?.computer?.room, settings, Push.available,
                            NotificationManagerCompat.from(context).areNotificationsEnabled(),
                            pm?.isIgnoringBatteryOptimizations(context.packageName) ?: true,
                            BuildConfig.VERSION_NAME, state.server?.version,
                        )
                    }
                    SettingsScreen(
                        ui,
                        onBack = ::back,
                        onSwitch = { scope.launch { hub.setActive(it) } },
                        onRename = { room, label -> scope.launch { hub.rename(room, label) } },
                        onForget = { room -> scope.launch { hub.forget(room); AlertService.sync(context) } },
                        onAddComputer = { go(Route.Scan) },
                        onAlertMode = { m ->
                            scope.launch {
                                if (m == AlertMode.FIREBASE) {
                                    val t = Push.provider?.token()
                                    if (t == null) {
                                        hub.notice(Notice("Firebase didn't give a token", "Alerts stay with the relay for now.", Effect.Tone.WARN))
                                        return@launch
                                    }
                                    hub.store.setFcmToken(t)
                                }
                                hub.store.setAlertMode(m)
                                AlertService.sync(context)
                                hub.announcePush()
                            }
                        },
                        onStartOnBoot = { scope.launch { hub.store.setStartOnBoot(it) } },
                        onPhoneName = { scope.launch { hub.store.setPhoneName(it); hub.announcePush() } },
                        onBattery = {
                            val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
                            runCatching { context.startActivity(direct) }.onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } }
                        },
                        onNotifications = {
                            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !settings.askedNotifications) {
                                scope.launch { hub.store.setAskedNotifications() }
                                notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                            } else context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                        },
                        onLicenses = { go(Route.Licenses) },
                    )
                }
                Route.Licenses -> LicensesScreen(::back)
            }
        }

        // the approval sheet: opens by itself for the workspace on screen, or for the one picked from the list
        val here = (route as? Route.Ws)?.id
        val current = state.approvals.firstOrNull { it.id == sheetId }
            ?: if (here != null) state.approvalsFor(here).firstOrNull { it.id !in dismissed } else null
        val c = connection
        if (current != null && c != null && (route is Route.Ws || route is Route.Approvals)) {
            val more = (if (here != null) state.approvalsFor(here) else state.approvals).count { it.id != current.id }
            ApprovalSheet(
                current, more, state.workspaces[current.workspaceId]?.mode,
                onDecide = { d, pattern, note ->
                    if (!c.decide(current, d.id, pattern, note)) hub.notice(Notice("Not connected", "The answer didn't go out. Try again when Orbit is back.", Effect.Tone.WARN))
                    if (sheetId == current.id) sheetId = null
                },
                onDismiss = {
                    dismissed.add(current.id)
                    if (sheetId == current.id) sheetId = null
                },
            )
        }

        Toast(notice.value, onDismiss = { notice.value = null }, onOpen = { id -> notice.value = null; go(Route.Ws(id)) }, modifier = Modifier.align(Alignment.TopCenter))

        if (askNotifications) NotificationAsk(
            onAllow = { askNotifications = false },
            onLater = { askNotifications = false; scope.launch { hub.store.setAskedNotifications() } },
        )
    }
}

private fun routeTransition(from: Route, to: Route, stack: List<Route>, reduced: Boolean): ContentTransform {
    if (reduced) return fadeIn(tween(0)) togetherWith fadeOut(tween(0))
    val forward = stack.lastOrNull() == to && stack.size >= 2 && stack[stack.size - 2] == from
    // into a workspace the screen scales up as if flying in; back, it scales down to the sky
    return if (forward) {
        (fadeIn(tween(Motion.SHOW, easing = Motion.Glide)) + scaleIn(tween(Motion.SHOW, easing = Motion.Glide), initialScale = 0.92f)) togetherWith
            fadeOut(tween(Motion.QUICK, easing = Motion.EaseIn))
    } else {
        fadeIn(tween(Motion.MOVE, easing = Motion.Glide)) togetherWith
            (fadeOut(tween(Motion.QUICK, easing = Motion.EaseIn)) + scaleOut(tween(Motion.MOVE, easing = Motion.EaseIn), targetScale = 0.92f))
    }
}

@Composable
private fun LifecycleResumeCounter(onResume: () -> Unit) {
    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(owner) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) onResume() }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
}

/** A toast at the top with Ori in the matching pose. */
@Composable
fun Toast(n: Notice?, onDismiss: () -> Unit, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    LaunchedEffect(n) {
        if (n != null) {
            delay(if (n.tone == Effect.Tone.BAD) 9000 else 5000)
            onDismiss()
        }
    }
    val motion = LocalMotion.current
    var last by remember { mutableStateOf(n) }
    if (n != null) last = n
    AnimatedVisibility(
        n != null,
        modifier.statusBarsPadding().padding(12.dp),
        enter = if (motion.reduced) fadeIn(tween(0)) else slideInVertically(tween(Motion.MOVE, easing = Motion.Spring)) { -it } + fadeIn(),
        exit = if (motion.reduced) fadeOut(tween(0)) else slideOutVertically(tween(Motion.QUICK, easing = Motion.EaseIn)) { -it } + fadeOut(),
    ) {
        val t = last ?: return@AnimatedVisibility
        val pose = when (t.tone) { Effect.Tone.GOOD -> OriPose.DONE; Effect.Tone.WARN -> OriPose.THINKING; Effect.Tone.BAD -> OriPose.OOPS; Effect.Tone.INFO -> OriPose.IDLE }
        Row(
            Modifier
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .clip(Orbit.ShapeL)
                .background(Orbit.Surface2)
                .border(1.dp, Orbit.Line2, Orbit.ShapeL)
                .clickable { if (t.wsId != null) onOpen(t.wsId) else onDismiss() }
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Ori(pose, 40.dp)
            Spacer(Modifier.width(10.dp))
            Column {
                Text(t.title, style = MaterialTheme.typography.titleSmall, color = when (t.tone) { Effect.Tone.BAD -> Orbit.Danger; Effect.Tone.WARN -> Orbit.Peach; else -> Orbit.Star })
                if (!t.body.isNullOrBlank()) Text(t.body, style = MaterialTheme.typography.bodySmall, maxLines = 3)
            }
        }
    }
}

/** Asked once, after the first pairing: Ori says why notifications help. */
@Composable
private fun NotificationAsk(onAllow: () -> Unit, onLater: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as OrbitApp
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        scope.launch { app.hub.store.setAskedNotifications() }
        AlertService.sync(context)
        onAllow()
    }
    val needsPermission = Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    if (!needsPermission) {
        LaunchedEffect(Unit) { app.hub.store.setAskedNotifications(); onAllow() }
        return
    }
    ModalBottomSheet(onLater, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Orbit.Surface) {
        NotificationAskBody(onAllow = { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }, onLater = onLater)
    }
}

@Composable
fun NotificationAskBody(onAllow: () -> Unit, onLater: () -> Unit) {
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp).padding(bottom = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Ori(OriPose.NEEDS, 120.dp)
        Spacer(Modifier.height(10.dp))
        Text("Want to know when Claude needs you?", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            "When Claude waits for your approval, Orbit can tell you, even with the app closed, and you can allow or deny right from the notification. Nothing else is sent, and the alert itself carries no content.",
            style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(18.dp))
        OrbitButton("Turn on notifications", onAllow, Modifier.fillMaxWidth(), Tone.PEACH, Ic.Bell, big = true)
        Spacer(Modifier.height(6.dp))
        OrbitButton("Not now", onLater, Modifier.fillMaxWidth(), Tone.GHOST)
    }
}
