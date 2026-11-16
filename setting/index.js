const DEFAULT_URL = 'http://127.0.0.1:8787'
const DEFAULT_QUICK = 'Ок|Да|Нет|Сейчас не могу, напишу позже|Уже иду|Спасибо!'

// тёмная тема: те же цвета, что у приложения на часах и у TG Bridge
const D = {
	bg: '#0E1117',
	card: '#171C26',
	stroke: '#262D3B',
	accent: '#2EA6FF',
	ok: '#3DDC84',
	text: '#E8ECF2',
	dim: '#8B96A8'
}

const box = {
	marginBottom: '14px',
	padding: '10px 12px',
	border: '1px solid ' + D.stroke,
	borderRadius: '10px',
	background: D.card
}

const hint = {
	fontSize: '12px',
	color: D.dim,
	marginTop: '4px'
}

const title = {
	fontSize: '16px',
	fontWeight: 'bold',
	marginBottom: '8px',
	color: D.text
}

const label = { color: D.text, fontSize: '14px' }

// у Select и Toggle в настройках Zepp нельзя менять цвета, поэтому выбор и переключатель
// сделаны кнопками: выбранная подсвечена
function pick(opt, selected, onPick) {
	return Button({
		label: opt.name,
		onClick: () => onPick(opt.value),
		style: {
			fontSize: '13px',
			borderRadius: '8px',
			margin: '4px 6px 0 0',
			color: selected ? D.bg : D.text,
			background: selected ? D.accent : D.stroke
		}
	})
}

function choice(caption, options, current, onPick) {
	return View({ style: { marginBottom: '8px' } }, [
		Text({ style: label }, caption),
		View(
			{ style: { display: 'flex', flexWrap: 'wrap' } },
			options.map((o) => pick(o, o.value === current, onPick))
		)
	])
}

function toggle(caption, on, onChange) {
	return View({ style: { marginBottom: '8px' } }, [
		Text({ style: label }, caption),
		Button({
			label: on ? 'Включено' : 'Выключено',
			onClick: () => onChange(!on),
			style: {
				fontSize: '13px',
				borderRadius: '8px',
				marginTop: '4px',
				color: on ? D.bg : D.text,
				background: on ? D.ok : D.stroke
			}
		})
	])
}

AppSettingsPage({
	build(props) {
		const s = props.settingsStorage
		const url = s.getItem('url') || DEFAULT_URL
		const token = s.getItem('token') || ''
		const quick = s.getItem('quick') || DEFAULT_QUICK
		const alertOn = s.getItem('alert_on') === 'true'
		const alertScene = s.getItem('alert_scene') || '9'
		const alertBright = s.getItem('alert_bright') || '15'
		const alertPreview = s.getItem('alert_preview') !== 'false'

		return View({ style: { padding: '14px 18px', minHeight: '100vh', background: D.bg } }, [
			Text({ style: { fontSize: '20px', fontWeight: 'bold', marginBottom: '14px', color: D.text } }, 'TG Watch'),

			View({ style: box }, [
				TextInput({
					label: 'Адрес TG Bridge',
					labelStyle: label,
					value: url,
					subStyle: { fontSize: '14px', color: D.text },
					onChange: (v) => s.setItem('url', String(v).trim())
				}),
				Text({ style: hint }, 'Обычно http://127.0.0.1:8787 — приложение TG Bridge на этом же телефоне')
			]),

			View({ style: box }, [
				TextInput({
					label: token ? 'Токен: задан (..' + token.slice(-4) + '), нажми чтобы заменить' : 'Токен: НЕ задан, нажми чтобы ввести',
					labelStyle: label,
					value: '',
					subStyle: { fontSize: '14px', color: D.text },
					onChange: (v) => s.setItem('token', String(v).trim())
				}),
				Text({ style: hint }, 'Токен из приложения TG Bridge (кнопка «Скопировать токен»). Хранится только на телефоне.')
			]),

			View({ style: box }, [
				Text({ style: title }, 'Будильник'),
				Text({ style: hint }, 'Запасной способ, по умолчанию выключен. Он будит часы и закрывает открытое приложение, поэтому для обычных сообщений лучше уведомления: включи их в TG Bridge и в Zepp (Оповещения приложений).'),
				toggle('Проверять новые сообщения раз в 30 секунд', alertOn, (v) => s.setItem('alert_on', v ? 'true' : 'false')),
				Text({ style: hint }, 'Включится, когда ты откроешь TG Watch на часах. Выключится сам в течение 30 секунд.'),
				choice(
					'Вибрация',
					[
						{ name: 'Два коротких', value: '0' },
						{ name: 'Четыре импульса', value: '9' },
						{ name: 'Долгий, 6 с', value: '5' },
						{ name: 'Двойной, 6 с', value: '1' },
						{ name: 'Сильная, 1 с', value: '27' },
						{ name: 'Без вибрации', value: '-1' }
					],
					alertScene,
					(v) => s.setItem('alert_scene', v)
				),
				choice(
					'Подсветка экрана',
					[
						{ name: '10 с', value: '10' },
						{ name: '15 с', value: '15' },
						{ name: '30 с', value: '30' },
						{ name: '60 с', value: '60' }
					],
					alertBright,
					(v) => s.setItem('alert_bright', v)
				),
				toggle('Показывать текст сообщения', alertPreview, (v) => s.setItem('alert_preview', v ? 'true' : 'false'))
			]),

			View({ style: box }, [
				TextInput({
					label: 'Шаблоны ответов',
					labelStyle: label,
					value: quick,
					subStyle: { fontSize: '14px', color: D.text },
					maxLength: 1000,
					onChange: (v) => s.setItem('quick', String(v))
				}),
				Text({ style: hint }, 'Через вертикальную черту: Ок|Да|Нет|Перезвоню. Короткие (до 13 символов) встают по два в ряд, влезает 5 рядов.')
			])
		])
	}
})
