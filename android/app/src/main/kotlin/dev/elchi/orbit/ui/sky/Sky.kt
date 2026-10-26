package dev.elchi.orbit.ui.sky

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.state.Format
import dev.elchi.orbit.ui.ori.rememberLoopTime
import dev.elchi.orbit.ui.theme.Figtree
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Orbit
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/** Where one planet goes (web/src/components/orrery/FlatOrrery.tsx). */
data class Orbiting(val ws: Workspace, val r: Float, val phase: Float, val size: Float)

fun layoutSky(workspaces: List<Workspace>): List<Orbiting> =
    workspaces.sortedByDescending { it.updatedAt }.mapIndexed { i, ws ->
        val r = 2.9f + i * 1.3f + if (i > 2) 0.8f else 0f
        val size = (22 + log10((ws.tokens + 10).toDouble()) * 10).toFloat().coerceIn(30f, 88f)
        Orbiting(ws, r, i * 2.39996f, size)
    }

/** What TalkBack says for a planet. */
fun planetLabel(ws: Workspace, now: Long): String = buildString {
    append(ws.title)
    append(", ")
    append(
        when {
            ws.needsYou -> "needs you"
            ws.busy -> Format.helpersLine(ws)
            else -> "last active ${Format.ago(ws.updatedAt, now)}"
        },
    )
}

private class Hit(val id: String, val x: Float, val y: Float, val r: Float)

/**
 * The flat sky: dark space, stars, the dust belt, the sun with its corona, and
 * the workspaces as planets on their orbits. Busy planets turn faster and
 * spark, a waiting one pulses peach, helpers circle as moons. Tap a planet to
 * open it; TalkBack gets one action per planet.
 */
@Composable
fun Sky(workspaces: List<Workspace>, onOpen: (String) -> Unit, modifier: Modifier = Modifier, now: Long = System.currentTimeMillis()) {
    val motion = LocalMotion.current
    val time = rememberLoopTime(if (motion.reduced) 0f else 1f)
    val layout = remember(workspaces) { layoutSky(workspaces) }
    val hits = remember { ArrayList<Hit>() }
    val measurer = rememberTextMeasurer()
    val open by rememberUpdatedState(onOpen)
    val speed = motion.loopSpeed
    val stars = remember { starField(140) }
    val belt = remember { beltDust(260) }
    val desc = when (workspaces.size) {
        0 -> "The sky. No workspaces yet."
        1 -> "The sky with one workspace."
        else -> "The sky with ${workspaces.size} workspaces."
    } + workspaces.count { it.needsYou }.let { if (it > 0) " $it ${if (it == 1) "needs" else "need"} you." else "" }

    Box(modifier) {
        Canvas(
            Modifier
                .matchParentSize()
                .semantics {
                    contentDescription = desc
                    customActions = layout.map { o -> CustomAccessibilityAction("Open ${planetLabel(o.ws, now)}") { open(o.ws.id); true } }
                }
                .pointerInput(Unit) {
                    detectTapGestures { p ->
                        val best = hits.minByOrNull { hypot(it.x - p.x, it.y - p.y) - it.r }
                        if (best != null && hypot(best.x - p.x, best.y - p.y) < best.r + 24.dp.toPx()) open(best.id)
                    }
                },
        ) {
            val t = time.value
            drawSpace(stars, t)
            val w = size.width
            val h = size.height
            // keep the system inside the canvas, whatever its shape
            val cx = w / 2
            val cy = h * 0.48f
            // a tall screen gets a rounder view of the system, a wide one a flatter view
            val rx = w * 0.37f
            val ry = min(rx * (if (h > w * 1.2f) 0.95f else 0.5f), h * 0.4f)
            val unit = (min(w, h) / density / 411f).coerceIn(0.75f, 1.4f)
            val maxR = max(6f, layout.maxOfOrNull { it.r } ?: 0f)
            // orbits start clear of the sun
            fun frac(r: Float) = 0.3f + 0.7f * (r / maxR)

            drawBelt(belt, cx, cy, rx * frac(4.8f), ry * frac(4.8f), t * speed)
            for (o in layout) {
                val f = frac(o.r)
                drawOval(Color.White.copy(alpha = 0.09f), Offset(cx - rx * f, cy - ry * f), Size(2 * rx * f, 2 * ry * f), style = Stroke(1.dp.toPx()))
            }

            data class P(val o: Orbiting, val x: Float, val y: Float, val s: Float)
            val placed = layout.map { o ->
                val a = o.phase + t * speed * (0.55f / o.r.pow(1.15f)) * (if (o.ws.running) 2.6f else 1f)
                val f = frac(o.r)
                P(o, cx + cos(a) * rx * f, cy + sin(a) * ry * f, (o.size * 0.62f).dp.toPx() * unit)
            }
            // planets behind the sun first, labels last so no planet covers one
            val (back, front) = placed.partition { it.y < cy }
            hits.clear()
            for (p in back.sortedBy { it.y }) drawPlanet(p.o.ws, p.x, p.y, p.s, t, speed, unit)
            drawSun(cx, cy, 26.dp.toPx() * unit, t * speed)
            for (p in front.sortedBy { it.y }) drawPlanet(p.o.ws, p.x, p.y, p.s, t, speed, unit)
            for (p in placed.sortedBy { it.y }) drawLabel(p.o.ws, p.x, p.y, p.s, measurer, unit, now)
            for (p in placed) hits += Hit(p.o.ws.id, p.x, p.y, p.s / 2)
        }
    }
}

