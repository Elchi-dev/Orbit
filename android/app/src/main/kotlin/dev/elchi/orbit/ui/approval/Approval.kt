package dev.elchi.orbit.ui.approval

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.model.str
import dev.elchi.orbit.core.state.Format
import dev.elchi.orbit.core.state.OriPose
import dev.elchi.orbit.core.state.ToolWords
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.components.OrbitButton
import dev.elchi.orbit.ui.components.OrbitField
import dev.elchi.orbit.ui.components.OrbitIconButton
import dev.elchi.orbit.ui.components.OriEmpty
import dev.elchi.orbit.ui.components.Tone
import dev.elchi.orbit.ui.ori.Ori
import dev.elchi.orbit.ui.theme.Orbit
import dev.elchi.orbit.ui.workspace.Diff
import dev.elchi.orbit.ui.workspace.Pre

enum class Decision(val id: String) { ALLOW("allow"), ALWAYS("always"), DENY("deny") }

/** The bottom sheet for one approval, with how many more wait behind it. */
@Composable
fun ApprovalSheet(approval: Approval, more: Int, mode: String?, onDecide: (Decision, pattern: String?, note: String?) -> Unit, onDismiss: () -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = Orbit.Surface,
        scrimColor = androidx.compose.ui.graphics.Color(0xB805050C),
        dragHandle = { Box(Modifier.padding(top = 10.dp, bottom = 4.dp).size(width = 36.dp, height = 4.dp).clip(Orbit.Shape).background(Orbit.Line2)) },
    ) {
        ApprovalCard(approval, more, mode, onDecide, Modifier.navigationBarsPadding())
    }
}

/** What Claude wants to do, the judge's note, and the three answers. */
@Composable
fun ApprovalCard(approval: Approval, more: Int, mode: String?, onDecide: (Decision, String?, String?) -> Unit, modifier: Modifier = Modifier) {
    val h = LocalHapticFeedback.current
    var pattern by rememberSaveable(approval.id) { mutableStateOf(approval.suggestion) }
    var note by rememberSaveable(approval.id) { mutableStateOf("") }
    var showNote by rememberSaveable(approval.id) { mutableStateOf(false) }
    var showRule by rememberSaveable(approval.id) { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Ori(OriPose.NEEDS, 44.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (approval.parentId != null) "${Format.agentLabel(approval.agent)} helper, ${approval.workspaceTitle}" else approval.workspaceTitle,
                    style = MaterialTheme.typography.labelLarge, color = Orbit.Star2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (approval.parentId != null) Text("for ${approval.parentTitle ?: "its workspace"}", style = MaterialTheme.typography.labelSmall)
                if (more > 0) Text("$more more waiting", style = MaterialTheme.typography.labelSmall.copy(color = Orbit.Peach))
            }
        }
        Text(ToolWords.headline(approval), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        if (approval.name != "edit_file") Pre(ToolWords.approvalBody(approval), maxHeight = 220.dp)
        else {
            val i = approval.inputObj
            Diff(i.str("path"), i.str("old_string") ?: "", i.str("new_string") ?: "", 8)
        }
        Row(Modifier.fillMaxWidth().clip(Orbit.Shape).background(Orbit.Well).padding(12.dp), verticalAlignment = Alignment.Top) {
            Icon(if (approval.judge != null) Ic.Scale else Ic.Hand, null, tint = Orbit.Star3, modifier = Modifier.size(16.dp).padding(top = 2.dp))
            Spacer(Modifier.width(10.dp))
            val j = approval.judge
            Text(
                if (j != null) "The judge wasn't sure. ${j.reason}"
                else when (mode) {
                    "auto" -> "The judge passed this to you."
                    "full" -> "This reaches outside the folder, so it comes to you."
                    else -> "Manual mode: you approve anything that isn't read-only or covered by one of your rules."
                },
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.5.sp),
            )
        }
        OrbitButton("Allow once", { h.performHapticFeedback(HapticFeedbackType.Confirm); onDecide(Decision.ALLOW, null, null) }, Modifier.fillMaxWidth(), Tone.PEACH, Ic.Check, big = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OrbitButton("Always allow", {
                h.performHapticFeedback(HapticFeedbackType.Confirm)
                onDecide(Decision.ALWAYS, pattern.trim().ifEmpty { approval.suggestion }, null)
            }, Modifier.weight(1f), Tone.OUTLINE, Ic.CheckCheck)
            OrbitButton("Deny", {
                h.performHapticFeedback(HapticFeedbackType.Reject)
                onDecide(Decision.DENY, null, note.trim().ifEmpty { null })
            }, Modifier.weight(1f), Tone.DANGER, Ic.X)
            OrbitIconButton(Ic.Note, "Tell Claude why", { showNote = !showNote }, on = showNote)
        }
        AnimatedVisibility(showNote) {
            OrbitField(note, { note = it }, "Why not? Claude reads this and tries another way", Modifier.fillMaxWidth())
        }
        Column {
            Row(
                Modifier.clip(Orbit.Shape).clickable(role = Role.Button) { showRule = !showRule }.padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Always allow saves this rule for the workspace: ", style = MaterialTheme.typography.labelSmall)
                Text(if (showRule) "hide" else "edit", style = MaterialTheme.typography.labelSmall.copy(color = Orbit.Peach, fontWeight = FontWeight.SemiBold))
            }
            if (!showRule) Text(pattern, style = dev.elchi.orbit.ui.theme.MonoStyle.copy(color = Orbit.Star2), maxLines = 2, overflow = TextOverflow.Ellipsis)
            AnimatedVisibility(showRule) {
                OrbitField(pattern, { pattern = it }, "Rule pattern", Modifier.fillMaxWidth(), textStyle = dev.elchi.orbit.ui.theme.MonoStyle.copy(fontSize = 13.sp))
            }
        }
    }
}

/** Everything that waits for you on this computer, the oldest first. */
@Composable
fun ApprovalsScreen(approvals: List<Approval>, computer: String, onBack: () -> Unit, onOpen: (Approval) -> Unit) {
    Column(Modifier.fillMaxSize().background(Orbit.Ink)) {
        Row(Modifier.statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            OrbitIconButton(Ic.ChevronLeft, "Back", onBack)
            Column {
                Text("Waiting for you", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                Text(computer, style = MaterialTheme.typography.labelSmall)
            }
        }
        if (approvals.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                OriEmpty(OriPose.DONE, "Nothing waits for you", "When Claude asks before acting, it shows up here and on the sky.")
            }
        } else {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.navigationBarsPadding()) {
                items(approvals, key = { it.id }) { a -> ApprovalRow(a) { onOpen(a) } }
            }
        }
    }
}

@Composable
fun ApprovalRow(a: Approval, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Orbit.ShapeL)
            .background(Orbit.Surface)
            .border(1.dp, Orbit.Line, Orbit.ShapeL)
            .clickable(role = Role.Button, onClickLabel = "Decide", onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = "${a.homeTitle} needs you: ${ToolWords.headline(a)}, ${a.subject}" }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(2.dp).height(40.dp).background(Orbit.Peach))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).widthIn(min = 0.dp)) {
            Text("${a.homeTitle} needs you", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ToolWords.headline(a), style = MaterialTheme.typography.labelSmall)
            Text(ToolWords.approvalBody(a).lineSequence().first(), style = dev.elchi.orbit.ui.theme.MonoStyle.copy(color = Orbit.Star2), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Ic.ChevronRight, null, tint = Orbit.Star3, modifier = Modifier.size(18.dp))
    }
}
