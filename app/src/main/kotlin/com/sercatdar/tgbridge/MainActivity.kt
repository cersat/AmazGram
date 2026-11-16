package com.sercatdar.tgbridge

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Настройка api_id/api_hash/токена при первом запуске, дальше — статус подключения
 * и шаги входа в Telegram. Сама сессия живёт в BridgeService, экран можно закрывать.
 * Экран диагностики спрятан: семь нажатий на номер версии.
 */
class MainActivity : Activity() {

	private lateinit var prefs: SharedPreferences
	private lateinit var root: LinearLayout
	private lateinit var ui: Ui
	private val handler = Handler(Looper.getMainLooper())
	private var lastRenderedState: String? = null
	private var lastRenderedError: String? = null
	private var lastRenderedBattery: Boolean? = null
	private var versionTaps = 0

	private val poll = object : Runnable {
		override fun run() {
			// перерисовываем экран только когда что-то реально изменилось — иначе безусловный
			// render() сносит EditText прямо во время ввода и захлопывает клавиатуру
			if (BridgeService.lastAuthState != lastRenderedState ||
				BridgeService.lastError != lastRenderedError ||
				batteryIgnored() != lastRenderedBattery
			) {
				render()
			}
			handler.postDelayed(this, 1000)
		}
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		prefs = getSharedPreferences(BridgeService.PREFS, MODE_PRIVATE)
		ui = Ui(this)

		if (Build.VERSION.SDK_INT >= 33 &&
			checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
		) {
			ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
		}

		val scroll = ScrollView(this).apply {
			setBackgroundColor(Palette.bg)
			isFillViewport = true
		}
		root = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			setPadding(ui.dp(20), ui.dp(28), ui.dp(20), ui.dp(32))
		}
		scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
		setContentView(scroll)

