import { W, PAD, TOP, C, hideStatusBar, req, Layer, onTap, statusText, button } from '../utils/ui'
import { loadState, saveState, arm, disarm, GUARD_SEC } from '../utils/alerts'
import { loadCached } from '../utils/cache'

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

		this.syncAlarm()
		this.state.list = new Layer()
		this.load()
	},

	// будильник включается в настройках Zepp; часы узнают об этом при открытии приложения
	// (выключение подхватывается само: страница будильника видит флаг в ответе телефона)
	syncAlarm() {
		req('ALERT_CFG')
			.then((cfg) => {
				const state = loadState()
				if (cfg.on && !state.on) {
					state.on = true
					state.seq = 0
					arm(state, GUARD_SEC) // приложение открыто: звено в 30 с поставит App.onDestroy
					saveState(state)
					this.setBaseline()
				} else if (!cfg.on && state.on) {
					state.on = false
					disarm(state)
				}
			})
			.catch(() => {
				// телефон недоступен — состояние будильника остаётся прежним
			})
	},

	// точка отсчёта берётся в момент включения, а не при первом срабатывании через 30 секунд:
	// иначе всё, что пришло за эти полминуты, будильник никогда не покажет
	setBaseline() {
		req('ALERTS', { after: 0 }, 15000)
			.then((r) => {
				const state = loadState()
				if (state.on && state.seq === 0) {
					state.seq = r.seq
					saveState(state)
				}
			})
			.catch(() => {
				// телефон недоступен — точка отсчёта возьмётся при первом срабатывании будильника
			})
	},

	load() {
		const list = this.state.list
		loadCached('FOLDERS', {}, 'folders', {
			loading: () => {
				list.clear()
				statusText(list, 'Загрузка...')
			},
			show: (r) => this.render(r.folders || []),
			fail: (e) => {
				list.clear()
				statusText(list, 'Ошибка:\n' + e.message + '\n\nЖми Обн', C.danger)
			}
		})
	},

	render(folders) {
		const list = this.state.list
		list.clear()
		let y = TOP + 52
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
