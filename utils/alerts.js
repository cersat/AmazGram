import { readFileSync, writeFileSync } from '../shared/fs'

// В Zepp OS 1.0 у приложения нет фонового сервиса, поэтому "воркер" устроен цепочкой
// одноразовых будильников: каждый будит page/alarm, та спрашивает у телефона про новые
// сообщения и тут же взводит следующий будильник.
export const INTERVAL_SEC = 30
// пока приложение открыто, будильник сработал бы поверх него и закрыл его, поэтому на это время
// вместо 30-секундного звена ставим страховочное: оно нужно, только если выход из приложения
// не вызвал onDestroy и цепочку некому возобновить
export const GUARD_SEC = 900
const FILE = 'alerts.json'
const ALARM_PAGE = 'page/alarm'
export const ALARM_PARAM = 'alarm'

export function loadState() {
	try {
		const raw = readFileSync(FILE)
		const s = raw ? JSON.parse(raw) : null
		if (s && typeof s === 'object') return { on: !!s.on, seq: Number(s.seq) || 0, alarmId: Number(s.alarmId) || 0 }
	} catch (e) {
		// нет файла или он битый — начинаем с выключенного состояния
	}
	return { on: false, seq: 0, alarmId: 0 }
}

export function saveState(state) {
	try {
		writeFileSync(FILE, JSON.stringify(state))
	} catch (e) {
		// без записи цепочка продолжит работать, но после перезапуска забудет, что включена
	}
}

// взводит следующий одноразовый будильник и запоминает его номер
export function arm(state, delay) {
	const id = hmApp.alarmNew({
		file: ALARM_PAGE,
		appid: hmApp.packageInfo().appId,
		delay: delay || INTERVAL_SEC,
		param: ALARM_PARAM // по нему App.onCreate отличает запуск будильником от запуска человеком
	})
	state.alarmId = id
	saveState(state)
	return id
}

// отменяет прежний будильник и взводит новый, чтобы не получить две цепочки сразу
export function rearm(state, delay) {
	disarm(state)
	return arm(state, delay)
}

// приложение открыл человек: будильник не должен срабатывать поверх него.
// Заодно лечит цепочку, потерянную при перезагрузке часов (системные будильники пропадают,
// а флаг "вкл" в файле остаётся).
export function pauseChain() {
	const state = loadState()
	if (state.on) rearm(state, GUARD_SEC)
}

// приложение закрылось (или окно будильника закрыто): снова проверяем сообщения каждые 30 с
export function resumeChain() {
	const state = loadState()
	if (state.on) rearm(state)
}

export function disarm(state) {
	if (state.alarmId) {
		try {
			hmApp.alarmCancel(state.alarmId)
		} catch (e) {
			// будильник мог уже сработать — отменять нечего
		}
	}
	state.alarmId = 0
	saveState(state)
}
