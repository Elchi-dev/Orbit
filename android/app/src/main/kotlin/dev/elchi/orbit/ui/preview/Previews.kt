package dev.elchi.orbit.ui.preview

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.state.Ended
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.data.AlertMode
import dev.elchi.orbit.ui.NotificationAskBody
import dev.elchi.orbit.ui.approval.ApprovalCard
import dev.elchi.orbit.ui.approval.ApprovalsScreen
import dev.elchi.orbit.ui.home.HomeScreen
import dev.elchi.orbit.ui.home.HomeUi
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.ori.oriLabel
import dev.elchi.orbit.ui.pair.PairState
import dev.elchi.orbit.ui.pair.PairingScreen
import dev.elchi.orbit.ui.pair.ScanScreen
import dev.elchi.orbit.ui.pair.WelcomeScreen
import dev.elchi.orbit.ui.settings.LicensesScreen
import dev.elchi.orbit.ui.settings.SettingsScreen
import dev.elchi.orbit.ui.settings.SettingsUi
import dev.elchi.orbit.ui.theme.OrbitTheme
import dev.elchi.orbit.ui.theme.Orbit
import dev.elchi.orbit.ui.workspace.WorkspaceScreen
import dev.elchi.orbit.ui.workspace.WorkspaceUi

// Every screen with made-up data, for Android Studio's preview and for the
// screenshot tests in app/src/test (which save them to android/screenshots).

private const val PHONE = "spec:width=411dp,height=891dp,dpi=420"
private const val TABLET = "spec:width=800dp,height=1280dp,dpi=320"

@Composable
fun Frame(content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) = OrbitTheme { Box(Modifier.fillMaxSize().background(Orbit.Void)) { content() } }

@Preview(device = PHONE, showBackground = true)
@Composable
fun WelcomePreview() = Frame { WelcomeScreen({}, {}) }

@Preview(device = PHONE)
@Composable
fun ScanPreview() = Frame {
    ScanScreen({}, {}) { m, _ ->
        // the camera can't run in a preview: a dim stand-in
        Box(m.background(Brush.radialGradient(listOf(Color(0xFF2A2840), Color(0xFF0B0B14)))))
    }
}

@Preview(device = PHONE)
@Composable
fun PairingWorkingPreview() = Frame { PairingScreen(PairState.Working("Kim's Mac mini"), {}, {}, {}) }

@Preview(device = PHONE)
@Composable
fun PairingDonePreview() = Frame { PairingScreen(PairState.Done("Kim's Mac mini"), {}, {}, {}) }

@Preview(device = PHONE)
@Composable
fun PairingFailedPreview() = Frame { PairingScreen(PairState.Failed("That pairing code has expired. Show a new one in Orbit."), {}, {}, {}) }

private fun home(asList: Boolean = false, conn: ConnState = Samples.online, empty: Boolean = false) = HomeUi(
    Samples.computer, listOf(Samples.computer, Samples.laptop), conn,
    if (empty) Samples.state.copy(workspaces = emptyMap(), approvals = emptyList()) else Samples.state,
    asList, "pair", Samples.NOW,
)

@Composable
private fun HomeFor(ui: HomeUi) = HomeScreen(ui, {}, { _, _ -> true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})

@Preview(device = PHONE)
@Composable
fun HomeSkyPreview() = Frame { HomeFor(home()) }

@Preview(device = PHONE)
@Composable
fun HomeListPreview() = Frame { HomeFor(home(asList = true)) }

@Preview(device = PHONE)
@Composable
fun HomeEmptyPreview() = Frame { HomeFor(home(empty = true)) }

@Preview(device = PHONE)
@Composable
fun HomeOfflinePreview() = Frame { HomeFor(home(conn = ConnState.Offline("Orbit isn't connected to the relay. Is the computer on, with Orbit running?", Long.MAX_VALUE))) }

@Preview(device = PHONE)
@Composable
fun HomeUnpairedPreview() = Frame { HomeFor(home(conn = ConnState.Unpaired("This phone is not paired with this computer."))) }

