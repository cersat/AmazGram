import { W, PAD, TOP, C, hideStatusBar, req, Layer, onTap, statusText, button } from '../utils/ui'

const ROW_H = 64
const ROW_GAP = 8

Page({
	state: {
		list: null
	},

	build() {
		hideStatusBar()
		const head = new Layer()
		head.add(hmUI.widget.TEXT, {
			x: PAD + 20,
			y: TOP - 8,
			w: 180,
			h: 44,
			color: C.text,
			text_size: 32,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.CENTER_V,
			text: 'Группы'
		})
		button(head, W - PAD - 20 - 64, TOP - 8, 64, 44, 'Обн', () => this.load(), C.accent, C.accentPress, 22)

		this.state.list = new Layer()
		this.load()
	},

	load() {
		const list = this.state.list
		list.clear()
		statusText(list, 'Загрузка...')
		req('FOLDERS')
			.then((r) => this.render(r.folders || []))
			.catch((e) => {
				list.clear()
				statusText(list, 'Ошибка:\n' + e.message + '\n\nЖми Обн', C.danger)
			})
	},

	render(folders) {
		const list = this.state.list
		list.clear()
		let y = TOP + 50
		folders.forEach((folder) => {
			const open = () => {
				hmApp.gotoPage({
					url: 'page/chats',
					param: JSON.stringify({ id: folder.id, title: folder.title })
				})
			}
			const badge = folder.unread > 0 ? (folder.unread > 99 ? '99+' : String(folder.unread)) : ''
			const badgeW = badge ? 16 + badge.length * 13 : 0

			button(list, PAD, y, W - PAD * 2, ROW_H, '', open)
			const title = list.add(hmUI.widget.TEXT, {
				x: PAD + 16,
				y,
				w: W - PAD * 2 - 32 - badgeW - 6,
				h: ROW_H,
				color: C.text,
				text_size: 26,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: folder.title
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
