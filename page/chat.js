import { W, H, PAD, TOP, C, hideStatusBar, req, Layer, statusText, button, textHeight, hhmm } from '../utils/ui'

const BUBBLE_MAX = W - PAD * 2 - 36
const TEXT_SIZE = 23
const INNER = 12
const POLL_MS = 5000
const OPT_H = 44
const PAGE = 15 // сколько сообщений за один запрос
const MAX_LOADED = 75 // больше виджетов часы на API 1.0 не тянут — дальше история только в Telegram

Page({
	state: {
		chat: null,
		list: null,
		menu: null,
		messages: [],
		timer: null,
		busy: false,
		menuOpen: false,
		lastSeenChange: 0,
		tail: null,
		endY: 0,
		loadingOlder: false,
		noMore: false,
		swipes: 0
	},

	onInit(param) {
		try {
			this.state.chat = JSON.parse(param)
		} catch (e) {
			this.state.chat = null
		}
	},

	build() {
		hideStatusBar()
		const chat = this.state.chat
		const head = new Layer()
		this.state.list = new Layer()
		this.state.tail = new Layer()
		this.state.menu = new Layer()
		if (!chat) {
			statusText(this.state.list, 'Не передан чат', C.danger)
			return
		}

		head.add(hmUI.widget.TEXT, {
			x: PAD + 24,
			y: TOP - 10,
			w: W - PAD * 2 - 48,
			h: 40,
			color: C.text,
			text_size: 26,
			align_h: hmUI.align.CENTER_H,
			align_v: hmUI.align.CENTER_V,
			text_style: hmUI.text_style.ELLIPSIS,
			text: chat.name
		})

		const param = JSON.stringify(chat)
		const by = TOP + 36
		const refreshW = 90
		const writeW = W - PAD * 2 - refreshW - 8
		button(head, PAD, by, writeW, 50, 'Написать', () => hmApp.gotoPage({ url: 'page/compose', param }), C.accent, C.accentPress, 22)
		button(head, PAD + writeW + 8, by, refreshW, 50, 'Обн', () => this.load(true), C.card, C.cardPress, 22)

		this.state.lastSeenChange = getApp()._options.globalData.lastChatChange
		this.load(true)
		this.restartPolling()
		this.watchScroll()
	},

	// В API 1.0 нет чтения позиции прокрутки, поэтому ловим жесты: свайп вверх двигает
	// список вниз. Прикидываем, сколько пролистано, и подгружаем старые заранее; кнопка
	// "Старее" в конце списка остаётся надёжным запасным путём.
	watchScroll() {
		const g = getApp()._options.globalData
		// коллбэк жестов регистрируется один раз на всё приложение (повторная регистрация
		// по документации ломает его), а страница лишь подставляет свой обработчик
		g.onSwipe = (event) => {
			if (event === hmApp.gesture.UP) this.state.swipes += 1
			else if (event === hmApp.gesture.DOWN) this.state.swipes = Math.max(0, this.state.swipes - 1)
			else return
			if (this.state.swipes * H * 0.6 + H >= this.state.endY - 80) this.loadOlder()
		}
		if (g.gestureRegistered || typeof hmApp.registerGestureEvent !== 'function' || !hmApp.gesture) return
		g.gestureRegistered = true
		hmApp.registerGestureEvent((event) => {
			if (g.onSwipe) g.onSwipe(event)
			return false // жест не перехватываем — список скроллится как обычно
		})
	},

	onDestroy() {
		getApp()._options.globalData.onSwipe = null
		if (this.state.timer) clearInterval(this.state.timer)
		if (this.state.watchTimer) clearInterval(this.state.watchTimer)
	},

	// перезапускает интервал автообновления — вызывается и на старте, и сразу после
	// собственного действия (голос/ответ/пин/удаление), чтобы следующий тик не наступил
	// через долю секунды после уже свежих данных
	restartPolling() {
		if (this.state.timer) clearInterval(this.state.timer)
		this.state.timer = setInterval(() => this.load(false), POLL_MS)
		if (this.state.watchTimer) clearInterval(this.state.watchTimer)
		// раз в секунду проверяем метку "было своё действие на другом экране" —
		// если да, обновляемся сразу, не дожидаясь полного 5-секундного цикла
		this.state.watchTimer = setInterval(() => {
			const mark = getApp()._options.globalData.lastChatChange
			if (mark && mark !== this.state.lastSeenChange) {
				this.state.lastSeenChange = mark
				this.load(false)
			}
		}, 1000)
	},

	// мгновенное обновление по факту собственного действия, а не ожидание автотика
	refreshNow() {
		this.load(false)
		this.restartPolling()
	},

	load(showSpinner) {
		if (this.state.busy || this.state.menuOpen) return
		this.state.busy = true
		const list = this.state.list
		if (showSpinner) {
			list.clear()
			this.state.tail.clear()
			statusText(list, 'Загрузка...')
		}
		req('MESSAGES', { chat: this.state.chat.id, topic: this.state.chat.topicId, limit: PAGE })
			.then((r) => {
				this.state.busy = false
				const fresh = r.messages || []
				if (showSpinner) {
					// полное обновление — старые, уже подгруженные страницы начинаем с нуля
					this.state.noMore = false
					this.state.swipes = 0
				}
				// свежее окно заменяет только свой диапазон id, подгруженные ранее старые
				// сообщения остаются на месте
				const merged = showSpinner ? fresh : this.merge(fresh)
				// фоновый поллинг не трогает DOM, если список фактически не изменился —
				// перерисовка во время активного скролла иногда вешает часы на API 1.0
				const changed = showSpinner || this.signature(merged) !== this.signature(this.state.messages)
				this.state.messages = merged
				if (changed) this.render()
			})
			.catch((e) => {
				this.state.busy = false
				if (showSpinner) {
					list.clear()
					statusText(list, 'Ошибка:\n' + e.message, C.danger)
				}
				// тихий фоновый поллинг просто промолчит при временной ошибке сети
			})
	},

	// messages хранятся от старых к новым; fresh — свежее окно запроса
	merge(fresh) {
		const known = this.state.messages
		if (!known.length || !fresh.length) return fresh.length ? fresh : known
		const lo = fresh[0].id
		return known.filter((m) => m.id < lo).concat(fresh)
	},

	signature(messages) {
		return messages.map((m) => m.id + ':' + (m.poll ? JSON.stringify(m.poll) : '') + ':' + m.pinned).join(',')
	},

	render() {
		if (this.state.menuOpen) return
		const list = this.state.list
		list.clear()
		this.state.tail.clear()
		const messages = this.state.messages
		if (!messages.length) {
			statusText(list, 'Сообщений нет')
			return
		}
		// на часах удобнее свежее сверху — не надо листать вниз
		const items = messages.slice().reverse()
		let y = TOP + 100
		items.forEach((m) => {
			y = this.renderMessage(list, m, y)
		})
		this.state.endY = y
		this.renderTail()
	},

	// хвост списка: кнопка подгрузки старых (или пометка, что дальше пусто) и отступ снизу.
	// Хвост пересоздаётся отдельно от сообщений, поэтому подгрузка не перерисовывает список.
	renderTail() {
		const tail = this.state.tail
		tail.clear()
		let y = this.state.endY
		const loaded = this.state.messages.length
		if (this.state.noMore || loaded >= MAX_LOADED) {
			tail.add(hmUI.widget.TEXT, {
				x: PAD,
				y,
				w: W - PAD * 2,
				h: 30,
				color: C.dim,
				text_size: 18,
				align_h: hmUI.align.CENTER_H,
				align_v: hmUI.align.CENTER_V,
				text: this.state.noMore ? 'Это начало переписки' : 'Дальше — только в Telegram'
			})
			y += 38
		} else {
			button(tail, PAD, y, W - PAD * 2, 48, this.state.loadingOlder ? 'Загрузка...' : 'Старее', () => this.loadOlder(), C.card, C.cardPress, 21)
			y += 56
		}
		tail.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 70, color: C.bg })
	},

	// подгружает следующую страницу старых сообщений и дорисовывает её в конец списка
	loadOlder() {
		const st = this.state
		if (st.loadingOlder || st.noMore || st.busy || st.menuOpen || !st.messages.length) return
		if (st.messages.length >= MAX_LOADED) return
		st.loadingOlder = true
		const oldest = st.messages[0].id
		req('MESSAGES', { chat: st.chat.id, topic: st.chat.topicId, limit: PAGE, before: oldest })
			.then((r) => {
				st.loadingOlder = false
				const batch = (r.messages || []).filter((m) => m.id < oldest)
				if (!batch.length) {
					st.noMore = true
					if (!st.menuOpen) this.renderTail()
					return
				}
				st.messages = batch.concat(st.messages)
				if (st.menuOpen) return // при закрытии меню список всё равно перерисуется целиком
				let y = st.endY
				batch.slice().reverse().forEach((m) => {
					y = this.renderMessage(st.list, m, y)
				})
				st.endY = y
				this.renderTail()
			})
			.catch(() => {
				st.loadingOlder = false
				if (!st.menuOpen) this.renderTail()
			})
	},

	renderMessage(list, m, y) {
		const x = m.out ? W - PAD - BUBBLE_MAX : PAD
		const textW = BUBBLE_MAX - INNER * 2

		if (m.poll) {
			return this.renderPoll(list, m, x, y, textW)
		}

		const text = m.text || '[медиа]'
		const meta = (m.pinned ? '[закреп] ' : '') + (m.out ? '' : m.from ? m.from + ' - ' : '') + hhmm(m.date)
		const th = textHeight(text, textW, TEXT_SIZE)
		const replyLine = m.replyId ? 18 : 0
		const bh = INNER + 24 + replyLine + th + INNER

		const bubble = list.add(hmUI.widget.FILL_RECT, {
			x,
			y,
			w: BUBBLE_MAX,
			h: bh,
			radius: 16,
			color: m.out ? C.bubbleOut : C.bubbleIn
		})
		list.add(hmUI.widget.TEXT, {
			x: x + INNER,
			y: y + INNER - 4,
			w: textW,
			h: 26,
			color: m.out ? 0xb8d8ff : C.accent,
			text_size: 18,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.CENTER_V,
			text_style: hmUI.text_style.ELLIPSIS,
			text: meta || ' '
		})
		if (m.replyId) {
			list.add(hmUI.widget.FILL_RECT, {
				x: x + INNER,
				y: y + INNER + 20,
				w: 3,
				h: 16,
				color: m.out ? 0xb8d8ff : C.accent
			})
			list.add(hmUI.widget.TEXT, {
				x: x + INNER + 10,
				y: y + INNER + 16,
				w: textW - 10,
				h: 18,
				color: C.dim,
				text_size: 15,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: m.replyPreview || 'ответ на сообщение'
			})
		}
		const body = list.add(hmUI.widget.TEXT, {
			x: x + INNER,
			y: y + INNER + 22 + replyLine,
			w: textW,
			h: th,
			color: C.text,
			text_size: TEXT_SIZE,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.TOP,
			text_style: hmUI.text_style.WRAP,
			text
		})
		// нельзя удалить виджет из его же обработчика клика (вешает ZeppOS 1.0) —
		// открываем меню следующим тиком, уже после того как обработчик клика завершился
		const openMenu = () => setTimeout(() => this.openMenu(m), 0)
		bubble.addEventListener(hmUI.event.CLICK_UP, openMenu)
		body.addEventListener(hmUI.event.CLICK_UP, openMenu)
		return y + bh + 8
	},

	renderPoll(list, m, x, y, textW) {
		const p = m.poll
		const qh = textHeight(p.question, textW, 22)
		let h = INNER + qh + 10
		p.options.forEach(() => {
			h += OPT_H
		})
		h += INNER + 20 // строка с итогом

		list.add(hmUI.widget.FILL_RECT, { x, y, w: BUBBLE_MAX, h, radius: 16, color: C.bubbleIn })
		list.add(hmUI.widget.TEXT, {
			x: x + INNER,
			y: y + INNER,
			w: textW,
			h: qh,
			color: C.text,
			text_size: 22,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.TOP,
			text_style: hmUI.text_style.WRAP,
			text: (p.closed ? '[завершён] ' : '') + p.question
		})

		let oy = y + INNER + qh + 10
		const showPct = p.total > 0
		p.options.forEach((o) => {
			const pct = showPct ? Math.round((o.voters / p.total) * 100) : 0
			const fillW = Math.round((textW * pct) / 100)
			const bg = list.add(hmUI.widget.FILL_RECT, {
				x: x + INNER,
				y: oy,
				w: textW,
				h: OPT_H - 8,
				radius: 10,
				color: o.chosen ? C.accentPress : 0x2c2c2e
			})
			if (showPct && fillW > 0) {
				list.add(hmUI.widget.FILL_RECT, {
					x: x + INNER,
					y: oy,
					w: fillW,
					h: OPT_H - 8,
					radius: 10,
					color: o.chosen ? C.accent : 0x3a3a3c
				})
			}
			const label = list.add(hmUI.widget.TEXT, {
				x: x + INNER + 10,
				y: oy,
				w: textW - 20,
				h: OPT_H - 8,
				color: C.text,
				text_size: 19,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: (o.chosen ? '[x] ' : '') + o.text + (showPct ? '  ' + pct + '%' : '')
			})
			if (!p.closed) {
				const vote = () => this.vote(m, o.key)
				bg.addEventListener(hmUI.event.CLICK_UP, vote)
				label.addEventListener(hmUI.event.CLICK_UP, vote)
			}
			oy += OPT_H
		})

		list.add(hmUI.widget.TEXT, {
			x: x + INNER,
			y: oy,
			w: textW,
			h: 20,
			color: C.dim,
			text_size: 16,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.CENTER_V,
			text: p.total + (p.total === 1 ? ' голос' : ' голосов')
		})
		return y + h + 8
	},

	vote(m, key) {
		if (this.state.busy) return
		req('VOTE', { chat: this.state.chat.id, id: m.id, options: [key] })
			.then((r) => {
				m.poll = r.poll || m.poll
				this.render()
				this.restartPolling()  // свой голос уже отрисован — следующий автотик не должен наступить тут же следом
			})
			.catch(() => {})
	},

	// --- меню действий по тапу на сообщение --------------------------------

	openMenu(m) {
		const menu = this.state.menu
		const actions = []
		actions.push({ label: 'Ответить', fn: () => this.reply(m) })
		if (m.out) {
			actions.push({ label: 'Изменить', fn: () => this.editPrompt(m) })
		}
		actions.push({ label: m.pinned ? 'Открепить' : 'Закрепить', fn: () => this.togglePin(m) })
		if (m.out) {
			actions.push({ label: 'Удалить', fn: () => this.remove(m), danger: true })
		}
		actions.push({ label: 'Отмена', fn: () => this.closeMenu() })

		this.state.menuOpen = true
		this.state.list.clear()  // страница скроллится по общей высоте контента, спрятанный виджет её не уменьшает
		this.state.tail.clear()
		menu.clear()
		menu.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000 })
		menu.add(hmUI.widget.TEXT, {
			x: PAD,
			y: 24,
			w: W - PAD * 2,
			h: 60,
			color: C.dim,
			text_size: 20,
			align_h: hmUI.align.CENTER_H,
			align_v: hmUI.align.CENTER_V,
			text_style: hmUI.text_style.WRAP,
			text: m.text ? '"' + (m.text.length > 40 ? m.text.slice(0, 39) + '..' : m.text) + '"' : '[сообщение]'
		})
		let y = 96
		actions.forEach((a) => {
			button(
				menu,
				PAD,
				y,
				W - PAD * 2,
				56,
				a.label,
				() => {
					// нельзя удалить виджет из его же обработчика клика (вешает ZeppOS 1.0) —
					// закрываем меню следующим тиком, само действие тоже после закрытия
					setTimeout(() => {
						this.closeMenu()
						a.fn()
					}, 0)
				},
				a.danger ? 0x3a1a1a : C.card,
				a.danger ? C.danger : C.cardPress,
				24
			)
			y += 64
		})
	},

	closeMenu() {
		this.state.menuOpen = false
		this.state.menu.clear()
		this.render()  // список был снесён при открытии меню — рисуем заново из уже загруженных данных
	},

	reply(m) {
		hmApp.gotoPage({
			url: 'page/compose',
			param: JSON.stringify(
				Object.assign({}, this.state.chat, {
					replyTo: m.id,
					replyPreview: (m.from || 'себе') + ': ' + (m.text || '[медиа]')
				})
			)
		})
	},

	editPrompt(m) {
		hmApp.gotoPage({
			url: 'page/compose',
			param: JSON.stringify(
				Object.assign({}, this.state.chat, {
					editId: m.id,
					editText: m.text
				})
			)
		})
	},

	togglePin(m) {
		req('PIN', { chat: this.state.chat.id, id: m.id, unpin: m.pinned })
			.then(() => this.refreshNow())
			.catch((e) => this.flash('Ошибка: ' + e.message))
	},

	remove(m) {
		req('DELETE', { chat: this.state.chat.id, id: m.id })
			.then(() => this.refreshNow())
			.catch((e) => this.flash('Ошибка: ' + e.message))
	},

	flash(text) {
		const list = this.state.list
		list.add(hmUI.widget.TEXT, {
			x: PAD,
			y: TOP + 90,
			w: W - PAD * 2,
			h: 60,
			color: C.danger,
			text_size: 20,
			align_h: hmUI.align.CENTER_H,
			align_v: hmUI.align.CENTER_V,
			text_style: hmUI.text_style.WRAP,
			text
		})
		setTimeout(() => this.render(), 2000)
	}
})
