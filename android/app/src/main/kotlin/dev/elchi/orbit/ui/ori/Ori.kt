package dev.elchi.orbit.ui.ori

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Matrix
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Unbounded
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.tan

/**
 * Ori, Orbit's mascot, drawn like web/src/components/ori/Ori.tsx: a soft
 * eight-point star with a lavender ring, a peach moon and two floating mitten
 * hands, on a 400 unit square. Every loop is slow and small, and stops under
 * reduced motion or with [still].
 */
@Composable
fun Ori(pose: OriPose, size: Dp, modifier: Modifier = Modifier, still: Boolean = false, label: String? = null) {
    val motion = LocalMotion.current
    val speed = if (still) 0f else motion.loopSpeed
    val time = rememberLoopTime(speed)
    val measurer = rememberTextMeasurer()
    val desc = label ?: oriLabel(pose)
    Canvas(
        modifier
            .semantics {
                contentDescription = desc
                role = Role.Image
            }
            .size(size),
    ) {
        drawOri(pose, time.value, size.toPx() < 34.dp.toPx(), measurer)
    }
}

/** Seconds since start, scaled by [speed]; holds at 0 when speed is 0. */
@Composable
fun rememberLoopTime(speed: Float): State<Float> {
    val t = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(speed) {
        if (speed <= 0f) {
            t.floatValue = 0f
            return@LaunchedEffect
        }
        var last = -1L
        while (true) {
            withFrameNanos { now ->
                if (last >= 0) t.floatValue += (now - last) / 1e9f * speed
                last = now
            }
        }
    }
    return t
}

fun oriLabel(p: OriPose) = when (p) {
    OriPose.HI -> "Ori waving hi"
    OriPose.THINKING -> "Ori thinking"
    OriPose.WORKING -> "Ori typing on a laptop"
    OriPose.READING -> "Ori reading through a magnifying glass"
    OriPose.SEARCHING -> "Ori looking through a telescope"
    OriPose.WRITING -> "Ori writing"
    OriPose.PLANNING -> "Ori checking a plan"
    OriPose.DRAWING -> "Ori holding up a note"
    OriPose.CAMERA -> "Ori taking a picture"
    OriPose.NEEDS -> "Ori waving a flag for your attention"
    OriPose.DONE -> "Ori celebrating"
    OriPose.SLEEPING -> "Ori asleep"
    OriPose.OOPS -> "Ori, something went wrong"
    OriPose.HELPERS -> "Ori with helper stars"
    OriPose.IDLE -> "Ori"
}

// ---------- the drawing ----------

private object C {
    val body = Color(0xFFFFE6AE)
    val shade = Color(0xFFF5C98C)
    val ink = Color(0xFF1A1430)
    val ring = Color(0xFFB8A6FF)
    val moon = Color(0xFFFFB199)
    val sky = Color(0xFF0A0A16)
    val metal = Color(0xFF8D86B8)
    val dark = Color(0xFF2B2846)
    val paper = Color(0xFFF4F1FF)
    val blush = Color(0xFFFFB199)
    val edge = Color(0xFFE7B06C)
    val soft = Color(0xFFECEBF4)
    val tongue = Color(0xFFFF8C7A)
    val grape = Color(0xFF3B3662)
    val handle = Color(0xFF6E6896)
}

private fun p(d: String): Path = PathParser().parsePathString(d).toPath()

