package com.sercatdar.tgbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Держит соединение с Telegram (через TdSession) и HTTP-сервер (через BridgeHttpServer)
 * живыми, пока включён телефон, независимо от того, открыт ли экран приложения.
 */
class BridgeService : Service() {

	companion object {
		const val CHANNEL_ID = "tgbridge_running"
		const val NOTIF_ID = 1
		const val PREFS = "tgbridge"

		// последнее известное состояние авторизации — читает MainActivity, чтобы
		// нарисовать нужный экран (номер / код / пароль / готово), не дублируя сессию
		var lastAuthState: String = "starting"
		var lastError: String? = null

		// ссылка на живую TdSession, чтобы MainActivity могла отправить туда номер/код/пароль,
		// не запуская вторую параллельную сессию TDLib
		var activeSession: TdSession? = null
	}

	private lateinit var prefs: SharedPreferences
	private lateinit var session: TdSession
	private var httpServer: BridgeHttpServer? = null
	private val scope = CoroutineScope(Dispatchers.IO + Job())

	override fun onCreate() {
		super.onCreate()
		prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
		createChannel()
		startForeground(NOTIF_ID, buildNotification("Запуск..."))

		session = TdSession(applicationContext, prefs) { state ->
			lastAuthState = state
			updateNotification()
		}
		activeSession = session
		session.start(scope)

		val token = prefs.getString("token", null)
		if (token.isNullOrBlank()) {
			lastError = "Токен не задан — открой приложение и введи его"
		} else {
			httpServer = BridgeHttpServer(8787, token, session)
			try {
				httpServer?.start()
			} catch (e: Exception) {
				lastError = "Не удалось поднять сервер на 8787: ${e.message}"
			}
		}
	}

	override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
		// перечитываем токен на случай, если его только что сохранили в настройках,
		// и (пере)поднимаем HTTP-сервер, если он ещё не запущен
		val token = prefs.getString("token", null)
		if (!token.isNullOrBlank() && httpServer == null) {
			httpServer = BridgeHttpServer(8787, token, session)
			try {
				httpServer?.start()
				lastError = null
			} catch (e: Exception) {
				lastError = "Не удалось поднять сервер на 8787: ${e.message}"
			}
		}
		return START_STICKY
	}

	override fun onDestroy() {
		httpServer?.stop()
		session.close()
		activeSession = null
		super.onDestroy()
	}

	override fun onBind(intent: Intent?): IBinder? = null

	private fun createChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			val channel = NotificationChannel(
				CHANNEL_ID, "TG Bridge",
				NotificationManager.IMPORTANCE_LOW
			)
			channel.description = "Держит соединение с Telegram для часов"
			val manager = getSystemService(NotificationManager::class.java)
			manager.createNotificationChannel(channel)
		}
	}

	private fun buildNotification(text: String): Notification {
		return NotificationCompat.Builder(this, CHANNEL_ID)
			.setContentTitle("TG Bridge")
			.setContentText(text)
			.setSmallIcon(android.R.drawable.stat_notify_sync)
			.setOngoing(true)
			.setPriority(NotificationCompat.PRIORITY_LOW)
			.build()
	}

	private fun updateNotification() {
		val text = when (lastAuthState) {
			"ready" -> "Подключено · порт 8787"
			"wait_phone" -> "Нужен номер телефона — открой приложение"
			"wait_code" -> "Нужен код подтверждения — открой приложение"
			"wait_password" -> "Нужен пароль (2FA) — открой приложение"
			"closed" -> "Отключено"
			else -> "Подключение..."
		}
		val manager = getSystemService(NotificationManager::class.java)
		manager.notify(NOTIF_ID, buildNotification(text))
	}
}
