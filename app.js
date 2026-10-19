import './shared/device-polyfill'
import { MessageBuilder } from './shared/message'

App({
	globalData: {
		messageBuilder: null,
		// метка времени последнего успешного отправленного/изменённого сообщения;
		// chat.js сверяет её в своём таймере и обновляется сразу, не дожидаясь автотика
		lastChatChange: 0,
		// жесты: коллбэк регистрируется один раз, страница чата подставляет onSwipe
		gestureRegistered: false,
		onSwipe: null
	},
	onCreate() {
		const appId = hmApp.packageInfo().appId
		this.globalData.messageBuilder = new MessageBuilder({ appId })
		this.globalData.messageBuilder.connect()
	},
	onDestroy() {
		this.globalData.messageBuilder.disConnect()
	}
})
