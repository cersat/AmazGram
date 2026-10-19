import { MessageBuilder } from '../shared/message'

const messageBuilder = new MessageBuilder()

const DEFAULT_URL = 'http://100.116.79.62:8787'
const DEFAULT_QUICK = 'Ок|Да|Нет|Сейчас не могу, напишу позже|Уже иду|Спасибо!'

function setting(key, def) {
	const v = settings.settingsStorage.getItem(key)
	return v ? String(v) : def
}

function short(s, n) {
	s = String(s || '')
	return s.length > n ? s.slice(0, n) : s
}

function shortPoll(p) {
	return {
		question: short(p.question, 80),
		closed: !!p.closed,
		multiple: !!p.multiple,
		total: p.total,
		options: (p.options || []).slice(0, 10).map((o) => ({
			key: o.key,
			text: short(o.text, 40),
			voters: o.voters,
			chosen: !!o.chosen
		}))
	}
}

async function api(path, method, body) {
	const base = setting('url', DEFAULT_URL).replace(/\/+$/, '')
	const token = setting('token', '')
	if (!token) {
		return { error: 'Не задан токен: Zepp > профиль > часы > приложения > TG Watch' }
	}
	let res
	try {
		const opts = {
			url: base + path,
			method: method || 'GET',
			headers: {
				'X-Auth-Token': token,
				'Content-Type': 'application/json'
			}
		}
		if (body) opts.body = JSON.stringify(body)
		res = await fetch(opts)
	} catch (e) {
		return { error: 'Нет связи с прокси. Tailscale на телефоне включён?' }
	}
	if (res.status === 401) {
		return { error: 'Токен не подошёл' }
	}
	let data
	try {
		data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
	} catch (e) {
		return { error: 'Кривой ответ прокси (HTTP ' + res.status + ')' }
	}
	if (!data || !data.ok) {
		return { error: (data && data.error) || 'HTTP ' + res.status }
	}
	return data
}

async function handle(method, params) {
	if (method === 'FOLDERS') {
		const r = await api('/folders')
		if (r.error) return r
		return {
			folders: r.folders.map((f) => ({
				id: f.id,
				title: short(f.title, 28),
				unread: f.unread
			}))
		}
	}
	if (method === 'CHATS') {
		const r = await api('/chats?limit=' + (params.limit || 20) + '&folder=' + (params.folder || 0))
		if (r.error) return r
		// часам много не надо — режем, чтобы не гонять лишнее по Bluetooth
		return {
			chats: r.chats.map((c) => ({
				id: c.id,
				name: short(c.name, 28),
				unread: c.unread,
				last: short(c.last, 48),
				forum: !!c.forum
			}))
		}
	}
	if (method === 'TOPICS') {
		const r = await api('/topics?chat=' + encodeURIComponent(params.chat))
		if (r.error) return r
		return {
			topics: r.topics.map((t) => ({
				id: t.id,
				title: short(t.title, 28),
				unread: t.unread,
				closed: !!t.closed
			}))
		}
	}
	if (method === 'MESSAGES') {
		let path = '/messages?chat=' + encodeURIComponent(params.chat) + '&limit=' + (params.limit || 15)
		if (params.topic) path += '&topic=' + encodeURIComponent(params.topic)
		const r = await api(path)
		if (r.error) return r
		return {
			messages: r.messages.map((m) => ({
				id: m.id,
				out: m.out,
				from: short(m.from, 20),
				text: short(m.text, 220),
				date: m.date,
				pinned: !!m.pinned,
				poll: m.poll ? shortPoll(m.poll) : null,
				replyId: m.reply_id || null,
				replyPreview: m.reply_preview ? short(m.reply_preview, 40) : null
			}))
		}
	}
	if (method === 'SEND') {
		const body = { chat: params.chat, text: params.text }
		if (params.topic) body.topic = params.topic
		if (params.replyTo) body.reply_to = params.replyTo
		return await api('/send', 'POST', body)
	}
	if (method === 'EDIT') {
		return await api('/edit', 'POST', { chat: params.chat, id: params.id, text: params.text })
	}
	if (method === 'DELETE') {
		return await api('/delete', 'POST', { chat: params.chat, id: params.id })
	}
	if (method === 'PIN') {
		return await api('/pin', 'POST', { chat: params.chat, id: params.id, unpin: !!params.unpin })
	}
	if (method === 'VOTE') {
		const r = await api('/vote', 'POST', { chat: params.chat, id: params.id, options: params.options })
		if (r.error) return r
		return { poll: r.poll ? shortPoll(r.poll) : null }
	}
	if (method === 'QUICK') {
		const items = setting('quick', DEFAULT_QUICK)
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean)
		return { items }
	}
	return { error: 'Неизвестный метод ' + method }
}

AppSideService({
	onInit() {
		messageBuilder.listen(() => {})
		messageBuilder.on('request', (ctx) => {
			const rpc = messageBuilder.buf2Json(ctx.request.payload)
			handle(rpc.method, rpc.params || {})
				.then((result) => ctx.response({ data: { result } }))
				.catch((e) => ctx.response({ data: { result: { error: String((e && e.message) || e) } } }))
		})
	},
	onRun() {},
	onDestroy() {}
})
