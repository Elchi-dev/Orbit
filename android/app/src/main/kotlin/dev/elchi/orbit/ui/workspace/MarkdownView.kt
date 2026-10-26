package dev.elchi.orbit.ui.workspace

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.elchi.orbit.core.markdown.Inline
import dev.elchi.orbit.core.markdown.Markdown
import dev.elchi.orbit.core.markdown.MdBlock
import dev.elchi.orbit.ui.components.Hairline
import dev.elchi.orbit.ui.theme.Mono
import dev.elchi.orbit.ui.theme.MonoStyle
import dev.elchi.orbit.ui.theme.Orbit

/** Claude's answer, from Markdown: the web's `.md` styles on a phone. */
@Composable
fun MarkdownView(text: String, modifier: Modifier = Modifier, small: Boolean = false, color: Color = Orbit.Star) {
    val blocks = remember(text) { Markdown.parse(text) }
    SelectionContainer(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(if (small) 6.dp else 10.dp)) {
            for (b in blocks) Block(b, small, color)
        }
    }
}

@Composable
private fun Block(b: MdBlock, small: Boolean, color: Color) {
    val body = if (small) MaterialTheme.typography.bodySmall.copy(color = color, fontSize = 14.sp, lineHeight = 21.sp) else MaterialTheme.typography.bodyMedium.copy(color = color, fontSize = 15.5.sp, lineHeight = 25.sp)
    when (b) {
        is MdBlock.Heading -> Text(
            inline(b.inlines),
            style = body.copy(
                fontWeight = FontWeight.SemiBold,
                fontSize = when (b.level) { 1 -> 20.sp; 2 -> 17.5.sp; else -> 16.sp },
                lineHeight = when (b.level) { 1 -> 26.sp; 2 -> 23.sp; else -> 22.sp },
                letterSpacing = (-0.15).sp,
            ),
            modifier = Modifier.padding(top = if (b.level <= 2) 8.dp else 4.dp),
        )
        is MdBlock.Paragraph -> Text(inline(b.inlines), style = body)
        is MdBlock.Code -> CodeBlock(b.code)
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(Orbit.Line2))
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { for (x in b.blocks) Block(x, small, Orbit.Star2) }
        }
        is MdBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            b.items.forEachIndexed { i, item ->
                Row {
                    val marker = when {
                        item.checked == true -> "☑"
                        item.checked == false -> "☐"
                        b.ordered -> "${b.start + i}."
                        else -> "•"
                    }
                    Text(marker, style = body.copy(color = Orbit.Star3, textAlign = TextAlign.End), modifier = Modifier.widthIn(min = 20.dp).padding(end = 8.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { for (x in item.blocks) Block(x, small, color) }
                }
            }
        }
        is MdBlock.Table -> Table(b, body)
        MdBlock.Rule -> Hairline(Modifier.padding(vertical = 8.dp))
    }
}

@Composable
fun CodeBlock(code: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(Orbit.Shape)
            .background(Orbit.Well)
            .border(1.dp, Orbit.Line, Orbit.Shape)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(code, style = MonoStyle.copy(fontSize = 12.5.sp, lineHeight = 20.sp), softWrap = false)
    }
}

@Composable
private fun Table(t: MdBlock.Table, body: androidx.compose.ui.text.TextStyle) {
    val cols = maxOf(t.header.size, t.rows.maxOfOrNull { it.size } ?: 0)
    Box(Modifier.horizontalScroll(rememberScrollState())) {
        Row {
            for (c in 0 until cols) {
                Column(Modifier.width(IntrinsicSize.Max)) {
                    val align = when (t.align.getOrNull(c)) { 'r' -> TextAlign.End; 'c' -> TextAlign.Center; else -> TextAlign.Start }
                    Text(inline(t.header.getOrElse(c) { emptyList() }), style = body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Orbit.Star2, textAlign = align), modifier = Modifier.widthIn(max = 260.dp).fillMaxWidth().padding(horizontal = 12.dp, vertical = 7.dp))
                    Hairline()
                    for (r in t.rows) {
                        Text(inline(r.getOrElse(c) { emptyList() }), style = body.copy(fontSize = 14.sp, textAlign = align), modifier = Modifier.widthIn(max = 260.dp).fillMaxWidth().padding(horizontal = 12.dp, vertical = 7.dp))
                        Hairline()
                    }
                }
            }
        }
    }
}

private val linkStyles = TextLinkStyles(SpanStyle(color = Orbit.Peach, textDecoration = TextDecoration.Underline))

fun inline(list: List<Inline>): AnnotatedString = buildAnnotatedString { append(list) }

private fun AnnotatedString.Builder.append(list: List<Inline>) {
    for (x in list) when (x) {
        is Inline.Text -> append(x.text)
        is Inline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(x.children) }
        is Inline.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(x.children) }
        is Inline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(x.children) }
        is Inline.Code -> withStyle(SpanStyle(fontFamily = Mono, fontSize = 0.86.em, background = Color(0x12FFFFFF))) { append(" ${x.code} ") }
        is Inline.Link -> withLink(LinkAnnotation.Url(x.url, linkStyles)) { append(x.children) }
        Inline.Break -> append('\n')
    }
}

private val Double.em get() = androidx.compose.ui.unit.TextUnit(this.toFloat(), androidx.compose.ui.unit.TextUnitType.Em)
