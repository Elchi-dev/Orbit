package dev.elchi.orbit.ui.workspace

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.model.Detail
import dev.elchi.orbit.core.model.PlanItem
import dev.elchi.orbit.core.model.ToolCall
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.model.str
import dev.elchi.orbit.core.state.Conversation
import dev.elchi.orbit.core.state.Format
import dev.elchi.orbit.core.state.Item
import dev.elchi.orbit.core.state.ToolWords
import dev.elchi.orbit.core.state.Turn
import dev.elchi.orbit.ui.components.Chip
import dev.elchi.orbit.ui.components.Ic
import dev.elchi.orbit.ui.theme.LocalMotion
import dev.elchi.orbit.ui.theme.Mono
import dev.elchi.orbit.ui.theme.MonoStyle
import dev.elchi.orbit.ui.theme.Motion
import dev.elchi.orbit.ui.theme.Orbit
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private fun expandSpec(reduced: Boolean) = if (reduced) expandVertically(tween(0)) else expandVertically(spring(dampingRatio = 0.85f, stiffness = 500f)) + fadeIn(tween(Motion.QUICK))
private fun shrinkSpec(reduced: Boolean) = if (reduced) shrinkVertically(tween(0)) else shrinkVertically(tween(Motion.QUICK, easing = Motion.EaseIn)) + fadeOut(tween(Motion.TAP))

/** Your message: a peach line down the side. */
@Composable
fun UserTurn(turn: Turn, modifier: Modifier = Modifier) {
    val v = Conversation.userView(turn)
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 22.dp, bottom = 8.dp)) {
        Box(Modifier.width(2.dp).fillMaxHeight().clip(CircleShape).background(Orbit.Peach))
        Spacer(Modifier.width(14.dp))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (v.attachments.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { v.attachments.forEach { Chip(it, icon = Ic.File) } }
            if (v.text.isNotBlank()) SelectionContainer {
                Text(v.text, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium, lineHeight = 25.sp))
            }
            if (v.steered) Text("Sent while Claude was working", style = MaterialTheme.typography.labelSmall)
            if (v.mission != null) Text("Mission “${v.mission}”${v.missionHow}", style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** One of Claude's runs, or the one being written right now ([live]). */
@Composable
fun AssistantTurn(
    blocks: List<JsonObject?>,
    detail: Detail,
    shellOut: Map<String, String>,
    helpers: List<Workspace>,
    onOpenHelper: (String) -> Unit,
    modifier: Modifier = Modifier,
    live: Boolean = false,
) {
    val prepared = Conversation.prepare(blocks, streaming = live)
    val motion = LocalMotion.current
    val breathe = if (live && !motion.reduced) {
        val inf = rememberInfiniteTransition(label = "live")
        inf.animateFloat(0.35f, 1f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "breathe").value
    } else 1f
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(bottom = 6.dp)) {
        Box(Modifier.width(2.dp).fillMaxHeight().padding(vertical = 4.dp).clip(CircleShape).background(if (live) Orbit.Lav.copy(alpha = breathe) else Color.Transparent))
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (live && prepared.items.isEmpty()) ThoughtTrail("", live = true)
            for (it in prepared.items) when (it) {
                is Item.Text -> Column {
                    MarkdownView(it.text)
                    if (it.live) Caret()
                }
                is Item.Thinking -> ThoughtTrail(it.text, it.live)
                is Item.Tool -> ToolRow(it.name, it.input, it.id?.let { id -> detail.calls[id] }, it.id?.let { id -> shellOut[id] }, it.live)
                is Item.Search -> SearchRow(it)
                is Item.Helpers -> HelperLanes(it.blocks, detail, helpers, onOpenHelper)
                is Item.Panel -> Panel(it.title, it.content)
            }
            if (prepared.sources.isNotEmpty() && !live) Sources(prepared.sources)
        }
    }
}

@Composable
private fun Caret() {
    val motion = LocalMotion.current
    val a = if (motion.reduced) 1f else rememberInfiniteTransition(label = "caret").animateFloat(1f, 0f, infiniteRepeatable(tween(1000, easing = { if (it < 0.5f) 0f else 1f }), RepeatMode.Restart), label = "blink").value
    Box(Modifier.padding(top = 2.dp).size(width = 2.dp, height = 18.dp).graphicsLayer { alpha = a }.background(Orbit.Lav).semantics { contentDescription = "Claude is writing" })
}