private object Paths {
    val body = p("M209.0 99.1 Q213.9 105.7 218.7 112.4 Q227.0 123.6 240.5 119.7 Q249.6 117.1 258.7 114.4 Q283.6 107.1 279.0 132.7 Q277.3 142.0 275.6 151.4 Q273.1 165.1 285.1 172.4 Q291.4 176.3 297.7 180.1 Q319.8 193.7 299.2 209.5 Q293.3 214.0 287.5 218.5 Q276.4 227.0 280.2 240.5 Q282.6 249.2 285.1 258.0 Q292.1 283.0 266.5 278.6 Q257.6 277.0 248.7 275.5 Q234.9 273.1 227.4 285.0 Q223.7 290.9 220.0 296.8 Q206.2 318.8 190.2 298.4 Q185.9 292.9 181.6 287.4 Q173.0 276.4 159.5 280.0 Q151.1 282.3 142.8 284.6 Q117.7 291.4 121.9 265.7 Q123.3 257.2 124.6 248.7 Q126.9 234.9 114.9 227.7 Q108.2 223.7 101.5 219.7 Q79.2 206.3 100.0 190.7 Q106.2 186.0 112.4 181.4 Q123.6 173.0 119.8 159.5 Q117.4 150.8 114.9 142.0 Q107.9 117.0 133.5 121.4 Q142.4 123.0 151.3 124.5 Q165.1 126.9 172.2 114.8 Q176.3 107.7 180.5 100.6 Q193.6 78.2 209.0 99.1Z")
    val ringBack = p("M44.7 273.1 A170 36 -24 0 1 355.3 134.9")
    val ringFront = p("M355.3 134.9 A170 36 -24 0 1 44.7 273.1")
    val mitten = p("M-4 -20 C7 -22 16 -12 16 0 C16 12 9 21 -1 21 C-11 21 -16 12 -15 1 C-14 -10 -11 -18 -4 -20 Z")
    val spark = p("M0 -16 L4 -4 L16 0 L4 4 L0 16 L-4 4 L-16 0 L-4 -4 Z")
}

private val Ease = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)
private val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private val EaseOutC = CubicBezierEasing(0f, 0f, 0.58f, 1f)
private val EaseInC = CubicBezierEasing(0.42f, 0f, 1f, 1f)
private val Bounce = CubicBezierEasing(0.3f, 1.5f, 0.5f, 1f)

/** Progress 0..1 of a loop of [period] seconds, after [delay]. */
private fun phase(t: Float, period: Float, delay: Float = 0f): Float {
    val x = (t - delay) / period
    return x - kotlin.math.floor(x)
}

/** An `alternate` animation: 0 to 1 and back, each way [half] seconds. */
private fun alternate(t: Float, half: Float, easing: Easing, delay: Float = 0f): Float {
    val x = phase(t, half * 2, delay) * 2
    return if (x <= 1f) easing.transform(x) else easing.transform(2 - x)
}

/** CSS-like keyframes: [at] positions in 0..1, the value at each, easing per segment. */
private fun keys(p: Float, at: FloatArray, v: FloatArray, easing: Easing = Ease): Float {
    if (p <= at.first()) return v.first()
    for (i in 1 until at.size) {
        if (p <= at[i]) {
            val f = (p - at[i - 1]) / (at[i] - at[i - 1])
            return v[i - 1] + (v[i] - v[i - 1]) * easing.transform(f)
        }
    }
    return v.last()
}

private val wave = { t: Float -> (1 - cos(2 * PI * t)).toFloat() / 2 }

private fun DrawScope.fillCircle(x: Float, y: Float, r: Float, c: Color, alpha: Float = 1f) = drawCircle(c, r, Offset(x, y), alpha)

private fun DrawScope.ellipse(cx: Float, cy: Float, rx: Float, ry: Float, c: Color, rot: Float = 0f, alpha: Float = 1f) {
    if (rot == 0f) drawOval(c, Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), alpha)
    else rotate(rot, Offset(cx, cy)) { drawOval(c, Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), alpha) }
}

private fun stroke(w: Float = 5f) = Stroke(width = w, cap = StrokeCap.Round, join = StrokeJoin.Round)

private fun DrawScope.line(d: String, c: Color, w: Float = 5f, alpha: Float = 1f) = drawPath(cached(d), c, alpha, stroke(w))
private fun DrawScope.fill(d: String, c: Color, alpha: Float = 1f) = drawPath(cached(d), c, alpha)

