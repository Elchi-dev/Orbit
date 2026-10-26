package dev.elchi.orbit.ui.preview

import dev.elchi.orbit.core.model.Approval
import dev.elchi.orbit.core.model.Detail
import dev.elchi.orbit.core.model.Message
import dev.elchi.orbit.core.model.ServerInfo
import dev.elchi.orbit.core.model.ToolCall
import dev.elchi.orbit.core.model.Workspace
import dev.elchi.orbit.core.model.jsonOf
import dev.elchi.orbit.core.net.ConnState
import dev.elchi.orbit.core.net.Welcome
import dev.elchi.orbit.core.state.LiveStream
import dev.elchi.orbit.core.state.OrbitState
import dev.elchi.orbit.core.state.StreamBlock
import dev.elchi.orbit.data.AppSettings
import dev.elchi.orbit.data.Computer

/** Made-up data for previews and screenshot tests. */
object Samples {
    const val NOW = 1_792_000_000_000L
    private const val MIN = 60_000L

    fun ws(id: String, title: String, color: String, surface: String, rings: Boolean = false, tokens: Long = 20_000, running: Boolean = false, pending: Int = 0, ago: Long = 10 * MIN, extra: List<Pair<String, Any?>> = emptyList()) =
        Workspace.from(
            jsonOf(
                "id" to id, "title" to title, "cwd" to "/home/kim/orbit-workspaces/$id", "mode" to "manual", "profile" to "pair",
                "style" to jsonOf("color" to color, "surface" to surface, "rings" to rings),
                "stats" to jsonOf("tokens" to tokens, "cost" to tokens / 1e6),
                "running" to running, "pending" to pending, "updated_at" to NOW - ago, "created_at" to NOW - 3 * 86_400_000L, *extra.toTypedArray(),
            ),
        )

    val backups = ws(
        "w_backups", "Backups", "#E58C78", "rocky", rings = true, tokens = 180_000, pending = 1, ago = 2 * MIN,
        extra = listOf("plan" to listOf(jsonOf("text" to "Find the old snapshots", "status" to "done"), jsonOf("text" to "Remove the ones from 2025", "status" to "doing"), jsonOf("text" to "Check the disk again", "status" to "todo"))),
    )
    val site = ws(
        "w_site", "Landing page", "#7A64E0", "gas", tokens = 520_000, running = true, ago = MIN,
        extra = listOf("helpers" to listOf(jsonOf("id" to "w_h1", "title" to "Check the links", "agent" to "reviewer", "state" to "running", "running" to true, "created_at" to 1))),
    )
    val api = ws("w_api", "API tests", "#2BA3AB", "ocean", tokens = 64_000, ago = 50 * MIN)
    val notes = ws("w_notes", "Reading notes", "#C2547A", "ice", tokens = 9_000, ago = 26 * 60 * MIN)
    val taxes = ws("w_tax", "Taxes 2025", "#D9733A", "lava", rings = true, tokens = 1_200_000, ago = 4 * 86_400_000L)

    val approval = Approval.from(
        jsonOf(
            "id" to "toolu_1", "workspaceId" to "w_backups", "workspaceTitle" to "Backups", "name" to "bash",
            "input" to jsonOf("command" to "rm -rf ./old-snapshots/2025-*"), "subject" to "rm -rf ./old-snapshots/2025-*",
            "suggestion" to "rm -rf ./old-snapshots/*",
        ),
    )
    val editApproval = Approval.from(
        jsonOf(
            "id" to "toolu_2", "workspaceId" to "w_site", "workspaceTitle" to "Landing page", "name" to "edit_file",
            "input" to jsonOf("path" to "src/index.html", "old_string" to "<h1>Welcome</h1>", "new_string" to "<h1>Tidy, three things a day</h1>"),
            "subject" to "src/index.html", "suggestion" to "edit_file src/**",
            "judge" to jsonOf("verdict" to "ask", "reason" to "It changes the page's headline, which the task didn't mention."),
        ),
    )

    val server = ServerInfo.from(
        jsonOf(
            "version" to "0.5.0", "mock" to false, "hasKey" to true, "home" to "/home/kim",
            "today" to jsonOf("cost" to 1.24, "tokens" to 830_000),
            "profiles" to listOf(
                jsonOf("id" to "pair", "name" to "Pair", "description" to "Works with you step by step", "mode" to "manual", "effort" to "medium"),
                jsonOf("id" to "solo", "name" to "Solo", "description" to "Goes ahead on its own and reports back", "mode" to "auto", "effort" to "high", "web" to true),
            ),
            "config" to jsonOf("permissions" to jsonOf("default_mode" to "manual"), "workspaces" to jsonOf("default_profile" to "pair")),
        ),
    )

    private fun msg(id: String, role: String, at: Long, vararg blocks: Map<String, Any?>) =
        Message.from(jsonOf("id" to id, "role" to role, "created_at" to at, "content" to blocks.map { jsonOf(*it.entries.map { e -> e.key to e.value }.toTypedArray()) }))