/** Thinking, folded away: "Thought trail" opens it. */
@Composable
fun ThoughtTrail(text: String, live: Boolean) {
    var open by rememberSaveable { mutableStateOf(false) }
    if (text.isBlank() && !live) return
    val motion = LocalMotion.current
    Column {
        Row(
            Modifier
                .clip(Orbit.Shape)
                .clickable(enabled = text.isNotBlank(), role = Role.Button) { open = !open }
                .semantics { stateDescription = if (open) "open" else "closed" }
                .heightIn(min = 36.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val pulse = if (live && !motion.reduced) rememberInfiniteTransition(label = "think").animateFloat(0.4f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "p").value else 1f
            Icon(Ic.Thought, null, tint = if (live) Orbit.Lav.copy(alpha = pulse) else Orbit.Star3, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(7.dp))
            Text(if (live) "Thinking" else "Thought trail", style = MaterialTheme.typography.labelMedium.copy(fontSize = 13.5.sp), color = if (live) Orbit.Star2 else Orbit.Star3)
            if (text.isNotBlank()) {
                Spacer(Modifier.width(4.dp))
                Chevron(open)
            }
        }
        AnimatedVisibility(open && text.isNotBlank(), enter = expandSpec(motion.reduced), exit = shrinkSpec(motion.reduced)) {
            Row(Modifier.height(IntrinsicSize.Min).padding(start = 10.dp, top = 2.dp, bottom = 6.dp)) {
                Box(Modifier.width(1.dp).fillMaxHeight().background(Orbit.Line2))
                Spacer(Modifier.width(12.dp))
                MarkdownView(text, small = true, color = Orbit.Star2)
            }
        }
    }
}

@Composable
private fun Chevron(open: Boolean) {
    val r by animateFloatAsState(if (open) 180f else 0f, tween(Motion.MOVE, easing = Motion.Glide), label = "chev")
    Icon(Ic.ChevronDown, null, tint = Orbit.Star3, modifier = Modifier.size(14.dp).rotate(r))
}

/** A small spinner; still under reduced motion. */
@Composable
fun Spinner(size: Dp = 15.dp, color: Color = Orbit.Lav) {
    val motion = LocalMotion.current
    val a = if (motion.reduced) 0f else rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "a").value
    Canvas(Modifier.size(size).rotate(a)) {
        drawArc(color, 0f, 270f, false, Offset(2f, 2f), Size(this.size.width - 4f, this.size.height - 4f), style = Stroke(1.8f.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** A tool call as a compact row: what, who allowed it, how it went; tap for input, diff and output. */
@Composable
fun ToolRow(name: String, input: JsonObject, call: ToolCall?, live: String?, streaming: Boolean = false) {
    var open by rememberSaveable(call?.id) { mutableStateOf(false) }
    val motion = LocalMotion.current
    val running = call?.status == "running"
    val failed = call?.isError == true && call.status == "error"
    val inp = if (input.isEmpty() && call != null) call.inputJson else input
    val output = if (running) live else call?.output
    val showOpen = open || (running && !live.isNullOrEmpty())
    val label = ToolWords.label(name, inp)
    val (vLabel, vTone) = ToolWords.verdict(call?.status, call?.decidedBy)
    val vColor = when (vTone) { "peach" -> Orbit.Peach; "lav" -> Orbit.Lav; "bad" -> Orbit.Danger; else -> Orbit.Star3 }
    val struck = call?.status == "denied" || call?.status == "cancelled"
    Column(
        Modifier
            .fillMaxWidth()
            .clip(Orbit.Shape)
            .background(if (call?.status == "pending") Orbit.Peach.copy(alpha = 0.06f) else Color.Transparent),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = if (showOpen) "Hide details" else "Show details") { open = !open }
                .heightIn(min = 40.dp)
                .padding(horizontal = 6.dp, vertical = 4.dp)
                .semantics(mergeDescendants = true) {},
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                if (running || (call == null && streaming)) Spinner() else Icon(Ic.forTool(name), null, tint = Orbit.Star3, modifier = Modifier.size(15.dp))
            }
            Spacer(Modifier.width(10.dp))
            Text(
                buildAnnotatedString {
                    append(label.before)
                    if (label.code != null) withStyle(SpanStyle(fontFamily = Mono, fontSize = 12.5.sp, color = if (struck) Orbit.Star3 else Orbit.Star)) { append(label.code) }
                    append(label.after)
                },
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 14.sp, color = if (struck) Orbit.Star3 else Orbit.Star2, textDecoration = if (struck) TextDecoration.LineThrough else null),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(5.dp).clip(CircleShape).background(vColor.copy(alpha = 0.8f)))
            Spacer(Modifier.width(5.dp))
            Text(vLabel, style = MaterialTheme.typography.labelSmall.copy(color = vColor, fontWeight = if (vTone == "peach" && call?.status == "pending") FontWeight.SemiBold else FontWeight.Medium))
            val meta = when {
                running -> ""
                failed -> "failed"
                call?.durationMs != null -> Format.ms(call.durationMs)
                else -> ""
            }
            if (meta.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Text(meta, style = MaterialTheme.typography.labelSmall.copy(color = if (failed) Orbit.Danger else Orbit.Star3))
            }
            Spacer(Modifier.width(6.dp))
            Chevron(showOpen)
        }
        AnimatedVisibility(showOpen, enter = expandSpec(motion.reduced), exit = shrinkSpec(motion.reduced)) {
            Column(Modifier.padding(start = 34.dp, end = 6.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                call?.reason?.takeIf { it.isNotBlank() }?.let { r ->
                    Text(r + (call.judgeMs?.let { " (${Format.ms(it)})" } ?: ""), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.5.sp))
                }
                ToolInput(name, inp)
                if (!output.isNullOrEmpty()) Pre(output.replace(Regex("\\n?\\[shots: [^\\]]*]"), ""))
            }
        }
    }
}