private val cache = HashMap<String, Path>()
private fun cached(d: String): Path = synchronized(cache) { cache.getOrPut(d) { p(d) } }

private fun DrawScope.rect(x: Float, y: Float, w: Float, h: Float, rx: Float, c: Color) =
    drawRoundRect(c, Offset(x, y), Size(w, h), androidx.compose.ui.geometry.CornerRadius(rx, rx))

private fun DrawScope.rectStroke(x: Float, y: Float, w: Float, h: Float, rx: Float, c: Color, sw: Float) =
    drawRoundRect(c, Offset(x, y), Size(w, h), androidx.compose.ui.geometry.CornerRadius(rx, rx), style = Stroke(sw))

/** A mitten hand: fingers up in its own frame, mirrored for the left. */
private fun DrawScope.hand(x: Float, y: Float, r: Float = 0f, left: Boolean = false, edge: Boolean = false, dy: Float = 0f) {
    withTransform({
        translate(x, y + dy)
        rotate(r, Offset.Zero)
        if (left) scale(-1f, 1f, Offset.Zero)
    }) {
        if (edge) {
            drawPath(Paths.mitten, C.edge, style = Stroke(7f, join = StrokeJoin.Round))
            rotate(-28f, Offset(-17f, -10f)) { drawOval(C.edge, Offset(-17f - 5.5f - 3.5f, -10f - 9.5f - 3.5f), Size(18f, 26f)) }
        }
        drawPath(Paths.mitten, C.body)
        ellipse(-17f, -10f, 5.5f, 9.5f, C.body, -28f)
    }
}

private fun DrawScope.miniStar(x: Float, y: Float, s: Float, dy: Float) {
    withTransform({
        translate(x, y + dy)
        scale(s, s, Offset.Zero)
        translate(-200f, -200f)
    }) {
        drawPath(Paths.body, C.body)
        fillCircle(170f, 193f, 13f, C.ink)
        fillCircle(229f, 187f, 13f, C.ink)
    }
}

private enum class Eyes { OPEN, UP, DOWN, HAPPY, CLOSED, WIDE, LENS, WINK, SCOPE }
private enum class Mouth { SMILE, OPEN, FLAT, O, WAVY, TONGUE, SLEEP }
private enum class Anim { BOB, HOP, BREATHE, SHAKE }
private class Face(val eyes: Eyes, val mouth: Mouth, val blush: Boolean, val anim: Anim)

private fun faceOf(p: OriPose) = when (p) {
    OriPose.HI -> Face(Eyes.OPEN, Mouth.OPEN, true, Anim.BOB)
    OriPose.THINKING -> Face(Eyes.UP, Mouth.FLAT, false, Anim.BOB)
    OriPose.WORKING -> Face(Eyes.DOWN, Mouth.SMILE, false, Anim.BOB)
    OriPose.READING -> Face(Eyes.LENS, Mouth.O, false, Anim.BOB)
    OriPose.SEARCHING -> Face(Eyes.SCOPE, Mouth.SMILE, false, Anim.BOB)
    OriPose.WRITING -> Face(Eyes.DOWN, Mouth.TONGUE, false, Anim.BOB)
    OriPose.PLANNING -> Face(Eyes.DOWN, Mouth.SMILE, false, Anim.BOB)
    OriPose.DRAWING -> Face(Eyes.OPEN, Mouth.OPEN, true, Anim.BOB)
    OriPose.CAMERA -> Face(Eyes.WINK, Mouth.OPEN, false, Anim.BOB)
    OriPose.NEEDS -> Face(Eyes.WIDE, Mouth.O, false, Anim.HOP)
    OriPose.DONE -> Face(Eyes.HAPPY, Mouth.OPEN, true, Anim.HOP)
    OriPose.SLEEPING -> Face(Eyes.CLOSED, Mouth.SLEEP, false, Anim.BREATHE)
    OriPose.OOPS -> Face(Eyes.WIDE, Mouth.WAVY, false, Anim.SHAKE)
    OriPose.HELPERS -> Face(Eyes.OPEN, Mouth.SMILE, true, Anim.BOB)
    OriPose.IDLE -> Face(Eyes.OPEN, Mouth.SMILE, false, Anim.BOB)
}