		startService(Intent(this, BridgeService::class.java))
		render()
	}

	override fun onResume() {
		super.onResume()
		handler.post(poll)
	}

	override fun onPause() {
		handler.removeCallbacks(poll)
		super.onPause()
	}

	// --- экран в зависимости от того, чего сейчас не хватает ---------------------------

	private fun render() {
		lastRenderedState = BridgeService.lastAuthState
		lastRenderedError = BridgeService.lastError
		lastRenderedBattery = batteryIgnored()
		root.removeAllViews()

		header()

		val apiId = prefs.getInt("api_id", 0)
		val apiHash = prefs.getString("api_hash", "") ?: ""
		val token = prefs.getString("token", "") ?: ""

		when {
			apiId == 0 || apiHash.isBlank() -> stepKeys(apiId, apiHash)
			token.isBlank() -> stepToken()
			else -> stepLogin(token)
		}

		val err = BridgeService.lastError
		if (err != null) {
			val card = ui.card(root)
			ui.statusRow(card, Palette.error, "Ошибка", err)
		}
	}

	private fun header() {
		val row = LinearLayout(this).apply {
			orientation = LinearLayout.HORIZONTAL
			gravity = Gravity.BOTTOM
		}
		val title = TextView(this).apply {
			text = "TG Bridge"
			textSize = 28f
			setTextColor(Palette.text)
			typeface = android.graphics.Typeface.DEFAULT_BOLD
		}
		row.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
		val version = TextView(this).apply {
			text = "v" + versionName()
			textSize = 13f
			setTextColor(Palette.dim)
			setPadding(ui.dp(12), ui.dp(8), 0, ui.dp(4))
			setOnClickListener { onVersionTap() }
		}
		row.addView(version)
		root.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
			bottomMargin = ui.dp(20)
		})
	}

	private fun stepKeys(apiId: Int, apiHash: String) {
		val card = ui.card(root)
		ui.caption(card, "Шаг 1 из 3")
		ui.text(card, "Ключи Telegram", 20f, Palette.text, true)
		ui.text(card, "Получи api_id и api_hash на my.telegram.org, залогинившись своим номером, и вставь сюда.", 14f, Palette.dim)
		val idField = ui.field(card, "api_id (число)", if (apiId != 0) apiId.toString() else "", InputType.TYPE_CLASS_NUMBER)
		val hashField = ui.field(card, "api_hash", apiHash)
		ui.primary(card, "Сохранить") {
			val id = idField.text.toString().trim().toIntOrNull()
			if (id == null || hashField.text.isBlank()) {
				toast("api_id должен быть числом, api_hash не пустым")
				return@primary
			}
			prefs.edit().putInt("api_id", id).putString("api_hash", hashField.text.toString().trim()).apply()
			restartService()
			render()
		}
	}

	private fun stepToken() {
		val card = ui.card(root)
		ui.caption(card, "Шаг 2 из 3")
		ui.text(card, "Токен для часов", 20f, Palette.text, true)
		ui.text(card, "Часы показывают этот токен в заголовке каждого запроса, чтобы приложение знало, что запрос свой. Придумай длинный или сгенерируй случайный.", 14f, Palette.dim)
		val tokenField = ui.field(card, "токен")
		ui.secondary(card, "Сгенерировать случайный") { tokenField.setText(randomToken()) }
		ui.primary(card, "Сохранить токен") {
			if (tokenField.text.isBlank()) {
				toast("Токен не может быть пустым")
				return@primary
			}
			prefs.edit().putString("token", tokenField.text.toString().trim()).apply()
			restartService()
			render()
		}
	}

	private fun stepLogin(token: String) {
		when (BridgeService.lastAuthState) {
			"wait_phone" -> {
				val card = ui.card(root)
				ui.caption(card, "Шаг 3 из 3")
				ui.text(card, "Вход в Telegram", 20f, Palette.text, true)
				ui.text(card, "Номер телефона в международном формате:", 14f, Palette.dim)
				val phoneField = ui.field(card, "+995…", "", InputType.TYPE_CLASS_PHONE)
				ui.primary(card, "Отправить номер") {
					val phone = phoneField.text.toString().trim()
					if (phone.isBlank()) return@primary
					withSession { it.submitPhone(phone) }
				}
			}
			"wait_code" -> {
				val card = ui.card(root)
				ui.caption(card, "Шаг 3 из 3")
				ui.text(card, "Код из Telegram", 20f, Palette.text, true)
				val codeField = ui.field(card, "код", "", InputType.TYPE_CLASS_NUMBER)
				ui.primary(card, "Отправить код") {
					val code = codeField.text.toString().trim()
					if (code.isBlank()) return@primary
					withSession { it.submitCode(code) }
				}
			}
			"wait_password" -> {
				val card = ui.card(root)
				ui.caption(card, "Шаг 3 из 3")
				ui.text(card, "Пароль облачной авторизации", 20f, Palette.text, true)
				ui.text(card, "Пароль двухэтапной проверки (2FA):", 14f, Palette.dim)
				val pwField = ui.field(card, "пароль", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
				ui.primary(card, "Отправить пароль") {
					val pw = pwField.text.toString()
					if (pw.isBlank()) return@primary
					withSession { it.submitPassword(pw) }
				}
			}
			"ready" -> dashboard(token)
			"closed" -> {
				val card = ui.card(root)
				ui.statusRow(card, Palette.error, "Соединение закрыто", "Перезапусти приложение")
			}
			else -> {
				val card = ui.card(root)
				ui.statusRow(card, Palette.warn, "Подключение…", "Ждём ответа Telegram")
			}
		}
		if (BridgeService.lastAuthState != "ready") batteryCard()
	}

	private fun dashboard(token: String) {
		val status = ui.card(root)
		ui.statusRow(status, Palette.ok, "Подключено", "Сервер слушает 127.0.0.1:8787")

		val watch = ui.card(root)
		ui.text(watch, "Подключение часов", 17f, Palette.text, true)
		ui.text(watch, "Впиши адрес и токен в настройках TG Watch в приложении Zepp.", 13f, Palette.dim)
		ui.caption(watch, "Адрес")
		ui.text(watch, "http://127.0.0.1:8787", 16f)
		ui.secondary(watch, "Скопировать адрес") { copy("Адрес TG Bridge", "http://127.0.0.1:8787", "Адрес скопирован") }
		ui.caption(watch, "Токен").also { (it.layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(10) }
		ui.text(watch, "•••• " + token.takeLast(4), 16f)
		ui.primary(watch, "Скопировать токен") { copy("Токен TG Bridge", token, "Токен скопирован") }

		notifyCard()
		batteryCard()
	}

	// уведомления Android, которые Zepp показывает на часах
	private fun notifyCard() {
		val on = Notifier.isEnabled(prefs)
		val card = ui.card(root)
		ui.statusRow(
			card, if (on) Palette.ok else Palette.dim,
			if (on) "Уведомления на часы включены" else "Уведомления на часы выключены",
			"Новые сообщения придут обычным уведомлением, а Zepp перешлёт его на часы."
		)
		if (on) {
			ui.text(card, "Один раз включи в Zepp: Профиль → твои часы → Оповещения приложений → TG Bridge.", 13f, Palette.dim)
		}
		ui.secondary(card, if (on) "Выключить" else "Включить") {
			prefs.edit().putBoolean(Notifier.PREF_KEY, !on).apply()
			render()
		}
	}

	private fun batteryCard() {
		val card = ui.card(root)
		if (batteryIgnored()) {
			ui.statusRow(card, Palette.ok, "Работа в фоне разрешена", "Android не будет останавливать приложение")
			return
		}
		ui.statusRow(card, Palette.warn, "Android может остановить приложение", "Без исключения из экономии батареи часы перестанут получать ответы через несколько часов простоя.")
		ui.primary(card, "Разрешить работу в фоне") {
			try {
				val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
				intent.data = android.net.Uri.parse("package:$packageName")
				startActivity(intent)
			} catch (e: Exception) {
				toast("Открой настройки батареи вручную для TG Bridge")
			}
		}
	}

	// --- служебное --------------------------------------------------------------------

	private fun onVersionTap() {
		versionTaps += 1
		val left = 7 - versionTaps
		when {
			left <= 0 -> {
				versionTaps = 0
				startActivity(Intent(this, DiagActivity::class.java))
			}
			left <= 3 -> toast("До диагностики: $left")
		}
	}

	private fun batteryIgnored(): Boolean =
		getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

	private fun versionName(): String =
		try {
			packageManager.getPackageInfo(packageName, 0).versionName ?: ""
		} catch (e: Exception) {
			""
		}

	private fun restartService() {
		stopService(Intent(this, BridgeService::class.java))
		startService(Intent(this, BridgeService::class.java))
	}

	private fun withSession(action: suspend (TdSession) -> Unit) {
		// сессия физически живёт в BridgeService; чтобы не тащить лишний биндинг,
		// даём экрану ту же живую TdSession через статическую ссылку
		val session = BridgeService.activeSession ?: return
		CoroutineScope(Dispatchers.IO).launch {
			try {
				action(session)
			} catch (e: Exception) {
				BridgeService.lastError = e.message
			}
		}
	}

	private fun copy(label: String, text: String, done: String) {
		getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(label, text))
		toast(done)
	}

	private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

	private fun randomToken(): String {
		val chars = ('a'..'z') + ('A'..'Z') + ('0'..'9')
		return (1..48).map { chars.random() }.joinToString("")
	}
}