@Composable
private fun ToolInput(name: String, input: JsonObject) {
    when {
        name == "bash" -> input.str("command")?.takeIf { it.contains('\n') }?.let { Pre(it) }
        name == "edit_file" -> Diff(input.str("path"), input.str("old_string") ?: "", input.str("new_string") ?: "", 40)
        name == "write_file" -> Pre("${input.str("path") ?: ""}\n\n${(input.str("content") ?: "").take(3000)}")
        name.startsWith("ui_") || name in setOf("screenshot", "preview_open", "plan", "load_skill") -> {}
        input.isNotEmpty() -> Pre(prettyJson(input))
    }
}

private fun prettyJson(o: JsonObject): String = buildString {
    for ((k, v) in o) {
        append(k).append(": ")
        append(if (v is JsonPrimitive && v.isString) v.content else v.toString())
        append('\n')
    }
}.trimEnd()

@Composable
fun Pre(text: String, modifier: Modifier = Modifier, maxHeight: Dp = 340.dp) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(max = maxHeight)
            .clip(Orbit.Shape)
            .background(Orbit.Well)
            .border(1.dp, Orbit.Line, Orbit.Shape)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        SelectionContainer { Text(text, style = MonoStyle) }
    }
}

/** The old lines in soft red, the new in soft green. */
@Composable
fun Diff(path: String?, old: String, new: String, maxLines: Int, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(max = 320.dp)
            .clip(Orbit.Shape)
            .background(Orbit.Well)
            .border(1.dp, Orbit.Line, Orbit.Shape)
            .verticalScroll(rememberScrollState())
            .horizontalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
    ) {
        if (!path.isNullOrBlank()) Text(path, style = MonoStyle.copy(color = Orbit.Star3), modifier = Modifier.padding(horizontal = 12.dp).padding(bottom = 4.dp))
        old.split('\n').take(maxLines).forEach { Text("- $it", style = MonoStyle.copy(color = Orbit.DiffDel), softWrap = false, modifier = Modifier.background(Orbit.Danger.copy(alpha = 0.07f)).padding(horizontal = 12.dp)) }
        new.split('\n').take(maxLines).forEach { Text("+ $it", style = MonoStyle.copy(color = Orbit.DiffAdd), softWrap = false, modifier = Modifier.background(Orbit.Good.copy(alpha = 0.07f)).padding(horizontal = 12.dp)) }
    }
}

@Composable
private fun SearchRow(s: Item.Search) {
    var open by rememberSaveable(s.id) { mutableStateOf(false) }
    val motion = LocalMotion.current
    val done = s.results != null
    Column {
        Row(
            Modifier.fillMaxWidth().clip(Orbit.Shape).clickable(enabled = !s.results.isNullOrEmpty(), role = Role.Button) { open = !open }.heightIn(min = 40.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) { if (!done) Spinner() else Icon(Ic.Globe, null, tint = Orbit.Star3, modifier = Modifier.size(15.dp)) }
            Spacer(Modifier.width(10.dp))
            Text(
                (if (done) "Searched the web for " else "Searching the web for ") + "“${s.query}”",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 14.sp),
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            val err = s.error
            val res = s.results
            when {
                err != null -> Text(err, style = MaterialTheme.typography.labelSmall.copy(color = Orbit.Danger))
                !res.isNullOrEmpty() -> Text("${res.size} results", style = MaterialTheme.typography.labelSmall)
            }
        }
        AnimatedVisibility(open, enter = expandSpec(motion.reduced), exit = shrinkSpec(motion.reduced)) {
            Column(Modifier.padding(start = 34.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                s.results?.forEach { (title, url) -> LinkLine(title, url) }
            }
        }
    }
}

@Composable
private fun LinkLine(title: String, url: String) {
    Text(
        inline(listOf(dev.elchi.orbit.core.markdown.Inline.Link(listOf(dev.elchi.orbit.core.markdown.Inline.Text(title)), url))),
        style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.5.sp),
        maxLines = 2, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun Sources(sources: List<dev.elchi.orbit.core.state.Source>) {
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        sources.forEach { s ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${s.n}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.width(18.dp))
                LinkLine(s.title, s.url)
            }
        }
    }
}

