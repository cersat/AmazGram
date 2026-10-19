const DEFAULT_URL = 'http://100.116.79.62:8787'
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

		return View({ style: { padding: '14px 18px' } }, [
			Text({ style: { fontSize: '20px', fontWeight: 'bold', marginBottom: '14px' } }, 'TG Watch'),

			View({ style: box }, [
				TextInput({
					label: 'Адрес прокси',
					value: url,
					subStyle: { fontSize: '14px' },
					onChange: (v) => s.setItem('url', String(v).trim())
				}),
				Text({ style: hint }, 'Tailscale-адрес малины с портом, например http://100.x.y.z:8787')
			]),

			View({ style: box }, [
				TextInput({
					label: token ? 'Токен: задан (..' + token.slice(-4) + '), нажми чтобы заменить' : 'Токен: НЕ задан, нажми чтобы ввести',
					value: '',
					subStyle: { fontSize: '14px' },
					onChange: (v) => s.setItem('token', String(v).trim())
				}),
				Text({ style: hint }, 'Значение "token" из ~/tgproxy/config.json на малине. Хранится только на телефоне.')
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
