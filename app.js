import './shared/device-polyfill'
import { MessageBuilder } from './shared/message'
import { ALARM_PARAM, pauseChain, resumeChain } from './utils/alerts'

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
	onCreate(param) {
		// запуск будильником сам решит, что делать (page/alarm); человека же будильник беспокоить не должен
		if (param !== ALARM_PARAM) pauseChain()
		const appId = hmApp.packageInfo().appId
		this.globalData.messageBuilder = new MessageBuilder({ appId })
		this.globalData.messageBuilder.connect()
	},
	onDestroy() {
		resumeChain()
		this.globalData.messageBuilder.disConnect()
	}
})