private fun DrawScope.face(f: Face, tiny: Boolean, t: Float) {
    val ink = C.ink
    var eyes = f.eyes
    if (tiny) {
        if (eyes == Eyes.HAPPY || eyes == Eyes.CLOSED) {
            line(if (eyes == Eyes.HAPPY) "M152 200 Q168 180 184 200" else "M152 194 Q168 210 184 194", ink, 13f)
            line(if (eyes == Eyes.HAPPY) "M214 194 Q230 174 246 194" else "M214 188 Q230 204 246 188", ink, 13f)
        } else {
            fillCircle(168f, 194f, 17f, ink)
            fillCircle(230f, 188f, 17f, ink)
        }
        return
    }
    if (f.blush) {
        ellipse(147f, 212f, 12f, 6.5f, C.blush, alpha = 0.42f)
        ellipse(253f, 203f, 12f, 6.5f, C.blush, alpha = 0.42f)
    }
    // blink: a quick squeeze of the open eyes every 5.2 s
    val blink = keys(phase(t, 5.2f), floatArrayOf(0f, 0.94f, 0.97f, 1f), floatArrayOf(1f, 1f, 0.1f, 1f))
    scale(1f, blink, Offset(200f, 190f)) {
        when (eyes) {
            Eyes.OPEN -> { fillCircle(170f, 193f, 8.5f, ink); fillCircle(229f, 187f, 8.5f, ink) }
            Eyes.UP -> { fillCircle(174f, 186f, 8.5f, ink); fillCircle(233f, 180f, 8.5f, ink) }
            Eyes.DOWN -> { ellipse(168f, 198f, 8.5f, 6.5f, ink); ellipse(227f, 192f, 8.5f, 6.5f, ink) }
            Eyes.WIDE -> {
                fillCircle(170f, 192f, 11f, ink); fillCircle(229f, 186f, 11f, ink)
                fillCircle(173.5f, 188f, 3.6f, Color.White); fillCircle(232.5f, 182f, 3.6f, Color.White)
            }
            Eyes.LENS -> { fillCircle(170f, 193f, 8.5f, ink); fillCircle(229f, 187f, 15f, ink); fillCircle(234f, 181f, 4.5f, Color.White) }
            else -> {}
        }
    }
    when (eyes) {
        Eyes.HAPPY -> { line("M160 197 Q170 183 180 197", ink); line("M219 191 Q229 177 239 191", ink) }
        Eyes.CLOSED -> { line("M160 193 Q170 202 180 193", ink); line("M219 187 Q229 196 239 187", ink) }
        Eyes.WINK -> { fillCircle(170f, 193f, 8.5f, ink); line("M219 189 Q229 181 239 189", ink) }
        Eyes.SCOPE -> line("M160 194 Q170 186 180 194", ink)
        else -> {}
    }
    when (f.mouth) {
        Mouth.SMILE -> line("M190 202 Q201 213 212 199", ink, 4.4f)
        Mouth.OPEN -> {
            fill("M188 199 Q201 222 214 196 Z", ink)
            line("M188 199 Q201 222 214 196 Z", ink, 2f)
            fill("M195 210 Q201 216 207 208 Q201 205 195 210 Z", C.tongue)
        }
        Mouth.FLAT -> line("M193 205 Q201 206 209 202", ink, 4.4f)
        Mouth.O -> ellipse(201f, 206f, 6f, 7.5f, ink)
        Mouth.WAVY -> line("M186 207 q7.5 -7 15 0 q7.5 7 15 0", ink, 4.4f)
        Mouth.TONGUE -> { line("M190 202 Q201 213 212 199", ink, 4.4f); ellipse(210f, 207f, 4.5f, 5.5f, C.tongue, -20f) }
        Mouth.SLEEP -> ellipse(201f, 205f, 4.5f, 3.5f, ink)
    }
}

