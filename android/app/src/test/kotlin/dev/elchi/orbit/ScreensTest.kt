package dev.elchi.orbit

import android.app.Application
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import com.github.takahirom.roborazzi.captureRoboImage
import dev.elchi.orbit.ui.preview.ApprovalEditPreview
import dev.elchi.orbit.ui.preview.ApprovalPreview
import dev.elchi.orbit.ui.preview.ApprovalsEmptyPreview
import dev.elchi.orbit.ui.preview.ApprovalsPreview
import dev.elchi.orbit.ui.preview.HomeEmptyPreview
import dev.elchi.orbit.ui.preview.HomeListPreview
import dev.elchi.orbit.ui.preview.HomeOfflinePreview
import dev.elchi.orbit.ui.preview.HomeSkyPreview
import dev.elchi.orbit.ui.preview.HomeTabletPreview
import dev.elchi.orbit.ui.preview.HomeUnpairedPreview
import dev.elchi.orbit.ui.preview.LicensesPreview
import dev.elchi.orbit.ui.preview.NotificationAskPreview
import dev.elchi.orbit.ui.preview.OriPosesPreview
import dev.elchi.orbit.ui.preview.PairingDonePreview
import dev.elchi.orbit.ui.preview.PairingFailedPreview
import dev.elchi.orbit.ui.preview.PairingWorkingPreview
import dev.elchi.orbit.ui.preview.ScanPreview
import dev.elchi.orbit.ui.preview.SettingsPreview
import dev.elchi.orbit.ui.preview.WelcomePreview
import dev.elchi.orbit.ui.preview.WorkspaceEmptyPreview
import dev.elchi.orbit.ui.preview.WorkspaceLivePreview
import dev.elchi.orbit.ui.preview.WorkspacePreview
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders every screen's preview on the JVM and saves it as a PNG under
 * android/screenshots, so the screens can be looked at without a device.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w411dp-h891dp-xxhdpi", application = Application::class)
class ScreensTest {
    private val dir = File(System.getProperty("orbit.screenshots") ?: "build/screenshots").apply { mkdirs() }

    @Before fun still() {
        // reduced motion: every loop holds still, so the pictures are stable
        Settings.Global.putFloat(RuntimeEnvironment.getApplication().contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private fun shot(name: String, qualifiers: String? = null, content: @Composable () -> Unit) {
        if (qualifiers != null) RuntimeEnvironment.setQualifiers(qualifiers)
        val c = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        c.get().setContent { content() }
        shadowOf(Looper.getMainLooper()).idle()
        c.get().window.decorView.captureRoboImage(File(dir, "$name.png").absolutePath)
        c.pause().stop().destroy()
    }

    @Test fun welcome() = shot("01-welcome") { WelcomePreview() }
    @Test fun scan() = shot("02-scan") { ScanPreview() }
    @Test fun pairingWorking() = shot("03-pairing") { PairingWorkingPreview() }
    @Test fun pairingDone() = shot("04-paired") { PairingDonePreview() }
    @Test fun pairingFailed() = shot("05-pairing-failed") { PairingFailedPreview() }
    @Test fun notificationAsk() = shot("06-notification-ask") { NotificationAskPreview() }
    @Test fun homeSky() = shot("10-home-sky") { HomeSkyPreview() }
    @Test fun homeList() = shot("11-home-list") { HomeListPreview() }
    @Test fun homeEmpty() = shot("12-home-empty") { HomeEmptyPreview() }
    @Test fun homeOffline() = shot("13-home-offline") { HomeOfflinePreview() }
    @Test fun homeUnpaired() = shot("14-home-unpaired") { HomeUnpairedPreview() }
    @Test fun homeTablet() = shot("15-home-tablet", "w800dp-h1280dp-xhdpi") { HomeTabletPreview() }
    @Test fun workspace() = shot("20-workspace") { WorkspacePreview() }
    @Test fun workspaceLive() = shot("21-workspace-live") { WorkspaceLivePreview() }
    @Test fun workspaceEmpty() = shot("22-workspace-empty") { WorkspaceEmptyPreview() }
    @Test fun approval() = shot("30-approval") { ApprovalPreview() }
    @Test fun approvalEdit() = shot("31-approval-edit") { ApprovalEditPreview() }
    @Test fun approvals() = shot("32-approvals") { ApprovalsPreview() }
    @Test fun approvalsEmpty() = shot("33-approvals-empty") { ApprovalsEmptyPreview() }
    @Test fun settings() = shot("40-settings", "w411dp-h1500dp-xxhdpi") { SettingsPreview() }
    @Test fun licenses() = shot("41-licenses") { LicensesPreview() }
    @Test fun ori() = shot("50-ori-poses", "w411dp-h1100dp-xxhdpi") { OriPosesPreview() }
}
