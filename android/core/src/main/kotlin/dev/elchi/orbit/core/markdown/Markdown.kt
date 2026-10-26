package dev.elchi.orbit.core.markdown

/**
 * A small Markdown reader for Claude's answers: headings, paragraphs, lists
 * (nested by indent), code blocks, quotes, tables, rules, and the inline marks
 * bold, italic, strike, code and links. Enough for chat; not CommonMark.
 */
sealed interface MdBlock {
    data class Heading(val level: Int, val inlines: List<Inline>) : MdBlock
    data class Paragraph(val inlines: List<Inline>) : MdBlock
    data class Code(val lang: String, val code: String) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<ListItem>) : MdBlock
    data class Table(val header: List<List<Inline>>, val align: List<Char>, val rows: List<List<List<Inline>>>) : MdBlock
    data object Rule : MdBlock
}

data class ListItem(val blocks: List<MdBlock>, val checked: Boolean? = null)

sealed interface Inline {
    data class Text(val text: String) : Inline
    data class Bold(val children: List<Inline>) : Inline
    data class Italic(val children: List<Inline>) : Inline
    data class Strike(val children: List<Inline>) : Inline
    data class Code(val code: String) : Inline
    data class Link(val children: List<Inline>, val url: String) : Inline
    data object Break : Inline
}

object Markdown {
    private val FENCE = Regex("""^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*).*$""")
    private val HEADING = Regex("""^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$""")
    private val RULE = Regex("""^ {0,3}([-*_])(\s*\1){2,}\s*$""")
    private val LIST = Regex("""^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$""")
    private val TABLE_SEP = Regex("""^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$""")
    private val TASK = Regex("""^\[([ xX])]\s+(.*)$""", RegexOption.DOT_MATCHES_ALL)

    fun parse(text: String): List<MdBlock> = blocks(text.replace("\r\n", "\n").replace('\t', ' ').split('\n'))