private fun DrawScope.drawOri(pose: OriPose, t: Float, compact: Boolean, measurer: TextMeasurer) {
    val s = size.minDimension / 400f
    val f = faceOf(pose)
    withTransform({
        translate((size.width - 400f * s) / 2, (size.height - 400f * s) / 2)
        scale(s, s, Offset.Zero)
    }) {
        if (!compact) {
            // the aura breathes
            val ap = wave(phase(t, 4.6f))
            scale(1f + 0.08f * ap, 1f + 0.08f * ap, Offset(200f, 200f)) {
                drawCircle(Brush.radialGradient(listOf(C.body.copy(alpha = 0.28f), C.body.copy(alpha = 0f)), Offset(200f, 200f), 150f), 150f, Offset(200f, 200f), alpha = 0.8f + 0.2f * ap)
            }
            extras(pose, t, measurer)
        }
        // the body's loop: bob, hop, breathe or shake
        val (dy, sx, sy, rot, pivot) = when (f.anim) {
            Anim.BOB -> Body(-9f * wave(phase(t, 3.4f)))
            Anim.HOP -> Body(-16f * alternate(t, 0.62f, Bounce))
            Anim.BREATHE -> { val b = wave(phase(t, 3.8f)); Body(0f, 1f + 0.03f * b, 1f - 0.025f * b, 0f, Offset(200f, 290f)) }
            Anim.SHAKE -> Body(0f, 1f, 1f, keys(phase(t, 2.6f), floatArrayOf(0f, 0.7f, 0.76f, 0.84f, 0.92f, 1f), floatArrayOf(0f, 0f, -4f, 3.5f, -1.5f, 0f), EaseInOut), Offset(200f, 300f))
        }
        withTransform({
            translate(0f, dy)
            if (sx != 1f || sy != 1f) scale(sx, sy, pivot)
            if (rot != 0f) rotate(rot, pivot)
        }) {
            val helpers = pose == OriPose.HELPERS && !compact
            if (!compact) {
                drawPath(Paths.ringBack, C.ring, style = stroke(5.5f))
                if (!helpers) fillCircle(314.6f, 129.1f, 7f, C.body)
                else miniStar(314.6f, 124f, 0.15f, -9f * wave(phase(t, 2.2f)))
            }
            if (!compact) handsBack(pose, t)
            drawPath(Paths.body, C.body)
            clipPath(Paths.body) {
                drawPath(Paths.body, C.shade)
                translate(-13f, -15f) { drawPath(Paths.body, C.body) }
            }
            val shownEyes = if (compact && (f.eyes == Eyes.LENS || f.eyes == Eyes.SCOPE)) Face(Eyes.OPEN, f.mouth, f.blush, f.anim) else f
            face(shownEyes, compact, t)
            if (!compact) {
                drawPath(Paths.ringFront, C.ring, style = stroke(5.5f))
                if (helpers) {
                    miniStar(88.8f, 276f, 0.13f, -9f * wave(phase(t, 2.2f, 0.5f)))
                    miniStar(268.6f, 208f, 0.17f, -9f * wave(phase(t, 2.2f, 1f)))
                } else {
                    fillCircle(88.8f, 278.4f, 7.5f, C.ring)
                    fillCircle(268.6f, 210.3f, 14f, C.sky)
                    fillCircle(268.6f, 210.3f, 12f, C.moon)
                }
                props(pose, t)
                handsFront(pose, t)
            }
        }
    }
}

private data class Body(val dy: Float, val sx: Float = 1f, val sy: Float = 1f, val rot: Float = 0f, val pivot: Offset = Offset(200f, 200f))

