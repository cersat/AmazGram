package com.sercatdar.tgbridge

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.content.SharedPreferences
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Простой View-based UI без сторонних UI-библиотек: настройка api_id/api_hash/токена
 * при первом запуске, дальше — статус подключения и, если нужно, шаги авторизации.
 * Сама сессия Telegram живёт в BridgeService, а не здесь — экран можно закрывать.
 */
class MainActivity : Activity() {

	private var diagOutput: TextView? = null
	private lateinit var prefs: SharedPreferences
	private lateinit var root: LinearLayout
	private val ui = Handler(Looper.getMainLooper())
	private var lastRenderedState: String? = null
	private var lastRenderedError: String? = null
	private val poll = object : Runnable {
		override fun run() {
			// перерисовываем экран только когда состояние авторизации или текст ошибки
			// реально изменились — иначе безусловный render() каждую секунду сносит
			// EditText прямо во время ввода и захлопывает только что открытую клавиатуру
			if (BridgeService.lastAuthState != lastRenderedState || BridgeService.lastError != lastRenderedError) {
				render()
			}
			ui.postDelayed(this, 1000)
		}
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		prefs = getSharedPreferences(BridgeService.PREFS, MODE_PRIVATE)

		if (Build.VERSION.SDK_INT >= 33 &&
			checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
		) {
			ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
		}

		val scroll = ScrollView(this)
		root = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			setPadding(48, 64, 48, 64)
		}
		scroll.addView(root)
		setContentView(scroll)

