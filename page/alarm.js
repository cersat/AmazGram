import { W, H, PAD, TOP, C, hideStatusBar, req, Layer, button } from '../utils/ui'
import { loadState, saveState, arm } from '../utils/alerts'

// Сюда попадаем только по одноразовому будильнику (utils/alerts.js).
// Порядок: сразу взвести следующий будильник, спросить телефон о новых сообщениях,
// если их нет — тихо уйти на циферблат, если есть — показать своё окно будильника.
const TEXT_SIZE = 22
const TEXT_MAX = 96
const REPEATING_SCENES = [1, 5] // эти узоры вибрации не кончаются сами

Page({
	state: {
		vibrate: null,
		stopTimer: null,
		bright: false
	},

	build() {
		hideStatusBar()
		const st = loadState()
		if (!st.on) {
			// будильник отменили, а он всё же сработал — ничего не делаем
			hmApp.gotoHome()
			return
		}
		// следующий будильник взводим ДО запроса, иначе одна ошибка сети оборвёт всю цепочку
		arm(st)

		req('ALERTS', { after: st.seq }, 15000)
			.then((r) => {
				const known = st.seq
				st.seq = r.seq
				saveState(st)
				if (!known || !r.items || !r.items.length) {
					hmApp.gotoHome()
					return
				}
				this.show(r)
			})
			.catch(() => hmApp.gotoHome())
	},

	onDestroy() {
		this.stopVibration()
		if (this.state.bright) hmSetting.setBrightScreenCancel()
	},

	stopVibration() {
		if (this.state.stopTimer) clearTimeout(this.state.stopTimer)
		this.state.stopTimer = null
		if (this.state.vibrate) this.state.vibrate.stop()
	},

	buzz(scene) {
		if (scene < 0) return
		if (!this.state.vibrate) this.state.vibrate = hmSensor.createSensor(hmSensor.id.VIBRATE)
		const v = this.state.vibrate
		v.stop() // без stop() следующий start() молчит
		v.scene = scene
		v.start()
		if (REPEATING_SCENES.indexOf(scene) >= 0) {
			this.state.stopTimer = setTimeout(() => this.stopVibration(), 6000)
		}
	},

	show(r) {
		const cfg = r.cfg || {}
		const item = r.items[r.items.length - 1] // самое свежее
		const more = Math.max(0, (r.count || r.items.length) - 1)

		try {
			hmSetting.setBrightScreen(cfg.bright || 15)
			this.state.bright = true
		} catch (e) {
			// без подсветки окно всё равно покажется, просто экран может остаться тёмным
		}
		this.buzz(cfg.scene === undefined ? 9 : cfg.scene)

		const ui = new Layer()
		ui.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg })

		const pillW = W - (PAD + 20) * 2
		ui.add(hmUI.widget.FILL_RECT, { x: PAD + 20, y: TOP - 14, w: pillW, h: 30, radius: 15, color: C.accent })
		ui.add(hmUI.widget.TEXT, {
			x: PAD + 20,
			y: TOP - 14,
			w: pillW,
			h: 30,
			color: C.text,
			text_size: 18,
			align_h: hmUI.align.CENTER_H,
			align_v: hmUI.align.CENTER_V,
			text: more > 0 ? 'Новое сообщение  +' + more : 'Новое сообщение'
		})

		ui.add(hmUI.widget.TEXT, {
			x: PAD + 6,
			y: TOP + 24,
			w: W - (PAD + 6) * 2,
			h: 34,
			color: C.text,
			text_size: 28,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.CENTER_V,
			text_style: hmUI.text_style.ELLIPSIS,
			text: item.name
		})
		if (item.from) {
			ui.add(hmUI.widget.TEXT, {
				x: PAD + 6,
				y: TOP + 58,
				w: W - (PAD + 6) * 2,
				h: 24,
				color: C.accent,
				text_size: 19,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: item.from
			})
		}
		const body = cfg.preview === false ? 'Текст скрыт в настройках' : item.text || '[медиа]'
		ui.add(hmUI.widget.TEXT, {
			x: PAD + 6,
			y: TOP + 86,
			w: W - (PAD + 6) * 2,
			h: 122,
			color: cfg.preview === false ? C.dim : C.text,
			text_size: TEXT_SIZE,
			align_h: hmUI.align.LEFT,
			align_v: hmUI.align.TOP,
			text_style: hmUI.text_style.WRAP,
			text: body.length > TEXT_MAX ? body.slice(0, TEXT_MAX - 1) + '…' : body
		})

		const chat = { id: item.chat, name: item.name, topicId: item.topic || 0 }
		const half = (W - PAD * 2 - 8) / 2
		const open = () => {
			this.stopVibration()
			hmApp.gotoPage({ url: 'page/chat', param: JSON.stringify(chat) })
		}
		const reply = () => {
			this.stopVibration()
			hmApp.gotoPage({
				url: 'page/compose',
				param: JSON.stringify(
					Object.assign({}, chat, { replyTo: item.id, replyPreview: (item.from || item.name) + ': ' + (item.text || '[медиа]') })
				)
			})
		}
		const close = () => {
			this.stopVibration()
			hmApp.gotoHome()
		}
		// страницу нельзя ломать удалением виджетов из их же обработчиков (ZeppOS 1.0),
		// поэтому кнопки только уходят на другую страницу и ничего не сносят
		button(ui, PAD, TOP + 214, half, 52, 'Открыть', open, C.accent, C.accentPress, 22)
		button(ui, PAD + half + 8, TOP + 214, half, 52, 'Ответить', reply, C.card, C.cardPress, 22)
		button(ui, PAD + 16, TOP + 274, W - (PAD + 16) * 2, 46, 'Закрыть', close, C.card, C.cardPress, 22)
	}
})
