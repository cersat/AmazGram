import { readFileSync, writeFileSync } from '../shared/fs'

// В Zepp OS 1.0 у приложения нет фонового сервиса, поэтому "воркер" устроен цепочкой
// одноразовых будильников: каждый будит page/alarm, та спрашивает у телефона про новые
// сообщения и тут же взводит следующий будильник.
export const INTERVAL_SEC = 30
const FILE = 'alerts.json'
const ALARM_PAGE = 'page/alarm'

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
export function arm(state) {
	const id = hmApp.alarmNew({
		file: ALARM_PAGE,
		appid: hmApp.packageInfo().appId,
		delay: INTERVAL_SEC
	})
	state.alarmId = id
	saveState(state)
	return id
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
