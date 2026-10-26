package dev.elchi.orbit.core.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Lenient readers for Orbit's JSON. The server sends some rows straight from the
 * database (numbers for booleans, JSON in strings), so every reader accepts the
 * shapes it may meet and falls back instead of throwing.
 */
val OrbitJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
    encodeDefaults = true
}

fun JsonElement?.asObj(): JsonObject? = when (this) {
    is JsonObject -> this
    is JsonPrimitive -> if (isString) runCatching { OrbitJson.parseToJsonElement(content) as? JsonObject }.getOrNull() else null
    else -> null
}

fun JsonElement?.asArr(): JsonArray? = when (this) {
    is JsonArray -> this
    is JsonPrimitive -> if (isString) runCatching { OrbitJson.parseToJsonElement(content) as? JsonArray }.getOrNull() else null
    else -> null
}

fun JsonElement?.asStr(): String? = when (this) {
    null, JsonNull -> null
    is JsonPrimitive -> content
    else -> null
}

fun JsonElement?.asLong(): Long? = when (this) {
    is JsonPrimitive -> if (this is JsonNull) null else longOrNull ?: doubleOrNull?.toLong() ?: booleanOrNull?.let { if (it) 1L else 0L }
    else -> null
}

fun JsonElement?.asDouble(): Double? = when (this) {
    is JsonPrimitive -> if (this is JsonNull) null else doubleOrNull
    else -> null
}

fun JsonElement?.asBool(): Boolean? = when (this) {
    is JsonPrimitive -> if (this is JsonNull) null else booleanOrNull ?: longOrNull?.let { it != 0L } ?: doubleOrNull?.let { it != 0.0 }
    else -> null
}

fun JsonObject.str(k: String): String? = this[k].asStr()
fun JsonObject.long(k: String): Long? = this[k].asLong()
fun JsonObject.int(k: String): Int? = this[k].asLong()?.toInt()
fun JsonObject.dbl(k: String): Double? = this[k].asDouble()
fun JsonObject.bool(k: String): Boolean? = this[k].asBool()
fun JsonObject.obj(k: String): JsonObject? = this[k].asObj()
fun JsonObject.arr(k: String): JsonArray? = this[k].asArr()

/** `a` with every key of `b` laid over it, like `{...a, ...b}`. */
operator fun JsonObject.plus(b: JsonObject): JsonObject = JsonObject(LinkedHashMap<String, JsonElement>(this).apply { putAll(b) })

fun JsonObject.with(vararg pairs: Pair<String, Any?>): JsonObject {
    val m = LinkedHashMap<String, JsonElement>(this)
    for ((k, v) in pairs) m[k] = v.toJson()
    return JsonObject(m)
}

fun Any?.toJson(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is String -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is Map<*, *> -> JsonObject(entries.associate { (k, v) -> k.toString() to v.toJson() })
    is Iterable<*> -> JsonArray(map { it.toJson() })
    else -> JsonPrimitive(toString())
}

fun jsonOf(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(LinkedHashMap<String, JsonElement>().apply { for ((k, v) in pairs) put(k, v.toJson()) })

val JsonObjectOrEmpty: JsonObject = JsonObject(emptyMap())
