import { W, PAD, TOP, C, hideStatusBar, req, Layer, onTap, statusText, button } from '../utils/ui'

const ROW_H = 64
const ROW_GAP = 8

Page({
	state: {
		chat: null,
		list: null
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
		if (!chat) {
			statusText(this.state.list, 'Не передан чат', C.danger)
			return
		}

		head.add(hmUI.widget.TEXT, {
			x: PAD + 20,
			y: TOP - 8,
			w: W - PAD * 2 - 40 - 64 - 8,
			h: 44,
			color: C.text,
			text_size: 28,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.CENTER_V,
			text_style: hmUI.text_style.ELLIPSIS,
			text: chat.name
		})
		button(head, W - PAD - 20 - 64, TOP - 8, 64, 44, 'Обн', () => this.load(), C.accent, C.accentPress, 22)

		this.load()
	},

	load() {
		const list = this.state.list
		list.clear()
		statusText(list, 'Загрузка...')
		req('TOPICS', { chat: this.state.chat.id })
			.then((r) => this.render(r.topics || []))
			.catch((e) => {
				list.clear()
				statusText(list, 'Ошибка:\n' + e.message + '\n\nЖми Обн', C.danger)
			})
	},

	render(topics) {
		const list = this.state.list
		list.clear()
		let y = TOP + 50
		button(list, PAD, y, W - PAD * 2, 50, '< Чаты', () => hmApp.goBack(), C.card, C.cardPress, 22)
		y += 58

		if (!topics.length) {
			statusText(list, '\nТем нет', C.dim)
			return
		}

		const chat = this.state.chat
		topics.forEach((topic) => {
			const open = () => {
				hmApp.gotoPage({
					url: 'page/chat',
					param: JSON.stringify({ id: chat.id, name: chat.name + ' / ' + topic.title, topicId: topic.id, topicTitle: topic.title })
				})
			}
			const badge = topic.unread > 0 ? (topic.unread > 99 ? '99+' : String(topic.unread)) : ''
			const badgeW = badge ? 16 + badge.length * 13 : 0

			button(list, PAD, y, W - PAD * 2, ROW_H, '', open, topic.closed ? C.bg : C.card)
			const title = list.add(hmUI.widget.TEXT, {
				x: PAD + 16,
				y,
				w: W - PAD * 2 - 32 - badgeW - 6,
				h: ROW_H,
				color: topic.closed ? C.dim : C.text,
				text_size: 24,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: (topic.closed ? '[закрыта] ' : '') + topic.title
			})
			onTap(title, open)

			if (badge) {
				const b = list.add(hmUI.widget.FILL_RECT, {
					x: W - PAD - 16 - badgeW,
					y: y + (ROW_H - 28) / 2,
					w: badgeW,
					h: 28,
					radius: 14,
					color: C.accent
				})
				onTap(b, open)
				const bt = list.add(hmUI.widget.TEXT, {
					x: W - PAD - 16 - badgeW,
					y: y + (ROW_H - 28) / 2,
					w: badgeW,
					h: 28,
					color: C.text,
					text_size: 18,
					align_h: hmUI.align.CENTER_H,
					align_v: hmUI.align.CENTER_V,
					text: badge
				})
				onTap(bt, open)
			}
			y += ROW_H + ROW_GAP
		})
		list.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 70, color: C.bg })
	}
})
