package com.sercatdar.tgbridge

import android.app.Activity
import android.content.SharedPreferences
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Скрытый экран диагностики: в интерфейсе на него нет ссылок, попасть можно только
 * семью нажатиями на номер версии. Запросы идут к собственному локальному серверу прямо
 * из приложения, в обход браузера, чтобы не упираться в mixed-content и content-провайдеры.
 */
class DiagActivity : Activity() {

	private lateinit var prefs: SharedPreferences
	private lateinit var out: TextView

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		prefs = getSharedPreferences(BridgeService.PREFS, MODE_PRIVATE)
		val ui = Ui(this)

		val scroll = ScrollView(this).apply { setBackgroundColor(Palette.bg) }
		val root = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			setPadding(ui.dp(20), ui.dp(28), ui.dp(20), ui.dp(32))
		}
		scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
		setContentView(scroll)

		ui.text(root, "Диагностика", 26f, Palette.text, true)

		val requests = ui.card(root)
		ui.caption(requests, "Запросы к серверу")
		val chatField = ui.field(requests, "chat id для /topics и /messages", "", InputType.TYPE_CLASS_TEXT)
		ui.secondary(requests, "GET /chats") { request("/chats?folder=0&limit=20") }
		ui.secondary(requests, "GET /topics") {
			val id = chatField.text.toString().trim()
			if (id.isNotBlank()) request("/topics?chat=$id")
		}
		ui.secondary(requests, "GET /messages") {
			val id = chatField.text.toString().trim()
			if (id.isNotBlank()) request("/messages?chat=$id&limit=5")
		}

		val journal = ui.card(root)
		ui.caption(journal, "Журнал")
		ui.secondary(journal, "Показать журнал") { out.text = DiagLog.dump().ifBlank { "Журнал пуст" } }
		ui.secondary(journal, "Очистить журнал") {
			DiagLog.clear()
			out.text = "Журнал очищен"
		}

		val result = ui.card(root)
		ui.caption(result, "Результат")
		out = ui.text(result, "Здесь появится ответ", 11f, Palette.text).apply {
			typeface = Typeface.MONOSPACE
			setTextIsSelectable(true)
		}
	}

	private fun request(path: String) {
		out.text = "Запрос $path …"
		val token = prefs.getString("token", "") ?: ""
		Thread {
			val result = try {
				val conn = java.net.URL("http://127.0.0.1:8787$path").openConnection() as java.net.HttpURLConnection
				conn.setRequestProperty("X-Auth-Token", token)
				conn.connectTimeout = 15000
				conn.readTimeout = 15000
				val code = conn.responseCode
				val stream = if (code in 200..299) conn.inputStream else conn.errorStream
				val text = stream?.bufferedReader()?.readText() ?: ""
				"HTTP $code\n\n" + compact(path, text)
			} catch (e: Exception) {
				"Ошибка запроса: ${e.javaClass.simpleName}: ${e.message}"
			}
			runOnUiThread { out.text = result }
		}.start()
	}

	// для /chats — компактно «id — название [темы]», чтобы список влезал в один скриншот
	private fun compact(path: String, raw: String): String {
		if (!path.startsWith("/chats")) return raw
		return try {
			val chats = org.json.JSONObject(raw).optJSONArray("chats") ?: return raw
			val sb = StringBuilder()
			for (i in 0 until chats.length()) {
				val c = chats.getJSONObject(i)
				sb.append(c.optLong("id")).append(" — ").append(c.optString("name"))
				if (c.optBoolean("forum")) sb.append(" [темы]")
				sb.append('\n')
			}
			sb.toString().ifBlank { raw }
		} catch (e: Exception) {
			raw
		}
	}
}
