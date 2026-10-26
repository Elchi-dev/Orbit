package dev.elchi.orbit.ui.pair

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.elchi.orbit.core.pairing.PairingLink
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.components.OrbitButton
import dev.elchi.orbit.ui.components.OrbitField
import dev.elchi.orbit.ui.components.OrbitIconButton
import dev.elchi.orbit.ui.components.Tone
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.sky.Sky
import dev.elchi.orbit.ui.theme.Orbit

/** The first screen: Ori waves, says what this is, and how to pair. */
@Composable
fun WelcomeScreen(onScan: () -> Unit, onLink: (String) -> Unit) {
    var paste by rememberSaveable { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Orbit.Void)) {
        // the sky with no planets yet: just the sun, quietly
        Sky(emptyList(), {}, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Color(0xB30A0A16)))
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(36.dp))
            Ori(OriPose.HI, 168.dp)
            Spacer(Modifier.height(16.dp))
            Text("Orbit, in your pocket", style = MaterialTheme.typography.displaySmall, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
            Spacer(Modifier.height(10.dp))
            Text(
                "See your workspaces, answer Claude's questions and start new work from anywhere. The phone reaches Orbit through your relay, and everything between them is encrypted end to end.",
                style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 440.dp),
            )
            Spacer(Modifier.height(24.dp))
            Steps(Modifier.widthIn(max = 440.dp))
            Spacer(Modifier.weight(1f, fill = true).height(24.dp))
            OrbitButton("Scan the QR code", onScan, Modifier.fillMaxWidth().widthIn(max = 440.dp), Tone.PEACH, Ic.Qr, big = true)
            Spacer(Modifier.height(8.dp))
            if (!paste) OrbitButton("Paste a pairing link", { paste = true }, Modifier.fillMaxWidth().widthIn(max = 440.dp), Tone.GHOST, Ic.Clipboard)
            else PasteLink(onLink, Modifier.widthIn(max = 440.dp))
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun Steps(modifier: Modifier) {
    Column(modifier.fillMaxWidth().clip(Orbit.ShapeL).background(Orbit.Surface.copy(alpha = 0.9f)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf(
            "On your computer, open Orbit and go to Settings, Your phone.",
            "Set up the relay there if you haven't yet.",
            "Tap Pair a phone and scan the QR code Orbit shows.",
        ).forEachIndexed { i, s ->
            Row(verticalAlignment = Alignment.Top) {
                Text("${i + 1}", style = MaterialTheme.typography.labelLarge, color = Orbit.Peach, modifier = Modifier.width(22.dp))
                Text(s, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
fun PasteLink(onLink: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var text by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    fun submit() {
        val t = text.trim()
        val e = runCatching { PairingLink.parse(t) }.exceptionOrNull()
        if (e != null) error = e.message else onLink(t)
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OrbitField(
            text, { text = it; error = null }, "orbit://pair?...", Modifier.fillMaxWidth(), error = error != null, onDone = { submit() },
            trailing = {
                OrbitIconButton(Ic.Clipboard, "Paste from the clipboard", {
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString()?.let { text = it.trim(); error = null }
                })
            },
        )
        if (error != null) Text(error!!, style = MaterialTheme.typography.bodySmall.copy(color = Orbit.Danger))
        OrbitButton("Pair", { submit() }, Modifier.fillMaxWidth(), Tone.LIGHT, enabled = text.isNotBlank())
    }
}

/** The camera with a frame to aim, and a way to paste the link instead. */
@Composable
fun ScanScreen(onBack: () -> Unit, onLink: (String) -> Unit, camera: @Composable (Modifier, (String) -> Unit) -> Unit = { m, f -> QrCamera(f, m) }) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val h = LocalHapticFeedback.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted && !asked) launcher.launch(Manifest.permission.CAMERA) }
    Column(Modifier.fillMaxSize().background(Orbit.Void).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            OrbitIconButton(Ic.ChevronLeft, "Back", onBack)
            Text("Pair with Orbit", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.fillMaxWidth().widthIn(max = 420.dp).aspectRatio(1f).clip(Orbit.ShapeL).background(Orbit.Well), contentAlignment = Alignment.Center) {
                if (granted) {
                    camera(Modifier.fillMaxSize()) { text ->
                        val e = runCatching { PairingLink.parse(text) }.exceptionOrNull()
                        if (e == null) {
                            h.performHapticFeedback(HapticFeedbackType.Confirm)
                            onLink(text)
                        } else error = e.message
                    }
                    Viewfinder()
                } else Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Ori(OriPose.SEARCHING, 110.dp)
                    Spacer(Modifier.height(10.dp))
                    Text("Orbit needs the camera to read the QR code. Nothing else uses it.", style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(12.dp))
                    OrbitButton("Allow the camera", { launcher.launch(Manifest.permission.CAMERA) }, tone = Tone.LIGHT)
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.widthIn(max = 420.dp)) {
                Ori(OriPose.SEARCHING, 40.dp, still = true)
                Spacer(Modifier.width(10.dp))
                Text(
                    error ?: "Scan the QR code in Orbit (Settings, Your phone, Pair a phone). The code works once, for ten minutes.",
                    style = MaterialTheme.typography.bodySmall.copy(color = if (error != null) Orbit.Danger else Orbit.Star2),
                )
            }
            Spacer(Modifier.height(18.dp))
            Text("Or paste the link Orbit shows under the code", style = MaterialTheme.typography.labelSmall, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
            Spacer(Modifier.height(6.dp))
            PasteLink(onLink, Modifier.widthIn(max = 420.dp))
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun Viewfinder() {
    Canvas(Modifier.fillMaxSize().padding(36.dp)) {
        val l = size.minDimension * 0.16f
        val w = 3.dp.toPx()
        val c = Orbit.Peach
        val s = size
        // four corners, like a camera's frame
        drawRoundRect(Color.White.copy(alpha = 0.06f), Offset.Zero, s, CornerRadius(14.dp.toPx()), style = Stroke(1.dp.toPx()))
        for ((x, y, dx, dy) in listOf(floatArrayOf(0f, 0f, 1f, 1f), floatArrayOf(s.width, 0f, -1f, 1f), floatArrayOf(0f, s.height, 1f, -1f), floatArrayOf(s.width, s.height, -1f, -1f))) {
            drawLine(c, Offset(x, y), Offset(x + dx * l, y), w)
            drawLine(c, Offset(x, y), Offset(x, y + dy * l), w)
        }
    }
}

/** While pairing, then the result: Ori thinks, celebrates, or says oops. */
sealed interface PairState {
    data class Working(val name: String) : PairState
    data class Done(val name: String) : PairState
    data class Failed(val message: String) : PairState
}

@Composable
fun PairingScreen(state: PairState, onContinue: () -> Unit, onRetry: () -> Unit, onBack: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Orbit.Void).statusBarsPadding().navigationBarsPadding(), contentAlignment = Alignment.Center) {
        AnimatedContent(state, transitionSpec = { fadeIn(tween(260)) togetherWith fadeOut(tween(160)) }, label = "pair") { s ->
            Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                when (s) {
                    is PairState.Working -> {
                        Ori(OriPose.THINKING, 150.dp)
                        Spacer(Modifier.height(14.dp))
                        Text("Pairing with ${s.name}", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(6.dp))
                        Text("Agreeing on keys through the relay.", style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2)
                    }
                    is PairState.Done -> {
                        Ori(OriPose.DONE, 150.dp)
                        Spacer(Modifier.height(14.dp))
                        Text("Paired with ${s.name}", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(6.dp))
                        Text("This phone can now reach it from anywhere.", style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(22.dp))
                        OrbitButton("Continue", onContinue, tone = Tone.PEACH, icon = Ic.ArrowUpRight, big = true)
                    }
                    is PairState.Failed -> {
                        Ori(OriPose.OOPS, 150.dp)
                        Spacer(Modifier.height(14.dp))
                        Text("That didn't work", style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.height(6.dp))
                        Text(s.message, style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 420.dp))
                        Spacer(Modifier.height(22.dp))
                        OrbitButton("Scan again", onRetry, tone = Tone.PEACH, icon = Ic.Qr)
                        Spacer(Modifier.height(6.dp))
                        OrbitButton("Back", onBack, tone = Tone.GHOST)
                    }
                }
            }
        }
    }
}