private fun DrawScope.handsBack(pose: OriPose, t: Float) {
    when (pose) {
        OriPose.HI -> hand(70f, 244f, -160f, left = true)
        OriPose.SLEEPING -> { hand(100f, 270f, -140f, left = true); hand(300f, 266f, 140f) }
        OriPose.OOPS -> hand(84f, 248f, -160f, left = true)
        OriPose.THINKING -> hand(78f, 246f, -160f, left = true)
        OriPose.NEEDS -> hand(76f, 244f, -160f, left = true)
        OriPose.HELPERS, OriPose.IDLE -> { hand(70f, 244f, -160f, left = true); hand(330f, 240f, 160f) }
        else -> {}
    }
}

private fun DrawScope.handsFront(pose: OriPose, t: Float) {
    when (pose) {
        OriPose.HI -> withTransform({ translate(348f, 172f); rotate(16f, Offset.Zero) }) {
            // the wave turns around the wrist
            val a = -14f + 30f * alternate(t, 0.5f, EaseInOut)
            rotate(a, Offset(0f, 22f)) { hand(0f, 0f) }
        }
        OriPose.DONE -> {
            val dy = -10f * alternate(t, 0.62f, Bounce)
            hand(88f, 112f, -30f, left = true, dy = dy)
            hand(312f, 106f, 30f, dy = dy)
        }
        OriPose.OOPS -> hand(262f, 96f, -150f, edge = true)
        OriPose.THINKING -> hand(236f, 232f, -30f, edge = true)
        else -> {}
    }
}