private class Star(val x: Float, val y: Float, val r: Float, val a: Float, val warm: Boolean, val tw: Float)

private fun rnd(i: Int, n: Int): Float {
    val x = sin(i * 12.9898 + n * 78.233) * 43758.5453
    return (x - floor(x)).toFloat()
}

private fun starField(n: Int) = List(n) { i -> Star(rnd(i, 1), rnd(i, 2), 0.5f + rnd(i, 3) * 0.9f, 0.25f + rnd(i, 4) * 0.6f, rnd(i, 5) < 0.12f, rnd(i, 6) * 6f) }

private class Dust(val a: Float, val d: Float, val s: Float, val o: Float)

private fun beltDust(n: Int) = List(n) { i -> Dust(rnd(i, 7) * 2 * PI.toFloat(), 0.8f + rnd(i, 8) * 0.18f, 0.7f + rnd(i, 9) * 1f, 0.25f + rnd(i, 10) * 0.5f) }

private fun DrawScope.drawSpace(stars: List<Star>, t: Float) {
    drawRect(Orbit.Void)
    val w = size.width
    val h = size.height
    // the nebula: soft violet clouds behind everything
    fun cloud(x: Float, y: Float, r: Float, c: Color) = drawCircle(Brush.radialGradient(listOf(c, Color.Transparent), Offset(x * w, y * h), r * max(w, h)), r * max(w, h), Offset(x * w, y * h))
    cloud(0.5f, 0.46f, 0.42f, Color(0x4D785CEB))
    cloud(0.3f, 0.28f, 0.3f, Color(0x3A523CBE))
    cloud(0.74f, 0.66f, 0.32f, Color(0x333A46AA))
    cloud(0.16f, 0.82f, 0.26f, Color(0x265A32A0))
    cloud(0.86f, 0.18f, 0.24f, Color(0x26463296))
    for (s in stars) {
        val tw = 0.65f + 0.35f * sin(t * 0.9f + s.tw)
        drawCircle(if (s.warm) Color(0xFFFFD2C4) else Orbit.Star, s.r * density * 0.8f, Offset(s.x * w, s.y * h), alpha = s.a * tw)
    }
}

private fun DrawScope.drawBelt(belt: List<Dust>, cx: Float, cy: Float, rx: Float, ry: Float, t: Float) {
    val turn = t * (2 * PI.toFloat() / 220f)
    for (d in belt) {
        val a = d.a + turn
        drawCircle(Color(0xFFE6E2FF), d.s * density * 0.7f, Offset(cx + cos(a) * rx * d.d, cy + sin(a) * ry * d.d), alpha = d.o * 0.7f)
    }
}

private fun DrawScope.drawSun(cx: Float, cy: Float, r: Float, t: Float) {
    val c = Offset(cx, cy)
    // the two glows of the web's box-shadow
    drawCircle(Brush.radialGradient(listOf(Color(0x47AA8CFF), Color.Transparent), c, r * 3.4f), r * 3.4f, c)
    drawCircle(Brush.radialGradient(listOf(Color(0x73FFD6C8), Color.Transparent), c, r * 1.9f), r * 1.9f, c)
    // the corona breathes every 4 s
    val k = (1 - cos(2 * PI * t / 4.0)).toFloat() / 2
    val cr = r * (1.38f + 0.06f * k)
    drawCircle(Brush.radialGradient(0.55f to Color(0x80FFE6DA), 1f to Color.Transparent, center = c, radius = cr), cr, c, alpha = 0.75f + 0.25f * k)
    drawCircle(
        Brush.radialGradient(
            0f to Color.White, 0.3f to Color(0xFFFFF4EC), 0.58f to Color(0xFFFFD9C6), 0.86f to Color(0xFFF2A68C), 1f to Color(0xFFE6806A),
            center = Offset(cx - r * 0.12f, cy - r * 0.2f), radius = r * 1.1f,
        ),
        r, c,
    )
}

