package dev.elchi.orbit.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Motion
import dev.elchi.orbit.ui.theme.Orbit

enum class Tone { PEACH, LIGHT, OUTLINE, GHOST, DANGER }

/** The press dip from docs/MOTION.md: 97% for buttons, 92% for icon buttons. */
@Composable
fun Modifier.pressDip(source: MutableInteractionSource, to: Float = 0.97f): Modifier {
    val pressed by source.collectIsPressedAsState()
    val reduced = LocalMotion.current.reduced
    val s by animateFloatAsState(if (pressed && !reduced) to else 1f, tween(if (pressed) Motion.TAP else Motion.MOVE, easing = if (pressed) Motion.Glide else Motion.Spring), label = "dip")
    return this.scale(s)
}

@Composable
fun OrbitButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.PEACH,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    big: Boolean = false,
    haptic: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    val h = LocalHapticFeedback.current
    val (bg, fg, border) = when (tone) {
        Tone.PEACH -> Triple(Orbit.Peach, Orbit.PeachInk, null)
        Tone.LIGHT -> Triple(Orbit.Star, Color(0xFF15151F), null)
        Tone.OUTLINE -> Triple(Color.Transparent, Orbit.Star, BorderStroke(1.dp, Orbit.Line2))
        Tone.GHOST -> Triple(Color.Transparent, Orbit.Star2, null)
        Tone.DANGER -> Triple(Color.Transparent, Orbit.Danger, BorderStroke(1.dp, Orbit.Danger.copy(alpha = 0.35f)))
    }
    Row(
        modifier
            .pressDip(source)
            .graphicsLayer { alpha = if (enabled) 1f else 0.4f }
            .clip(Orbit.Shape)
            .background(bg)
            .then(if (border != null) Modifier.border(border, Orbit.Shape) else Modifier)
            .clickable(source, indication = androidx.compose.material3.ripple(color = fg), enabled = enabled, role = Role.Button) {
                if (haptic) h.performHapticFeedback(HapticFeedbackType.Confirm)
                onClick()
            }
            .defaultMinSize(minHeight = if (big) 50.dp else 44.dp)
            .padding(horizontal = if (big) 22.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, color = fg, style = MaterialTheme.typography.labelLarge.copy(fontSize = if (big) 15.5.sp else 14.5.sp), maxLines = 1)
    }
}

@Composable
fun OrbitIconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = Orbit.Star2, size: Dp = 44.dp, on: Boolean = false, enabled: Boolean = true) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier
            .pressDip(source, 0.92f)
            .size(size)
            .clip(Orbit.Shape)
            .background(if (on) Orbit.Hover else Color.Transparent)
            .clickable(source, indication = androidx.compose.material3.ripple(bounded = true), enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label }
            .graphicsLayer { alpha = if (enabled) 1f else 0.4f },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun Hairline(modifier: Modifier = Modifier, color: Color = Orbit.Line) {
    Box(modifier.fillMaxWidth().height(1.dp).background(color))
}

@Composable
fun Chip(text: String, modifier: Modifier = Modifier, color: Color = Orbit.Star2, bg: Color = Orbit.Hover, icon: ImageVector? = null) {
    Row(
        modifier.clip(Orbit.ShapeS).background(bg).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = color, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(text, color = color, style = MaterialTheme.typography.labelMedium.copy(fontSize = 12.5.sp), maxLines = 1)
    }
}

/** Orbit's switch: peach when on. */
@Composable
fun OrbitSwitch(checked: Boolean, onChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier) {
    val x by animateFloatAsState(if (checked) 16f else 0f, tween(Motion.MOVE, easing = Motion.Spring), label = "switch")
    Box(
        modifier
            .size(width = 44.dp, height = 28.dp)
            .toggleable(checked, role = Role.Switch, onValueChange = onChange)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(width = 40.dp, height = 24.dp).clip(CircleShape).background(if (checked) Orbit.Peach else Color(0x1AFFFFFF))) {
            Box(
                Modifier
                    .padding(start = (3 + x).dp, top = 3.dp)
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(if (checked) Orbit.PeachInk else Orbit.Star),
            )
        }
    }
}

