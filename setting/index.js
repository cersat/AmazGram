const DEFAULT_URL = 'http://127.0.0.1:8787'
const DEFAULT_QUICK = 'Ок|Да|Нет|Сейчас не могу, напишу позже|Уже иду|Спасибо!'

const box = {
	marginBottom: '14px',
	padding: '10px 12px',
	border: '1px solid #e5e5ea',
	borderRadius: '10px',
	backgroundColor: 'white'
}

const hint = {
	fontSize: '12px',
	color: '#8e8e93',
	marginTop: '4px'
}

AppSettingsPage({
	build(props) {
		const s = props.settingsStorage
		const url = s.getItem('url') || DEFAULT_URL
		const token = s.getItem('token') || ''
		const quick = s.getItem('quick') || DEFAULT_QUICK
		const alertScene = s.getItem('alert_scene') || '9'
		const alertBright = s.getItem('alert_bright') || '15'
		const alertPreview = s.getItem('alert_preview') !== 'false'

		return View({ style: { padding: '14px 18px' } }, [
			Text({ style: { fontSize: '20px', fontWeight: 'bold', marginBottom: '14px' } }, 'TG Watch'),

			View({ style: box }, [
				TextInput({
					label: 'Адрес TG Bridge',
					value: url,
					subStyle: { fontSize: '14px' },
					onChange: (v) => s.setItem('url', String(v).trim())
				}),
				Text({ style: hint }, 'Обычно http://127.0.0.1:8787 — приложение TG Bridge на этом же телефоне')
			]),

			View({ style: box }, [
				TextInput({
					label: token ? 'Токен: задан (..' + token.slice(-4) + '), нажми чтобы заменить' : 'Токен: НЕ задан, нажми чтобы ввести',
					value: '',
					subStyle: { fontSize: '14px' },
					onChange: (v) => s.setItem('token', String(v).trim())
				}),
				Text({ style: hint }, 'Токен из приложения TG Bridge (кнопка «Скопировать токен»). Хранится только на телефоне.')
			]),

			View({ style: box }, [
				Text({ style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' } }, 'Будильник'),
				Select({
					label: 'Вибрация',
					options: [
						{ name: 'Два коротких (как сообщение)', value: '0' },
						{ name: 'Четыре импульса', value: '9' },
						{ name: 'Долгий, 6 секунд (как будильник)', value: '5' },
						{ name: 'Двойной, 6 секунд (как звонок)', value: '1' },
						{ name: 'Одна сильная, 1 секунда', value: '27' },
						{ name: 'Без вибрации', value: '-1' }
					],
					value: [alertScene],
					onChange: (v) => s.setItem('alert_scene', String(Array.isArray(v) ? v[0] : v))
				}),
				Select({
					label: 'Подсветка экрана',
					options: [
						{ name: '10 секунд', value: '10' },
						{ name: '15 секунд', value: '15' },
						{ name: '30 секунд', value: '30' },
						{ name: '60 секунд', value: '60' }
					],
					value: [alertBright],
					onChange: (v) => s.setItem('alert_bright', String(Array.isArray(v) ? v[0] : v))
				}),
				Toggle({
					label: 'Показывать текст сообщения',
					value: alertPreview,
					onChange: (v) => s.setItem('alert_preview', v ? 'true' : 'false')
				}),
				Text({ style: hint }, 'Включается кнопкой на главном экране приложения на часах. Проверка новых сообщений раз в 30 секунд.')
			]),

			View({ style: box }, [
				TextInput({
					label: 'Шаблоны ответов',
					value: quick,
					subStyle: { fontSize: '14px' },
					maxLength: 1000,
					onChange: (v) => s.setItem('quick', String(v))
				}),
				Text({ style: hint }, 'Через вертикальную черту: Ок|Да|Нет|Перезвоню. Короткие (до 13 символов) встают по два в ряд, влезает 5 рядов.')
			])
		])
	}
})