private fun DrawScope.props(pose: OriPose, t: Float) {
    when (pose) {
        OriPose.WORKING -> {
            rect(140f, 230f, 122f, 80f, 9f, C.dark)
            rectStroke(140f, 230f, 122f, 80f, 9f, C.grape, 2.5f)
            rotate(-18f, Offset(201f, 270f)) { drawOval(C.ring, Offset(186f, 265f), Size(30f, 10f), style = Stroke(3f)) }
            fillCircle(201f, 270f, 5f, C.body)
            rect(124f, 306f, 154f, 11f, 5.5f, C.grape)
            hand(138f, 300f, -62f, left = true, dy = -6f * alternate(t, 0.36f, EaseInOut))
            hand(264f, 300f, 62f, dy = -6f * alternate(t, 0.36f, EaseInOut, 0.18f))
        }
        OriPose.READING -> {
            val k = wave(phase(t, 3f))
            translate(-4f * k, 3f * k) {
                fillCircle(229f, 187f, 30f, Color(0x29D2E1FF))
                drawCircle(C.metal, 30f, Offset(229f, 187f), style = Stroke(7f))
                line("M250 209 L284 247", C.handle, 10f)
                hand(290f, 254f, -140f)
                hand(72f, 246f, -160f, left = true)
            }
        }
        OriPose.SEARCHING -> {
            rotate(-6f * wave(phase(t, 4f)), Offset(240f, 180f)) {
                withTransform({ translate(240f, 176f); rotate(-30f, Offset.Zero) }) {
                    rect(-12f, -9f, 16f, 18f, 4f, C.handle)
                    fill("M2 -12 L52 -15 L52 15 L2 12 Z", C.metal)
                    fill("M50 -18 L112 -23 L112 23 L50 18 Z", C.ring)
                    rect(46f, -19f, 8f, 38f, 3f, C.handle)
                    rect(108f, -27f, 14f, 54f, 5f, C.soft)
                    ellipse(122f, 0f, 5f, 22f, Color(0xFFA6DEFF))
                    line("M70 -14 L96 -16", Color.White, 4f, 0.45f)
                }
                hand(300f, 170f, 160f)
                hand(264f, 214f, -150f, edge = true)
            }
        }
        OriPose.WRITING -> {
            rotate(-8f, Offset(168f, 272f)) {
                rect(116f, 236f, 104f, 74f, 6f, C.paper)
                line("M128 256 H204 M128 272 H196 M128 288 H178", Color(0xFFC9C3E6), 4f)
            }
            val sp = phase(t, 0.9f)
            val sx = keys(sp, floatArrayOf(0f, 0.25f, 0.5f, 0.75f, 1f), floatArrayOf(0f, -6f, -2f, -8f, 0f), EaseInOut)
            val sy = keys(sp, floatArrayOf(0f, 0.25f, 0.5f, 0.75f, 1f), floatArrayOf(0f, 2f, -2f, 1f, 0f), EaseInOut)
            translate(sx, sy) {
                withTransform({ translate(196f, 274f); rotate(-40f, Offset.Zero) }) {
                    rect(0f, -7f, 78f, 14f, 3f, C.moon)
                    drawRect(Color(0xFFF29C82), Offset(8f, -7f), Size(5f, 14f))
                    rect(70f, -7f, 14f, 14f, 3f, C.soft)
                    fill("M0 -7 L-18 0 L0 7 Z", Color(0xFFF7D9B5))
                    fill("M-11 -3 L-18 0 L-11 3 Z", C.ink)
                }
                hand(244f, 240f, -140f, edge = true)
            }
            hand(102f, 268f, -110f, left = true)
        }
        OriPose.PLANNING -> {
            rect(144f, 226f, 114f, 92f, 9f, C.metal)
            rect(153f, 238f, 96f, 72f, 5f, C.paper)
            rect(185f, 219f, 32f, 13f, 4f, C.soft)
            line("M163 255 l5 5 l9 -10", C.moon, 4f)
            line("M163 275 l5 5 l9 -10", C.moon, 4f)
            val pulse = 0.4f + 0.6f * wave(phase(t, 1.4f))
            drawRoundRect(Color(0xFFB4AEDA), Offset(162f, 289f), Size(14f, 13f), androidx.compose.ui.geometry.CornerRadius(3f), alpha = pulse, style = Stroke(3.5f))
            line("M185 256 H236 M185 276 H228 M185 296 H232", Color(0xFFC9C3E6), 4f)
            hand(144f, 288f, -75f, left = true)
            hand(258f, 288f, 75f)
        }
        OriPose.DRAWING -> {
            rotate(5f * wave(phase(t, 2.4f)), Offset(330f, 190f)) {
                withTransform({ translate(318f, 128f); rotate(9f, Offset.Zero) }) {
                    rect(-30f, -30f, 60f, 60f, 4f, Color(0xFFFFC9B8))
                    line("M-18 -12 H16 M-18 2 H10 M-18 16 H4", Color(0xFFE79A84), 4f)
                }
                hand(328f, 176f, 170f)
                hand(72f, 246f, -160f, left = true)
            }
        }
        OriPose.CAMERA -> {
            val fp = phase(t, 2.2f)
            val fa = keys(fp, floatArrayOf(0f, 0.55f, 0.62f, 0.85f, 1f), floatArrayOf(0f, 0f, 1f, 0f, 0f), EaseOutC)
            val fs = keys(fp, floatArrayOf(0f, 0.55f, 0.62f, 0.85f, 1f), floatArrayOf(0.6f, 0.6f, 1f, 1.15f, 1.15f), EaseOutC)
            if (fa > 0.01f) scale(fs, fs, Offset(345f, 90f)) {
                line("M330 92 l8 -18 M352 102 l18 -8 M346 84 l14 -14", C.body, 5f, fa)
            }
            rotate(-10f, Offset(306f, 138f)) {
                rect(266f, 112f, 82f, 56f, 11f, C.dark)
                rectStroke(266f, 112f, 82f, 56f, 11f, C.grape, 2.5f)
                rect(280f, 104f, 24f, 12f, 4f, C.dark)
                fillCircle(310f, 140f, 17f, C.metal)
                fillCircle(310f, 140f, 9f, C.soft)
                fillCircle(335f, 122f, 4f, C.moon)
            }
            hand(268f, 176f, -120f, left = true)
            hand(350f, 170f, 130f)
        }
        OriPose.NEEDS -> {
            line("M336 186 L336 64", C.soft, 5f)
            // the flag flutters: skew and stretch around the pole
            val k = alternate(t, 0.45f, EaseInOut)
            val skew = -10f + 18f * k
            val sx = 0.86f + 0.14f * k
            withTransform({
                translate(338f, 82f)
                transform(Matrix().apply { values[Matrix.SkewY] = tan(Math.toRadians(skew.toDouble())).toFloat() })
                scale(sx, 1f, Offset.Zero)
                translate(-338f, -82f)
            }) { fill("M338 64 L392 82 L338 100 Z", C.moon) }
            hand(334f, 180f, 10f)
        }
        OriPose.OOPS -> fill("M136 128 Q148 146 142 156 Q135 163 128 155 Q124 146 136 128 Z", Color(0xFFA6DEFF))
        else -> {}
    }
}

