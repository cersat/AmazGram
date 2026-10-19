package com.sercatdar.tgbridge

import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

/**
 * Локальный HTTP-сервер на 127.0.0.1:8787 — те же эндпоинты, что раньше отдавал
 * server.py на малине. Слушает только localhost, наружу не торчит вообще.
 */
class BridgeHttpServer(
	port: Int,
	private val token: String,
	private val session: TdSession
) : NanoHTTPD("127.0.0.1", port) {

	// каждый запрос пишем в журнал приложения: метод, путь, параметры, статус, время и начало ответа
	override fun serve(s: IHTTPSession): Response {
		val started = System.currentTimeMillis()
		lastBody = ""
		val response = handle(s)
		val query = s.parms.entries.joinToString("&") { "${it.key}=${it.value}" }
		val took = System.currentTimeMillis() - started
		DiagLog.add("HTTP ${s.method} ${s.uri}${if (query.isNotEmpty()) "?$query" else ""} -> ${response.status.requestStatus} за ${took}мс: ${lastBody.take(160)}")
		return response
	}

	@Volatile private var lastBody: String = ""

	private fun handle(s: IHTTPSession): Response {
		if (s.uri != "/ping") {
			val header = s.headers["x-auth-token"]
			if (header != token) {
				return json(JSONObject().apply { put("ok", false); put("error", "unauthorized") }, Response.Status.UNAUTHORIZED)
			}
		}

		return try {
			runBlocking {
				kotlinx.coroutines.withTimeout(12000) {
					when (s.uri) {
					"/ping" -> json(session.ping())
					"/folders" -> json(session.folders())
					"/chats" -> {
						val p = s.parms
						json(session.chats((p["folder"] ?: "0").toInt(), (p["limit"] ?: "20").toInt()))
					}
					"/topics" -> {
						val p = s.parms
						json(session.topics((p["chat"] ?: "0").toLong()))
					}
					"/messages" -> {
						val p = s.parms
						json(session.messages(
							(p["chat"] ?: "0").toLong(),
							(p["topic"] ?: "0").toInt(),
							(p["limit"] ?: "15").toInt(),
							220
						))
					}
					"/send" -> {
						val b = body(s)
						json(session.send(
							b.optLong("chat"), b.optInt("topic"), b.optLong("reply_to"), b.optString("text")
						))
					}
					"/edit" -> {
						val b = body(s)
						json(session.edit(b.optLong("chat"), b.optLong("id"), b.optString("text")))
					}
					"/delete" -> {
						val b = body(s)
						json(session.delete(b.optLong("chat"), b.optLong("id")))
					}
					"/pin" -> {
						val b = body(s)
						json(session.pin(b.optLong("chat"), b.optLong("id"), b.optBoolean("unpin")))
					}
					"/vote" -> {
						val b = body(s)
						val options = b.optJSONArray("options")
						val idx = options?.optString(0)?.toIntOrNull() ?: 0
						json(session.vote(b.optLong("chat"), b.optLong("id"), idx))
					}
					else -> json(JSONObject().apply { put("ok", false); put("error", "not found") }, Response.Status.NOT_FOUND)
				}
			}
		}
		} catch (e: kotlinx.coroutines.TimeoutCancellationException) {
			json(JSONObject().apply { put("ok", false); put("error", "TDLib не ответил за 12с — похоже на зависший внутренний запрос") }, Response.Status.INTERNAL_ERROR)
		} catch (e: Exception) {
			json(JSONObject().apply { put("ok", false); put("error", e.message ?: "internal error") }, Response.Status.INTERNAL_ERROR)
		}
	}

	private fun body(s: IHTTPSession): JSONObject {
		val map = HashMap<String, String>()
		s.parseBody(map)
		val raw = map["postData"] ?: "{}"
		return JSONObject(raw)
	}

	private fun json(obj: JSONObject, status: Response.Status = Response.Status.OK): Response {
		val text = obj.toString()
		lastBody = text
		return newFixedLengthResponse(status, "application/json", text)
	}
}
