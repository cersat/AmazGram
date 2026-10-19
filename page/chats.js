import { W, PAD, TOP, C, hideStatusBar, req, cut, Layer, onTap, statusText, button } from '../utils/ui'

const ROW_H = 84
const ROW_GAP = 8

Page({
	state: {
		folder: { id: 0, title: 'Все чаты' },
		list: null
	},

	onInit(param) {
		try {
			this.state.folder = JSON.parse(param)
		} catch (e) {}
	},

	build() {
		hideStatusBar()
		const head = new Layer()
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
			text: this.state.folder.title
		})
		button(head, W - PAD - 20 - 64, TOP - 8, 64, 44, 'Обн', () => this.load(), C.accent, C.accentPress, 26)

		this.state.list = new Layer()
		this.load()
	},

	load() {
		const list = this.state.list
		list.clear()
		statusText(list, 'Загрузка...')
		req('CHATS', { limit: 20, folder: this.state.folder.id })
			.then((r) => this.render(r.chats || []))
			.catch((e) => {
				list.clear()
				statusText(list, 'Ошибка:\n' + e.message + '\n\nЖми Обн', C.danger)
			})
	},

	render(chats) {
		const list = this.state.list
		list.clear()
		if (!chats.length) {
			button(list, PAD, TOP + 50, W - PAD * 2, 50, '< Группы', () => hmApp.goBack(), C.card, C.cardPress, 22)
			statusText(list, '\nВ папке пусто')
			return
		}
		let y = TOP + 50
		button(list, PAD, y, W - PAD * 2, 50, '< Группы', () => hmApp.goBack(), C.card, C.cardPress, 22)
		y += 58
		chats.forEach((chat) => {
			const open = () => {
				hmApp.gotoPage({
					url: chat.forum ? 'page/topics' : 'page/chat',
					param: JSON.stringify({ id: chat.id, name: chat.name })
				})
			}
			const hasUnread = chat.unread > 0
			const badge = hasUnread ? (chat.unread > 999 ? '999+' : String(chat.unread)) : ''
			const badgeW = badge ? 16 + badge.length * 13 : 0

			button(list, PAD, y, W - PAD * 2, ROW_H, '', open)

			const name = list.add(hmUI.widget.TEXT, {
				x: PAD + 14,
				y: y + 8,
				w: W - PAD * 2 - 28 - badgeW - 6,
				h: 34,
				color: C.text,
				text_size: 26,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: chat.name
			})
			onTap(name, open)

			const last = list.add(hmUI.widget.TEXT, {
				x: PAD + 14,
				y: y + 44,
				w: W - PAD * 2 - 28,
				h: 30,
				color: C.dim,
				text_size: 21,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: cut(chat.last, 40) || ' '
			})
			onTap(last, open)

			if (badge) {
				const b = list.add(hmUI.widget.FILL_RECT, {
					x: W - PAD - 14 - badgeW,
					y: y + 12,
					w: badgeW,
					h: 26,
					radius: 13,
					color: C.accent
				})
				onTap(b, open)
				const bt = list.add(hmUI.widget.TEXT, {
					x: W - PAD - 14 - badgeW,
					y: y + 12,
					w: badgeW,
					h: 26,
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
		// запас снизу, чтобы последний чат выезжал из-под скруглённых углов
		list.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 70, color: C.bg })
	}
})
