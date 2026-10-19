import { W, PAD, C, hideStatusBar, req, Layer, button } from '../utils/ui'

// клавиши-символы занимают ячейки 0..32, служебные всегда в 33..35
const LETTERS = {
	ru: 'йцукенгшщзхъфывапролджэячсмитьбюё'.split(''),
	en: 'qwertyuiopasdfghjklzxcvbnm.,?!\'-:'.split(''),
	num: '1234567890.,?!-+=/():;"@#%*_~&\'<>'.split('')
}

const LAYOUTS = [
	{ keys: LETTERS.ru, next: 'EN' },
	{ keys: LETTERS.en, next: '123' },
	{ keys: LETTERS.num, next: 'Шаб' },
	{ tpl: true, next: 'РУ' }
]

const COLS = 6
const GRID_X = 6
const GRID_Y = 112 // ниже строки контекста (ответ/редактирование)
const KEY_W = Math.floor((W - GRID_X * 2) / COLS)
const KEY_H = 44
const TPL_ROWS = 5
const TPL_SHORT = 13 // шаблон до стольких символов занимает пол-ряда
const MAX_LEN = 300

function cellPos(i) {
	return {
		x: GRID_X + (i % COLS) * KEY_W + 2,
		y: GRID_Y + Math.floor(i / COLS) * KEY_H + 2
	}
}