private fun mix(a: Color, b: Color, f: Float) = lerp(a, b, f)

private fun DrawScope.drawPlanet(ws: Workspace, x: Float, y: Float, d: Float, t: Float, speed: Float, unit: Float) {
    val c = Color(ws.style.color.toInt())
    val r = d / 2
    val center = Offset(x, y)
    val need = ws.needsYou
    val busy = !need && ws.busy

    // status glow: peach pulse when waiting, a lavender breath while working
    if (need || busy) {
        val period = if (need) 1.2f else 1.6f
        val k = if (speed == 0f) 0.6f else (1 - cos(2 * PI * t / period)).toFloat() / 2
        val gc = if (need) Orbit.Peach else Orbit.Lav
        drawCircle(Brush.radialGradient(listOf(gc.copy(alpha = 0.35f + 0.3f * k), Color.Transparent), center, r * 2.1f), r * 2.1f, center)
        drawCircle(gc.copy(alpha = 0.75f), r + 2.dp.toPx(), center, style = Stroke(2.dp.toPx()))
    } else {
        drawCircle(Brush.radialGradient(listOf(c.copy(alpha = 0.35f), Color.Transparent), center, r * 1.6f), r * 1.6f, center)
    }

    val ringC = mix(c, Color.White, 0.4f).copy(alpha = 0.55f)
    val ringRect = Rect(x - r * 1.76f, y - r * 0.24f, x + r * 1.76f, y + r * 0.24f)
    if (ws.style.rings) rotate(-14f, center) {
        clipRect(ringRect.left - 4, ringRect.top - 8, ringRect.right + 4, y) {
            drawOval(ringC, ringRect.topLeft, ringRect.size, style = Stroke(3.dp.toPx() * unit))
        }
    }

    val circle = Path().apply { addOval(Rect(center, r)) }
    clipPath(circle) {
        drawCircle(Brush.radialGradient(listOf(c, mix(c, Color(0xFF050414), 0.55f)), center, r), r, center)
        surface(ws.style.surface, x, y, r)
        drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.45f), Color.Transparent), Offset(x - r * 0.32f, y - r * 0.4f), r * 0.84f), r, center)
        // the night side
        drawCircle(Brush.radialGradient(0.45f to Color.Transparent, 1f to Color(0xC0050414), center = Offset(x - r * 0.35f, y - r * 0.45f), radius = r * 1.75f), r, center)
    }
    drawCircle(Color.White.copy(alpha = 0.05f), r, center, style = Stroke(1f))

    if (ws.style.rings) rotate(-14f, center) {
        clipRect(ringRect.left - 4, y, ringRect.right + 4, ringRect.bottom + 8) {
            drawOval(ringC, ringRect.topLeft, ringRect.size, style = Stroke(3.dp.toPx() * unit))
        }
    }

    // sparks for a busy planet: three small stars that come and go
    if (busy) for (i in 0 until 3) {
        val ph = ((t * speed) / 1.8f + i / 3f) % 1f
        val a = i * 2.1f + t * speed * 0.8f
        val sr = r * (1.25f + 0.25f * ph)
        val sx = x + cos(a) * sr
        val sy = y + sin(a) * sr
        val alpha = sin(ph * PI).toFloat()
        val l = 3.dp.toPx() * (0.5f + ph)
        drawLine(Orbit.LavSoft, Offset(sx - l, sy), Offset(sx + l, sy), 1.4f.dp.toPx(), StrokeCap.Round, alpha = alpha)
        drawLine(Orbit.LavSoft, Offset(sx, sy - l), Offset(sx, sy + l), 1.4f.dp.toPx(), StrokeCap.Round, alpha = alpha)
    }

    // helpers ride along as moons
    ws.helpers.filter { it.state != "merged" && it.state != "discarded" }.takeLast(4).forEachIndexed { k, h ->
        val mr = d * (0.78f + k * 0.16f)
        val a = (t * speed + k * 1.7f) / 7f * 2 * PI.toFloat()
        val m = Offset(x + cos(a) * mr, y + sin(a) * mr * 0.45f)
        drawCircle(Color(0x99D9D2FF), 5.dp.toPx(), m)
        drawCircle(if (h.running) Color.White else Color(0xFFD9D2FF), 3.5f.dp.toPx(), m)
    }
}

