package dev.elchi.orbit.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.R

/**
 * Orbit's palette (web/src/styles.css): one loud thing (the sky), everything
 * else quiet ink and hairlines. Peach means "you" or "needs you", lavender
 * means "Claude is working". Nothing else gets colour.
 */
object Orbit {
    val Void = Color(0xFF0A0A16)
    val Ink = Color(0xFF0D0D18)
    val Surface = Color(0xFF13131F)
    val Surface2 = Color(0xFF1A1A28)
    val Surface3 = Color(0xFF232334)
    val Well = Color(0xFF08080F)
    val Star = Color(0xFFECEBF4)
    val Star2 = Color(0xB3ECEBF4)
    val Star3 = Color(0x7AECEBF4)
    val Line = Color(0x13FFFFFF)
    val Line2 = Color(0x24FFFFFF)
    val Hover = Color(0x0EFFFFFF)
    val Lav = Color(0xFFB8A6FF)
    val LavInk = Color(0xFF16123A)
    val LavSoft = Color(0xFFDDD6FF)
    val Peach = Color(0xFFFFB199)
    val Peach2 = Color(0xFFFFC4B2)
    val PeachInk = Color(0xFF2A1210)
    val Danger = Color(0xFFFF8F8F)
    val Good = Color(0xFF8FE3C0)
    val Cream = Color(0xFFFFE6AE)
    val DiffDel = Color(0xFFFFB8A8)
    val DiffAdd = Color(0xFFC2EFD8)
    val Code = Color(0xFFDCDBE6)

    val RadiusS = 6.dp
    val Radius = 10.dp
    val RadiusL = 14.dp
    val ShapeS = RoundedCornerShape(RadiusS)
    val Shape = RoundedCornerShape(Radius)
    val ShapeL = RoundedCornerShape(RadiusL)
}

/** docs/MOTION.md tokens. */
object Motion {
    const val TAP = 90
    const val QUICK = 160
    const val MOVE = 260
    const val SHOW = 420
    val Glide = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    val EaseIn = CubicBezierEasing(0.55f, 0f, 0.75f, 0.1f)
    val Spring = CubicBezierEasing(0.34f, 1.4f, 0.64f, 1f)
}

/**
 * Whether things may move. Reduced follows the system (animations off, or the
 * animator scale at 0); calm (Orbit's own setting) slows loops down.
 */
@Immutable
data class MotionPrefs(val reduced: Boolean = false, val calm: Boolean = false) {
    /** How much faster or slower status loops run; 0 stops them. */
    val loopSpeed: Float get() = if (reduced) 0f else if (calm) 0.35f else 1f
}

val LocalMotion = staticCompositionLocalOf { MotionPrefs() }

val Figtree = FontFamily(
    Font(R.font.figtree_regular, FontWeight.Normal),
    Font(R.font.figtree_medium, FontWeight.Medium),
    Font(R.font.figtree_semibold, FontWeight.SemiBold),
    Font(R.font.figtree_bold, FontWeight.Bold),
)
val Unbounded = FontFamily(Font(R.font.unbounded_medium, FontWeight.Medium))
val Mono = FontFamily(Font(R.font.jetbrains_mono_regular, FontWeight.Normal), Font(R.font.jetbrains_mono_semibold, FontWeight.SemiBold))

private val base = TextStyle(fontFamily = Figtree, color = Orbit.Star)

val OrbitType = Typography(
    displaySmall = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-0.4).sp),
    headlineSmall = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = (-0.3).sp),
    titleLarge = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 19.sp, lineHeight = 25.sp, letterSpacing = (-0.2).sp),
    titleMedium = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge = base.copy(fontSize = 16.sp, lineHeight = 25.sp),
    bodyMedium = base.copy(fontSize = 15.sp, lineHeight = 23.sp),
    bodySmall = base.copy(fontSize = 13.sp, lineHeight = 19.sp, color = Orbit.Star2),
    labelLarge = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = base.copy(fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp),
    labelSmall = base.copy(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, color = Orbit.Star3),
)

val MonoStyle = TextStyle(fontFamily = Mono, fontSize = 12.5.sp, lineHeight = 20.sp, color = Orbit.Code)

private val scheme = darkColorScheme(
    primary = Orbit.Peach,
    onPrimary = Orbit.PeachInk,
    primaryContainer = Orbit.Surface3,
    onPrimaryContainer = Orbit.Star,
    secondary = Orbit.Lav,
    onSecondary = Orbit.LavInk,
    secondaryContainer = Orbit.Surface3,
    onSecondaryContainer = Orbit.Star,
    tertiary = Orbit.Good,
    background = Orbit.Void,
    onBackground = Orbit.Star,
    surface = Orbit.Surface,
    onSurface = Orbit.Star,
    surfaceVariant = Orbit.Surface2,
    onSurfaceVariant = Orbit.Star2,
    surfaceContainerLowest = Orbit.Well,
    surfaceContainerLow = Orbit.Ink,
    surfaceContainer = Orbit.Surface,
    surfaceContainerHigh = Orbit.Surface2,
    surfaceContainerHighest = Orbit.Surface3,
    surfaceBright = Orbit.Surface3,
    surfaceDim = Orbit.Void,
    outline = Orbit.Line2,
    outlineVariant = Orbit.Line,
    error = Orbit.Danger,
    onError = Orbit.PeachInk,
    inverseSurface = Orbit.Star,
    inverseOnSurface = Orbit.Void,
    scrim = Color(0xCC05050C),
)

@Composable
fun OrbitTheme(calm: Boolean = false, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val inspecting = LocalInspectionMode.current
    val reduced = remember(context) {
        !inspecting && runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
    CompositionLocalProvider(LocalMotion provides MotionPrefs(reduced = reduced, calm = calm)) {
        MaterialTheme(
            colorScheme = scheme,
            typography = OrbitType,
            shapes = Shapes(
                extraSmall = Orbit.ShapeS,
                small = Orbit.Shape,
                medium = Orbit.Shape,
                large = Orbit.ShapeL,
                extraLarge = RoundedCornerShape(20.dp),
            ),
            content = content,
        )
    }
}
