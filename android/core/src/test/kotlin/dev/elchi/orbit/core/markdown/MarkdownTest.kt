package dev.elchi.orbit.core.markdown

import dev.elchi.orbit.core.markdown.Inline.Bold
import dev.elchi.orbit.core.markdown.Inline.Code
import dev.elchi.orbit.core.markdown.Inline.Italic
import dev.elchi.orbit.core.markdown.Inline.Link
import dev.elchi.orbit.core.markdown.Inline.Text
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownTest {
    @Test fun inlineMarks() {
        assertEquals(
            listOf(Text("Run "), Code("bun test"), Text(", then "), Bold(listOf(Text("check"))), Text(" the "), Italic(listOf(Text("logs"))), Text(".")),
            Markdown.inlines("Run `bun test`, then **check** the *logs*."),
        )
        assertEquals(listOf(Link(listOf(Text("docs")), "https://x.dev/a")), Markdown.inlines("[docs](https://x.dev/a \"title\")"))
        assertEquals(listOf(Text("snake_case_name stays")), Markdown.inlines("snake_case_name stays"))
        assertEquals(listOf(Text("2 * 3 * 4")), Markdown.inlines("2 * 3 * 4"))
        assertEquals(listOf(Text("see "), Link(listOf(Text("https://a.b/c")), "https://a.b/c"), Text(".")), Markdown.inlines("see https://a.b/c."))
        assertEquals(listOf(Text("*not italic*")), Markdown.inlines("\\*not italic\\*"))
    }

    @Test fun blocks() {
        val md = """
            # Plan

            Two steps:

            1. Build it
               with care
            2. Test it
               - unit
               - integration

            ```kotlin
            val x = 1
            ```

            > quoted **text**

            | Name | Size |
            | ---- | ---: |
            | a    | 1    |
            | b    | 2    |

            ---
            - [x] done
            - [ ] todo
        """.trimIndent()
        val b = Markdown.parse(md)
        assertEquals(MdBlock.Heading(1, listOf(Text("Plan"))), b[0])
        assertEquals(MdBlock.Paragraph(listOf(Text("Two steps:"))), b[1])
        val list = b[2] as MdBlock.ListBlock
        assertTrue(list.ordered)
        assertEquals(2, list.items.size)
        assertEquals(MdBlock.Paragraph(listOf(Text("Build it with care"))), list.items[0].blocks[0])
        val nested = list.items[1].blocks[1] as MdBlock.ListBlock
        assertEquals(2, nested.items.size)
        assertEquals(MdBlock.Code("kotlin", "val x = 1"), b[3])
        assertEquals(MdBlock.Quote(listOf(MdBlock.Paragraph(listOf(Text("quoted "), Bold(listOf(Text("text"))))))), b[4])
        val table = b[5] as MdBlock.Table
        assertEquals(2, table.rows.size)
        assertEquals(listOf('l', 'r'), table.align)
        assertEquals(MdBlock.Rule, b[6])
        val tasks = b[7] as MdBlock.ListBlock
        assertEquals(listOf(true, false), tasks.items.map { it.checked })
    }

    @Test fun unclosedFenceTakesTheRest() {
        val b = Markdown.parse("text\n```\ncode still streaming")
        assertEquals(MdBlock.Code("", "code still streaming"), b[1])
    }
}
