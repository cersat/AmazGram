package com.sercatdar.tgbridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Обычные уведомления Android о новых сообщениях. Приложение Zepp зеркалит их на часы
 * («Оповещения приложений»), а часы сами решают, как показать: плашкой поверх экрана,
 * если он горит, или с вибрацией, если погашен. Приложения на часах при этом не закрываются.
 */
class Notifier(private val context: Context, private val prefs: SharedPreferences) {

	companion object {
		const val CHANNEL_ID = "tgbridge_messages"
		const val PREF_KEY = "notify_watch"
		private const val ID_BASE = 1000
		private const val TELEGRAM_PACKAGE = "org.telegram.messenger"

		fun isEnabled(prefs: SharedPreferences): Boolean = prefs.getBoolean(PREF_KEY, true)
	}

	private val manager = context.getSystemService(NotificationManager::class.java)

	init {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			val channel = NotificationChannel(CHANNEL_ID, "Сообщения Telegram", NotificationManager.IMPORTANCE_HIGH)
			channel.description = "Новые сообщения, которые Zepp показывает на часах"
			manager.createNotificationChannel(channel)
		}
	}

	// один чат — одно уведомление: новое сообщение заменяет предыдущее и снова будит часы
	private fun idOf(chatId: Long): Int = ID_BASE + (chatId.hashCode() and 0x3fffffff)

	fun post(chatId: Long, title: String, from: String, text: String, unread: Int) {
		if (!isEnabled(prefs)) return
		val line = if (from.isNotBlank() && from != title) "$from: $text" else text
		val open = context.packageManager.getLaunchIntentForPackage(TELEGRAM_PACKAGE)
			?: Intent(context, MainActivity::class.java)
		val tap = PendingIntent.getActivity(
			context, idOf(chatId), open,
			PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
		)
		val builder = NotificationCompat.Builder(context, CHANNEL_ID)
			.setSmallIcon(android.R.drawable.stat_notify_chat)
			.setContentTitle(title)
			.setContentText(line)
			.setStyle(NotificationCompat.BigTextStyle().bigText(line))
			.setCategory(NotificationCompat.CATEGORY_MESSAGE)
			.setPriority(NotificationCompat.PRIORITY_HIGH)
			.setAutoCancel(true)
			.setContentIntent(tap)
			.setGroup("tgbridge_messages")
		if (unread > 1) builder.setNumber(unread)
		manager.notify(idOf(chatId), builder.build())
	}

	// сообщения прочитаны (в Telegram или на часах): плашка на телефоне и на часах больше не нужна
	fun clear(chatId: Long) {
		manager.cancel(idOf(chatId))
	}
}
