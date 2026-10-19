package com.sercatdar.tgbridge

import android.content.Context
import android.content.SharedPreferences
import io.github.tdlibandroid.ktx.TdClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.drinkless.tdlib.TdApi
import org.json.JSONArray
import org.json.JSONObject

// маленький кольцевой лог, читаемый прямо с экрана приложения — без него на телефоне
// без включённого adb невозможно увидеть, где именно виснет вызов к TDLib
object DiagLog {
	private val lines = java.util.Collections.synchronizedList(mutableListOf<String>())
	fun add(line: String) {
		val stamped = java.text.SimpleDateFormat("HH:mm:ss.SSS").format(java.util.Date()) + " " + line
		lines.add(stamped)
		if (lines.size > 200) lines.removeAt(0)
	}
	fun dump(): String = lines.joinToString("\n")
	fun clear() = lines.clear()
}

/**
 * Единственная точка входа в TDLib для всего приложения. Переживает открытие/закрытие
 * MainActivity — реально живёт внутри BridgeService, пока тот не остановлен.
 */
class TdSession(
	context: Context,
	private val prefs: SharedPreferences,
	private val onAuthState: (String) -> Unit
) {
	private val client: TdClient
	private var ready = false
	@Volatile private var lastFolders: Array<TdApi.ChatFolderInfo> = emptyArray()

	// TDLib отдаёт из GetChats только список id "для информации" — сами объекты Chat
	// нужно копить самому из потока обновлений (так документирует сам TdApi.GetChats).
	// UpdateNewChat присылает объект один раз, дальше TDLib мутирует его же поля
	// напрямую при UpdateChatLastMessage/UpdateChatReadInbox и т.п. — поэтому здесь
	// достаточно держать карту ссылок, а не переписывать их вручную по каждому апдейту.
	private val chatCache = java.util.concurrent.ConcurrentHashMap<Long, TdApi.Chat>()
	// TDLib присылает позиции чата в списках ОТДЕЛЬНЫМ потоком обновлений (UpdateChatPosition),
	// а не сразу внутри Chat.positions при UpdateNewChat — тот на практике часто приходит пустым.
	// Ключ — "main" или "folder:<id>"/"archive", значение — карта chatId -> ChatPosition.
	private val positionsCache = java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.ConcurrentHashMap<Long, TdApi.ChatPosition>>()
	// supergroupId -> isForum; наполняется из UpdateSupergroup, а если апдейт ещё не пришёл —
	// добирается через GetSupergroup. chat.viewAsTopics для этого не годится: он отражает лишь
	// режим отображения у пользователя, а не то, что в группе включены темы.
	private val forumCache = java.util.concurrent.ConcurrentHashMap<Long, Boolean>()
	// входящие сообщения для будильника на часах: растущий номер seq + последние 50 штук.
	// Часы раз в 30 с спрашивают /alerts?after=<seq> и получают только то, что пришло после.
	private class Alert(val seq: Long, val json: JSONObject)
	private val alertSeq = java.util.concurrent.atomic.AtomicLong(0)
	private val alerts = java.util.concurrent.ConcurrentLinkedDeque<Alert>()
	@Volatile private var lastDiag: String? = null

	private fun listKey(list: TdApi.ChatList): String = when (list) {
		is TdApi.ChatListMain -> "main"
		is TdApi.ChatListArchive -> "archive"
		is TdApi.ChatListFolder -> "folder:${list.chatFolderId}"
		else -> "other"
	}

	// заполняются из настроек приложения при первом запуске (экран логина);
	// без них TDLib не сможет даже начать авторизацию
	private val apiId: Int get() = prefs.getInt("api_id", 0)
	private val apiHash: String get() = prefs.getString("api_hash", "") ?: ""

	init {
		System.loadLibrary("tdjni")
		val filesDir = context.filesDir.absolutePath + "/tdlib"
		client = TdClient(filesDir = filesDir, verbosityLevel = 4, apiId = apiId, apiHash = apiHash)
	}

	fun start(scope: CoroutineScope) {
		DiagLog.add("start(): вызываю client.init()")
		client.init()
		DiagLog.add("start(): client.init() вернулся, подписываюсь на updates")
		scope.launch {
			var updateCount = 0
			client.updates.collect { update ->
				updateCount++
				if (updateCount <= 20 || updateCount % 50 == 0) {
					DiagLog.add("update #$updateCount: ${update.javaClass.simpleName}")
				}
				when (update) {
					is TdApi.UpdateAuthorizationState -> handleAuthState(update.authorizationState)
					is TdApi.UpdateChatFolders -> lastFolders = update.chatFolders
					is TdApi.UpdateSupergroup -> forumCache[update.supergroup.id] = update.supergroup.isForum
					is TdApi.UpdateNewMessage -> recordAlert(update.message)
					is TdApi.UpdateNewChat -> {
						chatCache[update.chat.id] = update.chat
						update.chat.positions.forEach { pos -> recordPosition(update.chat.id, pos) }
						DiagLog.add("UpdateNewChat: ${update.chat.id} '${update.chat.title}', позиций сразу: ${update.chat.positions.size}, всего в кэше: ${chatCache.size}")
					}
					is TdApi.UpdateChatPosition -> {
						recordPosition(update.chatId, update.position)
					}
					else -> {}
				}
			}
		}
	}

	// запрашивает у TDLib подгрузку чатов конкретного списка; результат приходит
	// не в ответе на этот вызов, а через уже запущенный поток UpdateNewChat/UpdateChatPosition
	private suspend fun ensureChatsLoaded(chatList: TdApi.ChatList, limit: Int) {
		try {
			kotlinx.coroutines.withTimeout(4000) {
				client.send(TdApi.LoadChats(chatList, limit))
			}
		} catch (e: kotlinx.coroutines.TimeoutCancellationException) {
			DiagLog.add("ensureChatsLoaded(${listKey(chatList)}): LoadChats завис по таймауту 4с")
			lastDiag = "LoadChats завис дольше 4с (сам вызов к TDLib не ответил)"
		} catch (e: Exception) {
			// "Not Found" здесь означает "все чаты этого списка уже загружены" — это
			// нормальный и частый исход (особенно при десятках папок), не логируем как шум
		}
	}

	private suspend fun recordAlert(msg: TdApi.Message) {
		if (msg.isOutgoing) return
		val chat = chatCache[msg.chatId] ?: return
		// заглушённые чаты не будят часы — так же, как не шумят в самом Telegram
		if ((chat.notificationSettings?.muteFor ?: 0) > 0) return
		val sender = msg.senderId
		val from = try {
			if (sender != null) cut(senderName(sender), 20) else ""
		} catch (e: Exception) {
			""
		}
		val topic = (msg.topicId as? TdApi.MessageTopicForum)?.forumTopicId ?: 0
		val seq = alertSeq.incrementAndGet()
		alerts.addLast(Alert(seq, JSONObject().apply {
			put("seq", seq)
			put("id", msg.id)
			put("chat", msg.chatId)
			put("topic", topic)
			put("name", cut(chat.title, 28))
			put("from", from)
			put("text", cut(messageText(msg), 160))
			put("date", msg.date)
			put("unread", chat.unreadCount)
		}))
		while (alerts.size > 50) alerts.pollFirst()
	}

	// after=0 — первый вопрос часов: отдаём только текущий номер как точку отсчёта,
	// чтобы они не получили залпом всё, что накопилось до включения будильника
	fun newAlerts(after: Long): JSONObject {
		val current = alertSeq.get()
		val items = JSONArray()
		if (after > 0) {
			alerts.filter { it.seq > after }.takeLast(5).forEach { items.put(it.json) }
		}
		return JSONObject().apply {
			put("ok", true)
			put("seq", current)
			put("items", items)
			// сколько всего новых, даже если в items влезли только последние 5
			put("count", if (after > 0) (current - after).coerceAtLeast(0) else 0)
		}
	}

	private fun recordPosition(chatId: Long, pos: TdApi.ChatPosition) {
		val key = listKey(pos.list)
		val map = positionsCache.getOrPut(key) { java.util.concurrent.ConcurrentHashMap() }
		if (pos.order == 0L) {
			// order=0 означает "чат покинул этот список" — TDLib шлёт это явно
			map.remove(chatId)
		} else {
			map[chatId] = pos
		}
	}

	// order=0 в TDLib означает "чат покинул этот список" — учитываем при обновлении позиций

	// сортировка как в самом Telegram: закреплённые сверху, дальше по убыванию order
	private suspend fun loadedChats(chatList: TdApi.ChatList, limit: Int): List<TdApi.Chat> {
		val key = listKey(chatList)
		fun snapshot(): List<TdApi.Chat> {
			val positions = positionsCache[key] ?: return emptyList()
			return positions.entries
				.sortedWith(compareByDescending<Map.Entry<Long, TdApi.ChatPosition>> { it.value.isPinned }
					.thenByDescending { it.value.order })
				.take(limit)
				.mapNotNull { chatCache[it.key] }
		}

		ensureChatsLoaded(chatList, limit)
		var result = snapshot()
		// LoadChats присылает результат через отдельные UpdateNewChat/UpdateChatPosition,
		// а не в самом ответе — сразу после логина первая полная синхронизация может занять
		// заметное время, поэтому ждём дольше и с более частыми проверками
		var attempts = 0
		while (result.isEmpty() && attempts < 15) {
			kotlinx.coroutines.delay(200)
			result = snapshot()
			attempts++
		}
		if (result.isEmpty() && chatCache.isNotEmpty()) {
			lastDiag = "кэш: ${chatCache.size} чатов, positionsCache[$key]: ${positionsCache[key]?.size ?: 0}; " +
				"известные ключи позиций: ${positionsCache.keys.joinToString()}"
		} else if (result.isEmpty()) {
			lastDiag = "кэш пуст (0 чатов) после ${attempts} попыток — UpdateNewChat не пришёл вообще"
		} else {
			lastDiag = null
		}
		return result
	}

	private fun handleAuthState(state: TdApi.AuthorizationState) {
		when (state) {
			is TdApi.AuthorizationStateWaitPhoneNumber -> onAuthState("wait_phone")
			is TdApi.AuthorizationStateWaitCode -> onAuthState("wait_code")
			is TdApi.AuthorizationStateWaitPassword -> onAuthState("wait_password")
			is TdApi.AuthorizationStateReady -> {
				ready = true
				onAuthState("ready")
			}
			is TdApi.AuthorizationStateClosed -> onAuthState("closed")
			else -> {}
		}
	}

	// --- вызовы из экрана логина (MainActivity) ------------------------------------

	suspend fun submitPhone(phone: String) {
		client.send(TdApi.SetAuthenticationPhoneNumber(phone, null))
	}

	suspend fun submitCode(code: String) {
		client.send(TdApi.CheckAuthenticationCode(code))
	}

	suspend fun submitPassword(password: String) {
		client.send(TdApi.CheckAuthenticationPassword(password))
	}

	// --- разбор сущностей в компактный JSON для часов -------------------------------

	private fun cut(s: String?, limit: Int): String {
		val t = (s ?: "").replace("\n", " ")
		return if (t.length > limit) t.substring(0, limit - 1) + "…" else t
	}

	private fun messageText(msg: TdApi.Message): String {
		return when (val c = msg.content) {
			is TdApi.MessageText -> c.text.text
			is TdApi.MessagePhoto -> c.caption.text.ifEmpty { "[фото]" }
			is TdApi.MessageVideo -> c.caption.text.ifEmpty { "[видео]" }
			is TdApi.MessageVoiceNote -> "[голосовое]"
			is TdApi.MessageSticker -> "[стикер]"
			is TdApi.MessageDocument -> c.caption.text.ifEmpty { "[файл]" }
			is TdApi.MessagePoll -> ""  // опрос сериализуется отдельным полем
			else -> "[медиа]"
		}
	}

	private suspend fun senderName(sender: TdApi.MessageSender): String {
		return when (sender) {
			is TdApi.MessageSenderUser -> {
				val user = client.send(TdApi.GetUser(sender.userId)) as? TdApi.User
				listOfNotNull(user?.firstName, user?.lastName).joinToString(" ").ifBlank { "?" }
			}
			is TdApi.MessageSenderChat -> {
				val chat = client.send(TdApi.GetChat(sender.chatId)) as? TdApi.Chat
				chat?.title ?: "?"
			}
			else -> "?"
		}
	}

	private fun pollJson(poll: TdApi.Poll): JSONObject {
		val opts = JSONArray()
		poll.options.forEachIndexed { i, o ->
			opts.put(JSONObject().apply {
				put("key", i.toString())
				put("text", cut(o.text.text, 40))
				put("voters", o.voterCount)
				put("chosen", o.isChosen)
			})
		}
		return JSONObject().apply {
			put("question", cut(poll.question.text, 80))
			put("closed", poll.isClosed)
			put("multiple", poll.allowsMultipleAnswers)
			put("total", poll.totalVoterCount)
			put("options", opts)
		}
	}

	private suspend fun messageJson(msg: TdApi.Message, textLimit: Int): JSONObject {
		val out = JSONObject()
		out.put("id", msg.id)
		out.put("out", msg.isOutgoing)
		out.put("date", msg.date)
		out.put("pinned", msg.isPinned)

		val sender = msg.senderId
		out.put("from", if (sender != null && !msg.isOutgoing) cut(senderName(sender), 20) else "")

		val content = msg.content
		if (content is TdApi.MessagePoll) {
			out.put("poll", pollJson(content.poll))
			out.put("text", "")
		} else {
			out.put("text", cut(messageText(msg), textLimit))
		}

		val reply = msg.replyTo
		// внутри темы TDLib указывает replyTo на первое сообщение темы — это не настоящий ответ
		val topic = msg.topicId
		val isTopicRoot = reply is TdApi.MessageReplyToMessage && topic is TdApi.MessageTopicForum &&
			(reply.messageId == topic.forumTopicId.toLong() || reply.messageId == (topic.forumTopicId.toLong() shl 20))
		if (reply is TdApi.MessageReplyToMessage && !isTopicRoot) {
			out.put("reply_id", reply.messageId)
			val quoteText = reply.quote?.text?.text
			if (!quoteText.isNullOrBlank()) out.put("reply_preview", cut(quoteText, 40))
		}
		return out
	}

	// --- публичные операции, вызываемые из HTTP-сервера -----------------------------

	suspend fun ping(): JSONObject = JSONObject().apply {
		put("ok", true)
		put("telegram_authorized", ready)
	}

	suspend fun folders(): JSONObject {
		val allChats = loadedChats(TdApi.ChatListMain(), 200)
		val allUnread = countUnread(allChats)

		val list = JSONArray()
		list.put(JSONObject().apply {
			put("id", 0)
			put("title", "Все чаты")
			put("unread", allUnread)
		})

		lastFolders.forEach { info ->
			val chats = loadedChats(TdApi.ChatListFolder(info.id), 200)
			list.put(JSONObject().apply {
				put("id", info.id)
				put("title", cut(info.name.text.text, 28))
				put("unread", countUnread(chats))
			})
		}
		return JSONObject().apply { put("ok", true); put("folders", list) }
	}

	private fun countUnread(chats: List<TdApi.Chat>): Int {
		return chats.count { chat ->
			val muted = chat.notificationSettings?.muteFor ?: 0
			chat.unreadCount > 0 && muted <= 0
		}
	}

	private suspend fun isForum(chat: TdApi.Chat): Boolean {
		val type = chat.type as? TdApi.ChatTypeSupergroup ?: return false
		if (type.isChannel) return false
		forumCache[type.supergroupId]?.let { return it }
		return try {
			val sg = kotlinx.coroutines.withTimeout(2000) {
				client.send(TdApi.GetSupergroup(type.supergroupId)) as TdApi.Supergroup
			}
			forumCache[sg.id] = sg.isForum
			sg.isForum
		} catch (e: Exception) {
			DiagLog.add("isForum(${chat.id}): GetSupergroup не удался: ${e.message}")
			chat.viewAsTopics
		}
	}

	suspend fun chats(folderId: Int, limit: Int): JSONObject {
		val chatList = if (folderId == 0) TdApi.ChatListMain() else TdApi.ChatListFolder(folderId)
		val chats = loadedChats(chatList, limit)
		val out = JSONArray()
		for (chat in chats) {
			out.put(JSONObject().apply {
				put("id", chat.id)
				put("name", cut(chat.title, 28))
				put("unread", chat.unreadCount)
				put("last", chat.lastMessage?.let { cut(messageText(it), 48) } ?: "")
				put("forum", isForum(chat))
			})
		}
		return JSONObject().apply {
			put("ok", true)
			put("chats", out)
			if (lastDiag != null) put("_diag", lastDiag)
		}
	}

	// гарантирует, что TDLib знает про конкретный чат, прежде чем идти за его историей/темами —
	// без этого GetChatHistory/GetForumTopics тоже падают с "Chat not found", если чат
	// ещё не был материализован в памяти клиента (тот же принцип, что и в loadedChats)
	private suspend fun ensureChatKnown(chatId: Long) {
		if (chatCache.containsKey(chatId)) return
		DiagLog.add("ensureChatKnown($chatId): чата нет в кэше, запрашиваю GetChat")
		try {
			client.send(TdApi.GetChat(chatId))
		} catch (e: Exception) {
			DiagLog.add("ensureChatKnown($chatId): GetChat ответил ошибкой: ${e.message}")
		}
		var attempts = 0
		while (!chatCache.containsKey(chatId) && attempts < 5) {
			kotlinx.coroutines.delay(200)
			attempts++
		}
		DiagLog.add("ensureChatKnown($chatId): итог после ${attempts} попыток — известен: ${chatCache.containsKey(chatId)}")
	}

	suspend fun topics(chatId: Long): JSONObject {
		DiagLog.add("topics($chatId): начало")
		ensureChatKnown(chatId)
		DiagLog.add("topics($chatId): чат известен = ${chatCache.containsKey(chatId)}, отправляю GetForumTopics")
		val res = try {
			client.send(TdApi.GetForumTopics(chatId, "", 0, 0, 0, 100)) as? TdApi.ForumTopics
		} catch (e: Exception) {
			DiagLog.add("topics($chatId): GetForumTopics бросил исключение: ${e.javaClass.simpleName}: ${e.message}")
			return JSONObject().apply { put("ok", false); put("error", e.message ?: "ошибка получения тем") }
		}
		if (res == null) {
			DiagLog.add("topics($chatId): GetForumTopics вернул не ForumTopics (isForum=false?)")
			return JSONObject().apply { put("ok", false); put("error", "в этом чате нет тем") }
		}
		DiagLog.add("topics($chatId): получено ${res.topics.size} тем")
		val out = JSONArray()
		res.topics.forEach { t ->
			out.put(JSONObject().apply {
				put("id", t.info.forumTopicId)
				put("title", cut(t.info.name, 28))
				put("unread", t.unreadCount)
				put("closed", t.info.isClosed)
			})
		}
		return JSONObject().apply { put("ok", true); put("topics", out) }
	}

	suspend fun messages(chatId: Long, topicId: Int, limit: Int, textLimit: Int, beforeId: Long = 0): JSONObject {
		ensureChatKnown(chatId)
		// с from_message_id TDLib отдаёт и само это сообщение — просим на одно больше и выкидываем его
		val ask = if (beforeId != 0L) limit + 1 else limit
		suspend fun fetch(): List<TdApi.Message>? {
			val res = if (topicId != 0) {
				client.send(TdApi.GetForumTopicHistory(chatId, topicId, beforeId, 0, ask))
			} else {
				client.send(TdApi.GetChatHistory(chatId, beforeId, 0, ask, false))
			}
			return (res as? TdApi.Messages)?.messages?.filter { beforeId == 0L || it.id < beforeId }
		}
		var batch = fetch() ?: return JSONObject().apply { put("ok", false); put("error", "не удалось получить историю") }
		if (beforeId != 0L && batch.isEmpty()) {
			// старую историю TDLib может сперва отдать пустой, пока подтягивает её с сервера
			kotlinx.coroutines.delay(500)
			batch = fetch() ?: batch
		}

		val items = batch.reversed().map { messageJson(it, textLimit) }
		if (topicId == 0 && beforeId == 0L) {
			client.send(TdApi.OpenChat(chatId))
		}
		return JSONObject().apply {
			put("ok", true)
			put("messages", JSONArray(items))
		}
	}

	suspend fun send(chatId: Long, topicId: Int, replyToId: Long, text: String): JSONObject {
		val content = TdApi.InputMessageText(TdApi.FormattedText(text, emptyArray()), null, false)
		val replyTo = if (replyToId != 0L) TdApi.InputMessageReplyToMessage(replyToId, null, 0, null) else null
		val messageTopic = if (topicId != 0) TdApi.MessageTopicForum(topicId) else null
		return try {
			val sent = client.send(TdApi.SendMessage(chatId, messageTopic, replyTo, null, null, content)) as TdApi.Message
			JSONObject().apply { put("ok", true); put("id", sent.id) }
		} catch (e: Exception) {
			JSONObject().apply { put("ok", false); put("error", e.message ?: "ошибка отправки") }
		}
	}

	suspend fun edit(chatId: Long, messageId: Long, text: String): JSONObject {
		val content = TdApi.InputMessageText(TdApi.FormattedText(text, emptyArray()), null, false)
		return try {
			client.send(TdApi.EditMessageText(chatId, messageId, null, content))
			JSONObject().apply { put("ok", true) }
		} catch (e: Exception) {
			JSONObject().apply { put("ok", false); put("error", e.message ?: "не удалось изменить") }
		}
	}

	suspend fun delete(chatId: Long, messageId: Long): JSONObject {
		return try {
			client.send(TdApi.DeleteMessages(chatId, longArrayOf(messageId), true))
			JSONObject().apply { put("ok", true) }
		} catch (e: Exception) {
			JSONObject().apply { put("ok", false); put("error", e.message ?: "не удалось удалить") }
		}
	}

	suspend fun pin(chatId: Long, messageId: Long, unpin: Boolean): JSONObject {
		return try {
			if (unpin) {
				client.send(TdApi.UnpinChatMessage(chatId, messageId))
			} else {
				client.send(TdApi.PinChatMessage(chatId, messageId, true, false))
			}
			JSONObject().apply { put("ok", true) }
		} catch (e: Exception) {
			JSONObject().apply { put("ok", false); put("error", e.message ?: "нет прав") }
		}
	}

	suspend fun vote(chatId: Long, messageId: Long, optionIndex: Int): JSONObject {
		return try {
			client.send(TdApi.SetPollAnswer(chatId, messageId, intArrayOf(optionIndex)))
			val msg = client.send(TdApi.GetMessage(chatId, messageId)) as? TdApi.Message
			val content = msg?.content
			val poll = if (content is TdApi.MessagePoll) pollJson(content.poll) else null
			JSONObject().apply { put("ok", true); put("poll", poll) }
		} catch (e: Exception) {
			JSONObject().apply { put("ok", false); put("error", e.message ?: "не удалось проголосовать") }
		}
	}

	fun close() {
		try {
			client.close()
		} catch (e: Exception) {
			// сервис в любом случае завершается
		}
	}
}