/** A text field in a well, with the soft lavender focus ring. */
@Composable
fun OrbitField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    textStyle: TextStyle = MaterialTheme.typography.bodyMedium,
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    error: Boolean = false,
    maxLines: Int = if (singleLine) 1 else 6,
) {
    var focused by remember { mutableStateOf(false) }
    val shake = remember { Animatable(0f) }
    LaunchedEffect(error) {
        if (error) for (v in listOf(-3f, 3f, -2f, 1f, 0f)) shake.animateTo(v, tween(60))
    }
    val border = when {
        error -> Orbit.Danger.copy(alpha = 0.6f)
        focused -> Orbit.Lav.copy(alpha = 0.6f)
        else -> Orbit.Line
    }
    Row(
        modifier
            .graphicsLayer { translationX = shake.value * density }
            .then(if (focused) Modifier.border(4.dp, Orbit.Lav.copy(alpha = 0.12f), Orbit.ShapeL) else Modifier)
            .clip(Orbit.Shape)
            .background(Orbit.Well)
            .border(1.dp, border, Orbit.Shape)
            .padding(horizontal = 4.dp),
        verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
    ) {
        leading?.invoke()
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            maxLines = maxLines,
            textStyle = textStyle.copy(color = Orbit.Star),
            cursorBrush = SolidColor(Orbit.Peach),
            keyboardOptions = KeyboardOptions(imeAction = imeAction),
            keyboardActions = KeyboardActions(onDone = { onDone() }, onSend = { onDone() }, onGo = { onDone() }),
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 8.dp, vertical = 12.dp)
                .onFocusChanged { focused = it.isFocused }
                .semantics { contentDescription = placeholder },
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) Text(placeholder, style = textStyle, color = Orbit.Star3, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
                    inner()
                }
            },
        )
        trailing?.invoke()
    }
}

/** Ori in the matching pose with a line or two, for empty and quiet places. */
@Composable
fun OriEmpty(pose: OriPose, title: String, body: String?, modifier: Modifier = Modifier, size: Dp = 120.dp, action: (@Composable () -> Unit)? = null) {
    Column(modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Ori(pose, size)
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (body != null) {
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium, color = Orbit.Star2, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.widthIn(max = 420.dp))
        }
        if (action != null) {
            Spacer(Modifier.height(18.dp))
            action()
        }
    }
}

/** A card surface: ink with a hairline, radius 14. */
@Composable
fun Card(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), accent: Color? = null, content: @Composable () -> Unit) {
    Box(
        modifier
            .clip(Orbit.ShapeL)
            .background(Orbit.Surface)
            .border(1.dp, Orbit.Line, Orbit.ShapeL)
            .then(
                if (accent != null) Modifier.background(
                    androidx.compose.ui.graphics.Brush.horizontalGradient(0f to accent.copy(alpha = 0.08f), 0.4f to Color.Transparent),
                ) else Modifier,
            )
            .padding(padding),
    ) { content() }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.8.sp, fontSize = 11.5.sp), color = Orbit.Star3, modifier = modifier.padding(horizontal = 4.dp, vertical = 8.dp))
}

/** Something arriving fades up 6 dp; reduced motion makes it simply appear. */
@Composable
fun Rise(visible: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val reduced = LocalMotion.current.reduced
    AnimatedVisibility(
        visible,
        modifier,
        enter = if (reduced) fadeIn(tween(0)) else fadeIn(tween(Motion.SHOW, easing = Motion.Glide)) + slideInVertically(tween(Motion.SHOW, easing = Motion.Glide)) { it / 6 },
        exit = if (reduced) fadeOut(tween(0)) else fadeOut(tween(Motion.QUICK, easing = Motion.EaseIn)) + slideOutVertically(tween(Motion.QUICK, easing = Motion.EaseIn)) { it / 8 },
    ) { content() }
}

@Composable
fun Dot(color: Color, size: Dp = 8.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

val PillShape = RoundedCornerShape(50)