private fun DrawScope.extras(pose: OriPose, t: Float, measurer: TextMeasurer) {
    when (pose) {
        OriPose.THINKING -> {
            fillCircle(286f, 112f, 6f, C.soft, 0.2f + 0.8f * wave(phase(t, 1.3f)))
            fillCircle(306f, 88f, 8.5f, C.soft, 0.2f + 0.8f * wave(phase(t, 1.3f, 0.2f)))
            fillCircle(332f, 60f, 12f, C.soft, 0.2f + 0.8f * wave(phase(t, 1.3f, 0.4f)))
        }
        OriPose.DONE -> {
            val sparks = listOf(floatArrayOf(64f, 64f, 1.1f, 0f), floatArrayOf(342f, 56f, 0.9f, 0.35f), floatArrayOf(366f, 236f, 0.75f, 0.7f), floatArrayOf(36f, 220f, 0.75f, 1.05f))
            sparks.forEachIndexed { i, (x, y, s, d) ->
                val k = wave(phase(t, 1.4f, d))
                val sc = s * (0.25f + 0.75f * k)
                withTransform({ translate(x, y); scale(sc, sc, Offset.Zero) }) {
                    drawPath(Paths.spark, if (i % 2 == 0) C.moon else C.soft, alpha = 0.15f + 0.85f * k)
                }
            }
        }
        OriPose.SLEEPING -> {
            listOf(26f to 0f, 34f to 0.93f, 42f to 1.86f).forEach { (fs, d) ->
                val zp = phase(t, 2.8f, d)
                val e = EaseInC.transform(zp)
                val a = if (zp < 0.2f) zp / 0.2f else 1f - (zp - 0.2f) / 0.8f
                if (a > 0.01f) {
                    val layout = measurer.measure("z", TextStyle(color = C.soft, fontSize = (fs * 0.75f).sp, fontFamily = Unbounded, fontWeight = FontWeight.Medium))
                    // text sizes in sp follow density; draw it in the 400 unit square instead
                    val k = fs / layout.size.height.toFloat() * 1.25f
                    withTransform({ translate(262f + 30f * e, 122f - 70f * e - fs); scale(k, k, Offset.Zero) }) {
                        drawText(layout, alpha = a)
                    }
                }
            }
        }
        OriPose.HI, OriPose.DRAWING -> {
            fillCircle(62f, 96f, 4f, C.soft, 0.2f + 0.8f * alternate(t, 2.2f, Ease))
            fillCircle(352f, 300f, 3.5f, C.body, 0.2f + 0.8f * alternate(t, 2.2f, Ease, 0.7f))
            fillCircle(96f, 336f, 3f, C.soft, 0.2f + 0.8f * alternate(t, 2.2f, Ease, 0.35f))
        }
        else -> {}
    }
}
