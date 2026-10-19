export const { width: W, height: H } = hmSetting.getDeviceInfo()

// экран GTS 4 mini скруглён радиусом 80px — держим контент подальше от углов
export const PAD = 14
export const TOP = 40

export const C = {
	bg: 0x000000,
	card: 0x1c1c1e,
	cardPress: 0x3a3a3c,
	accent: 0x2ea6ff,
	accentPress: 0x1b6fb0,
	text: 0xffffff,
	dim: 0x8e8e93,
	bubbleOut: 0x1f5f99,
	bubbleIn: 0x2c2c2e,
	danger: 0xff453a,
	ok: 0x30d158
}

export function hideStatusBar() {
	if (typeof hmUI.setStatusBarVisible === 'function') {
		hmUI.setStatusBarVisible(false)
	}
}

// запрос к side-service на телефоне; ошибки прокси приходят как { error }
export function req(method, params, timeout) {
	const { messageBuilder } = getApp()._options.globalData
	return messageBuilder
		.request({ method, params: params || {} }, { timeout: timeout || 20000 })
		.then((data) => {
			const r = data && data.result
			if (!r) throw new Error('Пустой ответ от телефона')
			if (r.error) throw new Error(r.error)
			return r
		})
}

export function cut(s, n) {
	s = String(s || '')
	return s.length > n ? s.slice(0, n - 2) + '..' : s
}

// грубая оценка высоты текста с переносами — getTextLayout в API 1.0 нет
export function textHeight(text, w, size) {
	const perLine = Math.max(1, Math.floor(w / (size * 0.56)))
	const lines = Math.max(1, Math.ceil(String(text || '').length / perLine))
	return lines * Math.ceil(size * 1.35)
}

// смещение часового пояса часов относительно UTC, в минутах
let tzOffset = null
function getTzOffset() {
	if (tzOffset !== null) return tzOffset
	try {
		const t = hmSensor.createSensor(hmSensor.id.TIME)
		const now = new Date()
		const local = t.hour * 60 + t.minute
		const utc = now.getUTCHours() * 60 + now.getUTCMinutes()
		let diff = local - utc
		if (diff > 720) diff -= 1440
		if (diff < -720) diff += 1440
		tzOffset = Math.round(diff / 15) * 15
	} catch (e) {
		tzOffset = 0
	}
	return tzOffset
}

// Unix-секунды (как отдаёт TG Bridge) или ISO-строка "2026-09-20T20:00:14+00:00"
// -> "ЧЧ:ММ" по времени часов
export function hhmm(date) {
	let h
	let m
	if (typeof date === 'number') {
		const secOfDay = ((date % 86400) + 86400) % 86400
		h = Math.floor(secOfDay / 3600)
		m = Math.floor((secOfDay % 3600) / 60)
	} else if (typeof date === 'string' && date.length >= 16) {
		h = parseInt(date.substr(11, 2), 10)
		m = parseInt(date.substr(14, 2), 10)
	} else {
		return ''
	}
	let total = (h * 60 + m + getTzOffset()) % 1440
	if (total < 0) total += 1440
	const hh = Math.floor(total / 60)
	const mm = total % 60
	return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
}

// набор виджетов, который можно разом снести и нарисовать заново
export class Layer {
	constructor() {
		this.items = []
	}
	add(type, opts) {
		const w = hmUI.createWidget(type, opts)
		this.items.push(w)
		return w
	}
	clear() {
		this.items.forEach((w) => hmUI.deleteWidget(w))
		this.items = []
	}
	setVisible(visible) {
		this.items.forEach((w) => w.setProperty(hmUI.prop.VISIBLE, visible))
	}
}

export function onTap(widget, fn) {
	widget.addEventListener(hmUI.event.CLICK_UP, fn)
}

// строка статуса по центру экрана (загрузка / ошибка)
export function statusText(layer, text, color) {
	return layer.add(hmUI.widget.TEXT, {
		x: PAD,
		y: TOP + 90,
		w: W - PAD * 2,
		h: 160,
		color: color || C.dim,
		text_size: 24,
		align_h: hmUI.align.CENTER_H,
		align_v: hmUI.align.TOP,
		text_style: hmUI.text_style.WRAP,
		text
	})
}

export function button(layer, x, y, w, h, text, fn, color, pressColor, size) {
	return layer.add(hmUI.widget.BUTTON, {
		x,
		y,
		w,
		h,
		radius: 14,
		normal_color: color || C.card,
		press_color: pressColor || C.cardPress,
		text,
		text_size: size || 24,
		color: C.text,
		click_func: fn
	})
}
