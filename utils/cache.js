import { readFileSync, writeFileSync } from '../shared/fs'
import { req } from './ui'

// Кеш структуры: списки папок, чатов и тем, в которые человек уже заходил. Показываем сразу,
// а свежие данные подгружаем следом. Один файл на ключ: так каждый читается за раз и не раздувается.
function fileOf(key) {
	return 'cache_' + String(key).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'
}

export function cacheGet(key) {
	try {
		const raw = readFileSync(fileOf(key))
		return raw ? JSON.parse(raw) : null
	} catch (e) {
		return null
	}
}

export function cachePut(key, data) {
	try {
		writeFileSync(fileOf(key), JSON.stringify(data))
	} catch (e) {
		// без записи всё работает, просто в следующий раз покажем «Загрузка...»
	}
}

// show(ответ) рисует список, loading() — «Загрузка...», когда кеша ещё нет, fail(ошибка) — когда нет
// ни кеша, ни связи. Если кеш уже показан, а телефон недоступен, остаётся кеш.
export function loadCached(method, params, key, { loading, show, fail }) {
	const cached = cacheGet(key)
	let shown = ''
	if (cached) {
		shown = JSON.stringify(cached)
		show(cached)
	} else {
		loading()
	}
	return req(method, params)
		.then((r) => {
			const fresh = JSON.stringify(r)
			cachePut(key, r)
			// не перерисовываем одно и то же: полная перерисовка во время скролла вешает ZeppOS 1.0
			if (fresh !== shown) show(r)
		})
		.catch((e) => {
			if (!cached) fail(e)
		})
}