@Preview(device = TABLET)
@Composable
fun HomeTabletPreview() = Frame { HomeFor(home()) }

private fun backupsUi() = WorkspaceUi(
    Samples.backups, Samples.detail, null, emptyMap(), null, 0, Samples.server, Samples.online, emptyList(), 1, Samples.NOW,
)

@Composable
private fun WsFor(ui: WorkspaceUi) = WorkspaceScreen(ui, {}, { _, _, _ -> true }, {}, {}, {}, {}, {}, {})

@Preview(device = PHONE)
@Composable
fun WorkspacePreview() = Frame { WsFor(backupsUi()) }

@Preview(device = PHONE)
@Composable
fun WorkspaceLivePreview() = Frame {
    WsFor(WorkspaceUi(Samples.site, Samples.siteDetail, Samples.siteStream, emptyMap(), null, 1, Samples.server, Samples.online, listOf(Samples.helper), 0, Samples.NOW))
}

@Preview(device = PHONE)
@Composable
fun WorkspaceEmptyPreview() = Frame {
    WsFor(WorkspaceUi(Samples.api, dev.elchi.orbit.core.model.Detail.EMPTY, null, emptyMap(), Ended("done", Samples.NOW - 1000), 0, Samples.server, ConnState.Connecting(2), emptyList(), 0, Samples.NOW))
}

/** The sheet's content as it shows over the workspace (the sheet itself is a separate window). */
@Composable
private fun SheetFrame(content: @Composable () -> Unit) = Frame {
    WsFor(backupsUi())
    Box(Modifier.fillMaxSize().background(Color(0xB805050C)))
    Column(
        Modifier.align(Alignment.BottomCenter).fillMaxWidth().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Orbit.Surface).padding(top = 22.dp),
    ) { content() }
}

@Preview(device = PHONE)
@Composable
fun ApprovalPreview() = SheetFrame { ApprovalCard(Samples.approval, 0, "manual", { _, _, _ -> }) }

@Preview(device = PHONE)
@Composable
fun ApprovalEditPreview() = SheetFrame { ApprovalCard(Samples.editApproval, 2, "auto", { _, _, _ -> }) }

@Preview(device = PHONE)
@Composable
fun ApprovalsPreview() = Frame { ApprovalsScreen(listOf(Samples.approval, Samples.editApproval), "Kim's Mac mini", {}, {}) }

@Preview(device = PHONE)
@Composable
fun ApprovalsEmptyPreview() = Frame { ApprovalsScreen(emptyList(), "Kim's Mac mini", {}, {}) }

@Preview(device = PHONE, heightDp = 1500)
@Composable
fun SettingsPreview() = Frame {
    SettingsScreen(
        SettingsUi(listOf(Samples.computer, Samples.laptop), Samples.computer.room, Samples.settings.copy(alertMode = AlertMode.RELAY), false, false, false, "0.5.0", "0.5.0"),
        {}, {}, { _, _ -> }, {}, {}, {}, {}, {}, {}, {}, {},
    )
}

@Preview(device = PHONE)
@Composable
fun LicensesPreview() = Frame { LicensesScreen {} }

@Preview(device = PHONE)
@Composable
fun NotificationAskPreview() = Frame {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Orbit.Surface).padding(top = 24.dp)) {
            NotificationAskBody({}, {})
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Preview(device = PHONE, heightDp = 1100)
@Composable
fun OriPosesPreview() = Frame {
    FlowRow(Modifier.fillMaxSize().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (p in OriPose.entries) Column(Modifier.width(122.dp).clip(RoundedCornerShape(14.dp)).background(Orbit.Surface).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Ori(p, 104.dp)
            Text(p.name.lowercase(), style = MaterialTheme.typography.labelMedium)
        }
        Column(Modifier.width(122.dp).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Ori(OriPose.NEEDS, 28.dp)
            Text(oriLabel(OriPose.NEEDS).take(0) + "small", style = MaterialTheme.typography.labelMedium)
        }
    }
}