    val detail = Detail(
        messages = listOf(
            msg("m1", "user", NOW - 6 * MIN, mapOf("type" to "text", "text" to "The disk is almost full. Clean out the old snapshots, but keep this year's.")),
            msg(
                "m2", "assistant", NOW - 5 * MIN,
                mapOf("type" to "thinking", "thinking" to "Look at what is in the snapshot folder first, then remove only last year's."),
                mapOf("type" to "text", "text" to "Let me see what's there first."),
                mapOf("type" to "tool_use", "id" to "t1", "name" to "bash", "input" to jsonOf("command" to "du -sh ./old-snapshots/*")),
            ),
            msg("m3", "user", NOW - 5 * MIN, mapOf("type" to "tool_result", "tool_use_id" to "t1", "content" to "12G 2025-01\n9.8G 2025-06\n4.1G 2026-03")),
            msg(
                "m4", "assistant", NOW - 4 * MIN,
                mapOf(
                    "type" to "text",
                    "text" to "Three snapshot folders, **26 GB** in all:\n\n| Folder | Size |\n| --- | ---: |\n| 2025-01 | 12 GB |\n| 2025-06 | 9.8 GB |\n| 2026-03 | 4.1 GB |\n\nThe two from 2025 can go. I'll keep `2026-03`, as you asked.",
                ),
                mapOf("type" to "tool_use", "id" to "t2", "name" to "bash", "input" to jsonOf("command" to "rm -rf ./old-snapshots/2025-*")),
            ),
        ),
        calls = listOf(
            ToolCall.from(jsonOf("id" to "t1", "workspace_id" to "w_backups", "name" to "bash", "input" to """{"command":"du -sh ./old-snapshots/*"}""", "status" to "done", "decided_by" to "readonly", "duration_ms" to 412, "output" to "12G\t./old-snapshots/2025-01\n9.8G\t./old-snapshots/2025-06\n4.1G\t./old-snapshots/2026-03")),
            ToolCall.from(jsonOf("id" to "t2", "workspace_id" to "w_backups", "name" to "bash", "input" to """{"command":"rm -rf ./old-snapshots/2025-*"}""", "status" to "pending")),
        ).associateBy { it.id },
    )

    val siteDetail = Detail(
        messages = listOf(
            msg("s1", "user", NOW - 3 * MIN, mapOf("type" to "text", "text" to "Make the landing page say what Tidy does in one line, and check every link.")),
            msg(
                "s2", "assistant", NOW - 2 * MIN,
                mapOf("type" to "text", "text" to "I'll rewrite the headline and have a helper check the links meanwhile."),
                mapOf("type" to "tool_use", "id" to "r1", "name" to "read_file", "input" to jsonOf("path" to "/home/kim/site/src/index.html")),
                mapOf("type" to "tool_use", "id" to "d1", "name" to "delegate", "input" to jsonOf("title" to "Check the links", "agent" to "reviewer")),
            ),
        ),
        calls = listOf(
            ToolCall.from(jsonOf("id" to "r1", "name" to "read_file", "input" to """{"path":"/home/kim/site/src/index.html"}""", "status" to "done", "decided_by" to "readonly", "duration_ms" to 8)),
            ToolCall.from(jsonOf("id" to "d1", "name" to "delegate", "input" to "{}", "status" to "running")),
        ).associateBy { it.id },
    )
    val siteStream = LiveStream("s", listOf(StreamBlock("text", "The new headline reads **Tidy: three things a day, not thirty.** Next I'll make the button")))

    val helper = ws("w_h1", "Check the links", "#9C8BF0", "gas", running = true, ago = MIN, extra = listOf("parent_id" to "w_site", "agent" to "reviewer", "call_id" to "d1", "helper_state" to "running"))

    val state = OrbitState(
        server = server,
        workspaces = listOf(backups, site, api, notes, taxes, helper).associateBy { it.id },
        details = mapOf(backups.id to detail, site.id to siteDetail),
        streams = mapOf(site.id to siteStream),
        approvals = listOf(approval),
        loaded = true,
    )

    val computer = Computer("YnIhRqycWT7TjW-bh7AH-H", "https://relay.example.com", "QZP1B_2LJKEp5HtsrDxwO3-TtL3YKeqAL0leRgq2ACM", "Kim's Mac mini", addedAt = NOW)
    val laptop = Computer("AbCdEfGhIjKlMnOpQrStUv", "https://relay.example.com", "QZP1B_2LJKEp5HtsrDxwO3-TtL3YKeqAL0leRgq2ACM", "kim-thinkpad", label = "Work laptop", addedAt = NOW)
    val online = ConnState.Online(Welcome("Kim's Mac mini", "0.5.0"))
    val settings = AppSettings(phoneName = "Pixel 9")
}