private fun DrawScope.drawLabel(ws: Workspace, x: Float, y: Float, d: Float, measurer: TextMeasurer, unit: Float, now: Long) {
    val r = d / 2
    val need = ws.needsYou
    val busy = !need && ws.busy
    val title = measurer.measure(
        ws.title, TextStyle(fontFamily = Figtree, fontWeight = FontWeight.SemiBold, fontSize = (12.5f * unit.coerceAtMost(1.1f)).sp, color = Orbit.Star),
        overflow = TextOverflow.Ellipsis, maxLines = 1, constraints = Constraints(maxWidth = (120.dp.toPx()).toInt()),
    )
    val stateText = when {
        need -> "needs you"
        busy -> Format.helpersLine(ws)
        else -> Format.ago(ws.updatedAt, now)
    }
    val sub = measurer.measure(
        stateText, TextStyle(fontFamily = Figtree, fontWeight = if (need) FontWeight.SemiBold else FontWeight.Medium, fontSize = (11f * unit.coerceAtMost(1.1f)).sp, color = if (need) Orbit.Peach else if (busy) Orbit.Lav else Orbit.Star3),
        maxLines = 1,
    )
    val top = y + r + 6.dp.toPx()
    val half = (max(title.size.width, sub.size.width) + 14.dp.toPx()) / 2
    val lx = x.coerceIn(half + 4.dp.toPx(), size.width - half - 4.dp.toPx())
    val bw = max(title.size.width, sub.size.width) + 14.dp.toPx()
    val bh = title.size.height + sub.size.height + 6.dp.toPx()
    drawRoundRect(Color(0xB3090914), Offset(lx - bw / 2, top), Size(bw, bh), androidx.compose.ui.geometry.CornerRadius(8.dp.toPx()))
    drawText(title, topLeft = Offset(lx - title.size.width / 2, top + 3.dp.toPx()))
    drawText(sub, topLeft = Offset(lx - sub.size.width / 2, top + 3.dp.toPx() + title.size.height))
}

/** Each surface's texture, drawn inside the planet's circle. */
private fun DrawScope.surface(kind: String, x: Float, y: Float, r: Float) {
    when (kind) {
        "gas" -> rotate(-12f, Offset(x, y)) {
            var yy = y - r
            var i = 0
            while (yy < y + r) {
                val light = i % 2 == 0
                drawRect(if (light) Color.White.copy(alpha = 0.16f) else Color.Black.copy(alpha = 0.16f), Offset(x - r * 1.2f, yy), Size(r * 2.4f, r * (if (light) 0.16f else 0.22f)))
                yy += r * 0.36f
                i++
            }
        }
        "rocky" -> {
            fun crater(fx: Float, fy: Float, fr: Float, a: Float) = drawCircle(Color.Black.copy(alpha = a), r * fr, Offset(x - r + 2 * r * fx, y - r + 2 * r * fy))
            crater(0.3f, 0.6f, 0.15f, 0.35f)
            crater(0.64f, 0.34f, 0.2f, 0.3f)
            crater(0.7f, 0.7f, 0.12f, 0.28f)
            drawCircle(Color.White.copy(alpha = 0.2f), r * 0.1f, Offset(x - r + 2 * r * 0.42f, y - r + 2 * r * 0.22f))
        }
        "ice" -> {
            drawCircle(Color.White.copy(alpha = 0.6f), r * 0.46f, Offset(x, y - r * 0.92f))
            drawCircle(Color.White.copy(alpha = 0.5f), r * 0.38f, Offset(x, y + r * 0.96f))
            rotate(-20f, Offset(x, y)) { drawRect(Color.White.copy(alpha = 0.16f), Offset(x - r, y - r * 0.08f), Size(2 * r, r * 0.16f)) }
        }
        "ocean" -> {
            drawOval(Color(0xB0F0FFE6), Offset(x - r * 0.62f, y - r * 0.42f), Size(r * 0.7f, r * 0.5f))
            drawOval(Color(0x99F0FFE6), Offset(x + r * 0.1f, y + r * 0.2f), Size(r * 0.55f, r * 0.38f))
            drawOval(Color(0x88F0FFE6), Offset(x + r * 0.15f, y - r * 0.62f), Size(r * 0.36f, r * 0.24f))
        }
        "lava" -> {
            // glowing cracks across a dark crust
            for (i in 0 until 7) {
                val a = (20 + i * 51f) * PI.toFloat() / 180f
                val sx = x + cos(a) * r * 0.25f
                val sy = y + sin(a) * r * 0.25f
                drawLine(Color(0x99FFA050), Offset(sx, sy), Offset(sx + cos(a + 0.5f) * r * 0.7f, sy + sin(a + 0.5f) * r * 0.7f), r * 0.045f, StrokeCap.Round, blendMode = BlendMode.Screen)
            }
            drawCircle(Brush.radialGradient(listOf(Color(0x66FF783C), Color.Transparent), Offset(x, y), r), r, Offset(x, y), blendMode = BlendMode.Screen)
        }
    }
}