@Composable
private fun Panel(title: String, content: String) {
    Column(
        Modifier.fillMaxWidth().clip(Orbit.ShapeL).background(Orbit.Surface).border(1.dp, Orbit.Line, Orbit.ShapeL).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (title.isNotBlank()) Text(title, style = MaterialTheme.typography.titleSmall)
        MarkdownView(content, small = true)
    }
}

/** Helpers that run side by side, one lane each; tap a lane to open the helper. */
@Composable
private fun HelperLanes(blocks: List<JsonObject>, detail: Detail, helpers: List<Workspace>, onOpen: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        for (b in blocks) {
            val id = b.str("id")
            val helper = helpers.firstOrNull { it.raw.str("call_id") == id }
            val input = b["input"] as? JsonObject ?: JsonObject(emptyMap())
            val title = helper?.title ?: input.str("title") ?: input.str("task")?.take(60) ?: "Helper"
            val agent = Format.agentLabel(helper?.agent ?: input.str("agent"))
            val state = if (helper != null) Format.helperState(helper.helperState, helper.running, helper.pending) else if (detail.calls[id]?.status == "done") "done" else "starting"
            val color = when (state) { "needs you" -> Orbit.Peach; "working", "starting" -> Orbit.Lav; "failed" -> Orbit.Danger; else -> Orbit.Star3 }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(Orbit.ShapeL)
                    .background(Orbit.Surface)
                    .border(1.dp, if (state == "needs you") Orbit.Peach.copy(alpha = 0.5f) else Orbit.Line, Orbit.ShapeL)
                    .clickable(enabled = helper != null, role = Role.Button, onClickLabel = "Open the helper") { helper?.let { onOpen(it.id) } }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Ic.Helpers, null, tint = color, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("$agent, $state", style = MaterialTheme.typography.labelSmall.copy(color = color))
                    helper?.report?.takeIf { it.isNotBlank() && state != "working" }?.let { Text(it.lineSequence().first().take(140), style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                }
                if (state == "working" || state == "starting") Spinner() else if (helper != null) Icon(Ic.ChevronRight, null, tint = Orbit.Star3, modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** Claude's plan for the current task: a thin bar that opens into the checklist. */
@Composable
fun PlanBar(plan: List<PlanItem>, modifier: Modifier = Modifier) {
    if (plan.isEmpty()) return
    var open by rememberSaveable { mutableStateOf(false) }
    val motion = LocalMotion.current
    val done = plan.count { it.finished }
    val doing = plan.firstOrNull { it.status == "doing" }
    val finished = done == plan.size
    val progress by animateFloatAsState(done.toFloat() / plan.size, tween(Motion.SHOW, easing = Motion.Glide), label = "plan")
    Column(modifier.fillMaxWidth().clip(Orbit.ShapeL).background(Orbit.Surface).border(1.dp, Orbit.Line, Orbit.ShapeL)) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.heightIn(min = 44.dp).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(width = 36.dp, height = 4.dp).clip(CircleShape).background(Orbit.Line2)) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(progress).clip(CircleShape).background(if (finished) Orbit.Good else Orbit.Lav))
            }
            Spacer(Modifier.width(10.dp))
            Text(if (finished) "Plan done" else doing?.text ?: "Plan", style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text("$done of ${plan.size}", style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.width(6.dp))
            Chevron(!open)
        }
        AnimatedVisibility(open, enter = expandSpec(motion.reduced), exit = shrinkSpec(motion.reduced)) {
            Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                plan.forEach { p ->
                    Row(verticalAlignment = Alignment.Top) {
                        val (mark, c) = when (p.status) {
                            "done" -> "✓" to Orbit.Good
                            "doing" -> "◌" to Orbit.Lav
                            "skipped" -> "-" to Orbit.Star3
                            else -> "○" to Orbit.Star3
                        }
                        Text(mark, color = c, style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(20.dp).semantics { contentDescription = p.status })
                        Text(
                            p.text,
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = 14.sp,
                                color = if (p.status == "doing") Orbit.Star else if (p.finished) Orbit.Star3 else Orbit.Star2,
                                textDecoration = if (p.status == "skipped") TextDecoration.LineThrough else null,
                            ),
                        )
                    }
                }
            }
        }
    }
}