		startService(Intent(this, BridgeService::class.java))
		render()
	}

	override fun onResume() {
		super.onResume()
		ui.post(poll)
	}

	override fun onPause() {
		ui.removeCallbacks(poll)
		super.onPause()
	}

	// --- построение экрана в зависимости от того, чего сейчас не хватает -----------

	private fun render() {
		lastRenderedState = BridgeService.lastAuthState
		lastRenderedError = BridgeService.lastError
		root.removeAllViews()

		val apiId = prefs.getInt("api_id", 0)
		val apiHash = prefs.getString("api_hash", "") ?: ""
		val token = prefs.getString("token", "") ?: ""

		title("TG Bridge")

		if (apiId == 0 || apiHash.isBlank()) {
			text("Шаг 1 из 3 — получи api_id и api_hash на my.telegram.org, залогинившись своим номером, и вставь их сюда.")
			val idField = field("api_id (число)", if (apiId != 0) apiId.toString() else "")
			val hashField = field("api_hash", apiHash)
			button("Сохранить") {
				val id = idField.text.toString().trim().toIntOrNull()
				if (id == null || hashField.text.isBlank()) {
					text("api_id должен быть числом, api_hash не пустым").setTextColor(0xFFCC3333.toInt())
					return@button
				}
				prefs.edit().putInt("api_id", id).putString("api_hash", hashField.text.toString().trim()).apply()
				restartService()
				render()
			}
			return
		}

		if (token.isBlank()) {
			text("Шаг 2 из 3 — придумай длинный токен: часы будут показывать его в заголовке запроса, чтобы прокси знал, что это свой.")
			val tokenField = field("токен для часов", "")
			button("Сгенерировать случайный") {
				tokenField.setText(randomToken())
			}
			button("Сохранить токен") {
				if (tokenField.text.isBlank()) return@button
				prefs.edit().putString("token", tokenField.text.toString().trim()).apply()
				restartService()
				render()
			}
			return
		}

		text("Шаг 3 из 3 — вход в Telegram")
		when (BridgeService.lastAuthState) {
			"wait_phone" -> {
				text("Введи номер телефона в международном формате:")
				val phoneField = field("+995...", "")
				button("Отправить номер") {
					val phone = phoneField.text.toString().trim()
					if (phone.isBlank()) return@button
					withSession { it.submitPhone(phone) }
				}
			}
			"wait_code" -> {
				text("Введи код из Telegram:")
				val codeField = field("код", "")
				button("Отправить код") {
					val code = codeField.text.toString().trim()
					if (code.isBlank()) return@button
					withSession { it.submitCode(code) }
				}
			}
			"wait_password" -> {
				text("Введи пароль облачной авторизации (2FA):")
				val pwField = field("пароль", "")
				button("Отправить пароль") {
					val pw = pwField.text.toString()
					if (pw.isBlank()) return@button
					withSession { it.submitPassword(pw) }
				}
			}
			"ready" -> {
				status("Подключено. Сервер слушает 127.0.0.1:8787.", 0xFF2E7D32.toInt())
				text("Впиши в настройках часов (в Zepp) адрес http://127.0.0.1:8787 — впрочем, там по умолчанию нужен адрес именно этого телефона; для локального сервера подходит 127.0.0.1, если side-service работает в том же телефоне.")
				button("Скопировать токен") {
					copyToClipboard("Токен TG Bridge", token)
					status("Токен скопирован", 0xFF2E7D32.toInt())
				}
				spacer()
				text("Диагностика:")
				val diagChatField = field("chat id для /topics", "")
				button("GET /chats") { runDiag("/chats?folder=0&limit=20") }
				button("GET /topics для указанного chat id") {
					val id = diagChatField.text.toString().trim()
					if (id.isBlank()) return@button
					runDiag("/topics?chat=$id")
				}
				button("GET /messages для указанного chat id") {
					val id = diagChatField.text.toString().trim()
					if (id.isBlank()) return@button
					runDiag("/messages?chat=$id&limit=5")
				}
				button("Показать журнал (что реально происходит внутри)") {
					diagOutput?.text = DiagLog.dump().ifBlank { "Журнал пуст" }
				}
				button("Очистить журнал") {
					DiagLog.clear()
					diagOutput?.text = "Журнал очищен"
				}
				diagOutput = text("")
				diagOutput?.textSize = 11f
			}
			"closed" -> status("Соединение закрыто", 0xFFCC3333.toInt())
			else -> status("Подключение...", 0xFF888888.toInt())
		}

		spacer()
		button("Отключить оптимизацию батареи для приложения") {
			try {
				val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
				intent.data = android.net.Uri.parse("package:$packageName")
				startActivity(intent)
			} catch (e: Exception) {
				status("Открой настройки батареи вручную для TG Bridge", 0xFFCC3333.toInt())
			}
		}
		text("Без этого Android может убить приложение в фоне через несколько часов простоя, и часы перестанут получать ответ.")

		val err = BridgeService.lastError
		if (err != null) {
			spacer()
			status("Ошибка: $err", 0xFFCC3333.toInt())
		}
	}

	// --- служебное -------------------------------------------------------------------

	private fun restartService() {
		stopService(Intent(this, BridgeService::class.java))
		startService(Intent(this, BridgeService::class.java))
	}

	private fun withSession(action: suspend (TdSession) -> Unit) {
		// сессия физически живёт в BridgeService; чтобы не тащить лишний биндинг,
		// проще всего дать самому сервису этот же экземпляр через статическую ссылку
		val session = BridgeService.activeSession ?: return
		CoroutineScope(Dispatchers.IO).launch {
			try {
				action(session)
			} catch (e: Exception) {
				BridgeService.lastError = e.message
			}
		}
	}

	// --- маленький набор View-хелперов, чтобы не тащить XML-layout ------------------

	private fun title(s: String) {
		val tv = TextView(this)
		tv.text = s
		tv.textSize = 24f
		tv.setPadding(0, 0, 0, 32)
		root.addView(tv)
	}

	private fun text(s: String): TextView {
		val tv = TextView(this)
		tv.text = s
		tv.textSize = 15f
		tv.setPadding(0, 12, 0, 12)
		root.addView(tv)
		return tv
	}

	private fun status(s: String, color: Int): TextView {
		val tv = text(s)
		tv.setTextColor(color)
		tv.textSize = 17f
		return tv
	}

	private fun field(hint: String, initial: String): EditText {
		val et = EditText(this)
		et.hint = hint
		et.setText(initial)
		root.addView(et)
		return et
	}

	private fun button(label: String, onClick: () -> Unit) {
		val b = Button(this)
		b.text = label
		b.setOnClickListener { onClick() }
		root.addView(b)
	}

	private fun spacer() {
		val v = View(this)
		v.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 32)
		root.addView(v)
	}

	private fun copyToClipboard(label: String, text: String) {
		val clipboard = getSystemService(ClipboardManager::class.java)
		clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
	}

	private fun randomToken(): String {
		val chars = ('a'..'z') + ('A'..'Z') + ('0'..'9')
		return (1..48).map { chars.random() }.joinToString("")
	}

	// делает запрос к собственному локальному серверу прямо из приложения —
	// в обход браузера, чтобы не упираться в mixed-content/content-provider причуды Chrome
	private fun runDiag(path: String) {
		diagOutput?.text = "Запрос $path ..."
		val token = prefs.getString("token", "") ?: ""
		Thread {
			val result = try {
				val url = java.net.URL("http://127.0.0.1:8787$path")
				val conn = url.openConnection() as java.net.HttpURLConnection
				conn.setRequestProperty("X-Auth-Token", token)
				conn.connectTimeout = 15000
				conn.readTimeout = 15000
				val code = conn.responseCode
				val stream = if (code in 200..299) conn.inputStream else conn.errorStream
				val text = stream?.bufferedReader()?.readText() ?: ""
				"HTTP $code\n\n" + prettyForScreen(path, text)
			} catch (e: Exception) {
				"Ошибка запроса: ${e.javaClass.simpleName}: ${e.message}"
			}
			runOnUiThread { diagOutput?.text = result }
		}.start()
	}

	// для /chats выводим компактно «id — название (forum)», чтобы список влезал в один скриншот;
	// для остального — сырой ответ как есть
	private fun prettyForScreen(path: String, raw: String): String {
		if (!path.startsWith("/chats")) return raw
		return try {
			val obj = org.json.JSONObject(raw)
			val chats = obj.optJSONArray("chats") ?: return raw
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