    private fun blocks(lines: List<String>): List<MdBlock> {
        val out = mutableListOf<MdBlock>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            if (line.isBlank()) { i++; continue }
            FENCE.matchEntire(line)?.let { m ->
                val fence = m.groupValues[1]
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith(fence)) body += lines[i++]
                i++ // the closing fence (or the end)
                out += MdBlock.Code(m.groupValues[2], body.joinToString("\n"))
                return@let
            }?.let { continue }
            HEADING.matchEntire(line)?.let { m ->
                out += MdBlock.Heading(m.groupValues[1].length, inlines(m.groupValues[2]))
                i++
            }?.let { continue }
            if (RULE.matches(line)) { out += MdBlock.Rule; i++; continue }
            if (line.trimStart().startsWith(">")) {
                val body = mutableListOf<String>()
                while (i < lines.size && lines[i].isNotBlank() && (lines[i].trimStart().startsWith(">") || body.isNotEmpty() && !startsBlock(lines[i]))) {
                    body += lines[i].trimStart().removePrefix(">").removePrefix(" ")
                    i++
                }
                out += MdBlock.Quote(blocks(body))
                continue
            }
            if (line.contains('|') && i + 1 < lines.size && TABLE_SEP.matches(lines[i + 1]) && lines[i + 1].contains('-')) {
                val header = cells(line)
                val align = cells(lines[i + 1]).map { c -> val t = c.trim(); when { t.startsWith(":") && t.endsWith(":") -> 'c'; t.endsWith(":") -> 'r'; else -> 'l' } }
                i += 2
                val rows = mutableListOf<List<List<Inline>>>()
                while (i < lines.size && lines[i].isNotBlank() && lines[i].contains('|')) {
                    rows += cells(lines[i]).map(::inlines)
                    i++
                }
                out += MdBlock.Table(header.map(::inlines), align, rows)
                continue
            }
            LIST.matchEntire(line)?.let {
                val (block, next) = list(lines, i)
                out += block
                i = next
            }?.let { continue }
            // a paragraph: lines until a blank or the start of another block
            val para = mutableListOf(line.trim())
            i++
            while (i < lines.size && lines[i].isNotBlank() && !startsBlock(lines[i])) para += lines[i++].trim()
            out += MdBlock.Paragraph(paragraphInlines(para))
        }
        return out
    }

    private fun startsBlock(l: String) = FENCE.matches(l) || HEADING.matches(l) || RULE.matches(l) || l.trimStart().startsWith(">") || LIST.matches(l)

    private fun list(lines: List<String>, from: Int): Pair<MdBlock, Int> {
        val first = LIST.matchEntire(lines[from])!!
        val indent = first.groupValues[1].length
        val ordered = first.groupValues[2].first().isDigit()
        val start = if (ordered) first.groupValues[2].dropLast(1).toIntOrNull() ?: 1 else 1
        val items = mutableListOf<ListItem>()
        var i = from
        while (i < lines.size) {
            val m = LIST.matchEntire(lines[i]) ?: break
            if (m.groupValues[1].length != indent || m.groupValues[2].first().isDigit() != ordered) break
            val contentIndent = m.groupValues[1].length + m.groupValues[2].length + 1
            val body = mutableListOf(m.groupValues[3])
            i++
            while (i < lines.size) {
                val l = lines[i]
                if (l.isBlank()) {
                    // a blank line continues the item only if indented text follows
                    val nextLine = lines.getOrNull(i + 1)
                    if (nextLine != null && nextLine.isNotBlank() && leading(nextLine) > indent) { body += ""; i++; continue }
                    break
                }
                val lm = LIST.matchEntire(l)
                if (lm != null && lm.groupValues[1].length <= indent) break
                if (lm == null && leading(l) <= indent && startsBlock(l)) break
                body += if (leading(l) >= contentIndent) l.substring(contentIndent) else l.trimStart()
                i++
            }
            val task = TASK.matchEntire(body[0])
            val checked = task?.groupValues?.get(1)?.let { it != " " }
            if (task != null) body[0] = task.groupValues[2]
            items += ListItem(blocks(body), checked)
            // a blank line between items keeps the list going
            if (i < lines.size && lines[i].isBlank()) {
                val n = lines.getOrNull(i + 1)
                val nm = n?.let { LIST.matchEntire(it) }
                if (nm != null && nm.groupValues[1].length == indent) i++
            }
        }
        return MdBlock.ListBlock(ordered, start, items) to i
    }

    private fun leading(l: String) = l.length - l.trimStart().length

    private fun cells(line: String): List<String> {
        var t = line.trim()
        if (t.startsWith("|")) t = t.substring(1)
        if (t.endsWith("|") && !t.endsWith("\\|")) t = t.dropLast(1)
        val out = mutableListOf<String>()
        val cur = StringBuilder()
        var code = false
        var k = 0
        while (k < t.length) {
            val c = t[k]
            when {
                c == '\\' && k + 1 < t.length && t[k + 1] == '|' -> { cur.append('|'); k++ }
                c == '`' -> { code = !code; cur.append(c) }
                c == '|' && !code -> { out += cur.toString().trim(); cur.clear() }
                else -> cur.append(c)
            }
            k++
        }
        out += cur.toString().trim()
        return out
    }

    private fun paragraphInlines(lines: List<String>): List<Inline> {
        val out = mutableListOf<Inline>()
        lines.forEachIndexed { n, raw ->
            val hard = raw.endsWith("\\")
            val l = if (hard) raw.dropLast(1) else raw
            out += inlines(l)
            if (n < lines.lastIndex) out += if (hard) Inline.Break else Inline.Text(" ")
        }
        return merge(out)
    }

    /** Inline marks of one stretch of text. */
    fun inlines(s: String): List<Inline> {
        val out = mutableListOf<Inline>()
        val text = StringBuilder()
        fun flush() { if (text.isNotEmpty()) { out += Inline.Text(text.toString()); text.clear() } }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length && s[i + 1] in "\\`*_{}[]()#+-.!|~<>") { text.append(s[i + 1]); i += 2; continue }
            if (c == '`') {
                var ticks = 0
                while (i + ticks < s.length && s[i + ticks] == '`') ticks++
                val fence = "`".repeat(ticks)
                val end = s.indexOf(fence, i + ticks)
                if (end > 0) {
                    flush()
                    out += Inline.Code(s.substring(i + ticks, end).let { if (it.length > 2 && it.startsWith(" ") && it.endsWith(" ")) it.substring(1, it.length - 1) else it })
                    i = end + ticks
                    continue
                }
                text.append(fence); i += ticks; continue
            }
            if (c == '[') {
                val close = matching(s, i, '[', ']')
                if (close > 0 && close + 1 < s.length && s[close + 1] == '(') {
                    val pe = matching(s, close + 1, '(', ')')
                    if (pe > 0) {
                        flush()
                        val target = s.substring(close + 2, pe).trim().split(Regex("\\s+"), limit = 2)[0].removePrefix("<").removeSuffix(">")
                        out += Inline.Link(inlines(s.substring(i + 1, close)), target)
                        i = pe + 1
                        continue
                    }
                }
            }
            if (c == '<') {
                val end = s.indexOf('>', i)
                val inner = if (end > 0) s.substring(i + 1, end) else ""
                if (inner.startsWith("http://") || inner.startsWith("https://")) {
                    flush(); out += Inline.Link(listOf(Inline.Text(inner)), inner); i = end + 1; continue
                }
            }
            if ((c == 'h') && (s.startsWith("https://", i) || s.startsWith("http://", i)) && (i == 0 || !s[i - 1].isLetterOrDigit())) {
                var end = i
                while (end < s.length && !s[end].isWhitespace() && s[end] != '<' && s[end] != ')') end++
                while (end > i && s[end - 1] in ".,;:!?\"'") end--
                flush()
                val url = s.substring(i, end)
                out += Inline.Link(listOf(Inline.Text(url)), url)
                i = end
                continue
            }
            if (c == '~' && s.startsWith("~~", i)) {
                val end = s.indexOf("~~", i + 2)
                if (end > i + 2) { flush(); out += Inline.Strike(inlines(s.substring(i + 2, end))); i = end + 2; continue }
            }
            if (c == '*' || c == '_') {
                val double = i + 1 < s.length && s[i + 1] == c
                val d = if (double) "$c$c" else "$c"
                val openOk = i + d.length < s.length && !s[i + d.length].isWhitespace() &&
                    (c == '*' || i == 0 || !s[i - 1].isLetterOrDigit())
                if (openOk) {
                    val end = closing(s, i + d.length, d, c)
                    if (end > 0) {
                        flush()
                        val inner = inlines(s.substring(i + d.length, end))
                        out += if (double) Inline.Bold(inner) else Inline.Italic(inner)
                        i = end + d.length
                        continue
                    }
                }
            }
            text.append(c)
            i++
        }
        flush()
        return merge(out)
    }

    private fun closing(s: String, from: Int, d: String, c: Char): Int {
        var k = from
        while (true) {
            val e = s.indexOf(d, k)
            if (e < 0) return -1
            val afterOk = c == '*' || e + d.length >= s.length || !s[e + d.length].isLetterOrDigit()
            val single = d.length == 1 && e + 1 < s.length && s[e + 1] == c
            if (e > from && !s[e - 1].isWhitespace() && afterOk && !single) return e
            k = e + if (single) 2 else 1
        }
    }

    private fun matching(s: String, at: Int, open: Char, close: Char): Int {
        var depth = 0
        var k = at
        while (k < s.length) {
            when (s[k]) {
                '\\' -> k++
                open -> depth++
                close -> { depth--; if (depth == 0) return k }
            }
            k++
        }
        return -1
    }

    private fun merge(list: List<Inline>): List<Inline> {
        val out = mutableListOf<Inline>()
        for (x in list) {
            val last = out.lastOrNull()
            if (x is Inline.Text && last is Inline.Text) out[out.size - 1] = Inline.Text(last.text + x.text) else out += x
        }
        return out
    }

    /** The text without marks, for copying and for accessibility. */
    fun plain(inl: List<Inline>): String = buildString {
        for (x in inl) when (x) {
            is Inline.Text -> append(x.text)
            is Inline.Code -> append(x.code)
            is Inline.Bold -> append(plain(x.children))
            is Inline.Italic -> append(plain(x.children))
            is Inline.Strike -> append(plain(x.children))
            is Inline.Link -> append(plain(x.children))
            Inline.Break -> append('\n')
        }
    }
}