Page({
	state: {
		chat: null,
		text: '',
		layout: 0,
		preview: null,
		sets: [],
		sending: false,
		editId: null
	},

	onInit(param) {
		try {
			this.state.chat = JSON.parse(param)
		} catch (e) {
			this.state.chat = null
		}
		if (this.state.chat && this.state.chat.editId) {
			this.state.editId = this.state.chat.editId
			this.state.text = this.state.chat.editText || ''
		}
	},

	build() {
		hideStatusBar()
		const ui = new Layer()
		const chat = this.state.chat || {}

		if (this.state.editId || chat.replyTo) {
			ui.add(hmUI.widget.FILL_RECT, { x: PAD, y: 4, w: W - PAD * 2, h: 26, radius: 8, color: C.card })
			ui.add(hmUI.widget.TEXT, {
				x: PAD + 10,
				y: 4,
				w: W - PAD * 2 - 20,
				h: 26,
				color: C.dim,
				text_size: 16,
				align_h: hmUI.align.LEFT,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.ELLIPSIS,
				text: this.state.editId ? 'Редактирование' : 'Ответ: ' + (chat.replyPreview || '')
			})
		}

		ui.add(hmUI.widget.FILL_RECT, {
			x: PAD + 4,
			y: 36,
			w: W - PAD * 2 - 8 - 92,
			h: 48,
			radius: 12,
			color: C.card
		})
		this.state.preview = ui.add(hmUI.widget.TEXT, {
			x: PAD + 14,
			y: 36,
			w: W - PAD * 2 - 28 - 92,
			h: 48,
			color: C.text,
			text_size: 22,
			align_h: hmUI.align.RIGHT,
			align_v: hmUI.align.CENTER_V,
			text: '|'
		})
		button(ui, W - PAD - 4 - 86, 36, 86, 48, 'Отпр', () => this.send(), C.accent, C.accentPress, 22)

		LAYOUTS.forEach((layout, li) => {
			const set = new Layer()
			if (layout.keys) {
				layout.keys.forEach((ch, i) => {
					const p = cellPos(i)
					button(set, p.x, p.y, KEY_W - 4, KEY_H - 4, ch, () => this.type(ch), C.card, C.accentPress, 26)
				})
			}
			this.addControls(set, 33, layout.next)
			if (li !== 0) this.showSet(set, false)
			this.state.sets.push(set)
		})

		this.loadTemplates()
		if (this.state.text) this.updatePreview()
	},

	addControls(set, start, nextLabel) {
		const ctl = 0x3a3a3c
		let p = cellPos(start)
		button(set, p.x, p.y, KEY_W - 4, KEY_H - 4, 'DEL', () => this.backspace(), ctl, C.accentPress, 20)
		p = cellPos(start + 1)
		button(set, p.x, p.y, KEY_W - 4, KEY_H - 4, '', () => this.space(), ctl, C.accentPress, 20)
		p = cellPos(start + 2)
		button(set, p.x, p.y, KEY_W - 4, KEY_H - 4, nextLabel, () => this.switchLayout(), ctl, C.accentPress, 20)
	},

	showSet(set, visible) {
		set.items.forEach((w) => w.setProperty(hmUI.prop.VISIBLE, visible))
	},

	loadTemplates() {
		const tplIndex = LAYOUTS.findIndex((l) => l.tpl)
		const set = this.state.sets[tplIndex]
		req('QUICK')
			.then((r) => this.buildTemplates(set, r.items || []))
			.catch(() => this.buildTemplates(set, []))
			.then(() => {
				if (this.state.layout !== tplIndex) this.showSet(set, false)
			})
	},

	// раскладываем шаблоны по 5 рядам: короткие по два в ряд, длинные на весь ряд
	buildTemplates(set, items) {
		const fullW = KEY_W * COLS - 4
		const halfW = Math.floor(KEY_W * COLS / 2) - 4
		if (!items.length) {
			set.add(hmUI.widget.TEXT, {
				x: GRID_X,
				y: GRID_Y + 40,
				w: KEY_W * COLS,
				h: 120,
				color: C.dim,
				text_size: 22,
				align_h: hmUI.align.CENTER_H,
				align_v: hmUI.align.TOP,
				text_style: hmUI.text_style.WRAP,
				text: 'Шаблонов нет.\nДобавь их в настройках TG Watch в Zepp.'
			})
			return
		}
		let row = 0
		let half = 0
		for (let i = 0; i < items.length && row < TPL_ROWS; i++) {
			const t = items[i]
			const wide = t.length > TPL_SHORT
			if (wide && half === 1) {
				row++
				half = 0
				if (row >= TPL_ROWS) break
			}
			const x = GRID_X + 2 + (half === 1 ? halfW + 4 : 0)
			const y = GRID_Y + row * KEY_H + 2
			button(set, x, y, wide ? fullW : halfW, KEY_H - 4, t, () => this.insert(t), C.card, C.accentPress, 20)
			if (wide || half === 1) {
				row++
				half = 0
			} else {
				half = 1
			}
		}
	},

	type(ch) {
		if (this.state.sending) return
		let t = this.state.text
		if (t.length >= MAX_LEN) return
		// заглавная в начале и после конца предложения
		const cap = t.length === 0 || /[.!?]\s$/.test(t)
		t += cap ? ch.toUpperCase() : ch
		this.state.text = t
		this.updatePreview()
	},

	insert(tpl) {
		if (this.state.sending) return
		let t = this.state.text
		if (t.length && t[t.length - 1] !== ' ') t += ' '
		t = (t + tpl).slice(0, MAX_LEN)
		this.state.text = t
		this.updatePreview()
	},

	backspace() {
		if (this.state.sending) return
		this.state.text = this.state.text.slice(0, -1)
		this.updatePreview()
	},

	space() {
		if (this.state.sending) return
		const t = this.state.text
		if (t.length && t[t.length - 1] !== ' ') this.state.text = t + ' '
		this.updatePreview()
	},

	switchLayout() {
		const sets = this.state.sets
		this.showSet(sets[this.state.layout], false)
		this.state.layout = (this.state.layout + 1) % LAYOUTS.length
		this.showSet(sets[this.state.layout], true)
	},

	updatePreview(override) {
		const t = override !== undefined ? override : this.state.text
		// в поле влезает ~16 символов — показываем хвост
		const tail = t.length > 16 ? '..' + t.slice(-15) : t
		this.state.preview.setProperty(hmUI.prop.TEXT, tail + (override !== undefined ? '' : '|'))
	},

	send() {
		const text = this.state.text.trim()
		if (!text || this.state.sending || !this.state.chat) return
		this.state.sending = true
		this.updatePreview(this.state.editId ? 'Сохранение...' : 'Отправка...')

		const request = this.state.editId
			? req('EDIT', { chat: this.state.chat.id, id: this.state.editId, text })
			: req('SEND', { chat: this.state.chat.id, topic: this.state.chat.topicId, replyTo: this.state.chat.replyTo, text })

		request
			.then(() => {
				this.updatePreview(this.state.editId ? 'Сохранено' : 'Отправлено')
				getApp()._options.globalData.lastChatChange = Date.now()
				setTimeout(() => hmApp.goBack(), 500)
			})
			.catch((e) => {
				this.state.sending = false
				this.updatePreview('Ошибка: ' + e.message)
				setTimeout(() => this.updatePreview(), 2500)
			})
	}
})
