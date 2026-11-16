package com.sercatdar.tgbridge

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Единая тёмная палитра приложения. */
object Palette {
	val bg = Color.parseColor("#0E1117")
	val card = Color.parseColor("#171C26")
	val stroke = Color.parseColor("#262D3B")
	val accent = Color.parseColor("#2EA6FF")
	val onAccent = Color.parseColor("#06121F")
	val ok = Color.parseColor("#3DDC84")
	val warn = Color.parseColor("#FFB84D")
	val error = Color.parseColor("#FF6B6B")
	val text = Color.parseColor("#E8ECF2")
	val dim = Color.parseColor("#8B96A8")
}

/**
 * Маленький набор конструкторов View в коде — без XML-раскладок и сторонних библиотек.
 * Каждая функция добавляет созданный элемент в parent и возвращает его.
 */
class Ui(private val ctx: Context) {

	private val match = ViewGroup.LayoutParams.MATCH_PARENT
	private val wrap = ViewGroup.LayoutParams.WRAP_CONTENT

	fun dp(v: Int): Int = (v * ctx.resources.displayMetrics.density + 0.5f).toInt()

	private fun rounded(color: Int, radiusDp: Int, strokeColor: Int? = null): GradientDrawable =
		GradientDrawable().apply {
			setColor(color)
			cornerRadius = dp(radiusDp).toFloat()
			if (strokeColor != null) setStroke(dp(1), strokeColor)
		}

	fun card(parent: LinearLayout): LinearLayout {
		val c = LinearLayout(ctx).apply {
			orientation = LinearLayout.VERTICAL
			background = rounded(Palette.card, 16, Palette.stroke)
			setPadding(dp(18), dp(16), dp(18), dp(16))
		}
		parent.addView(c, LinearLayout.LayoutParams(match, wrap).apply { bottomMargin = dp(12) })
		return c
	}

	fun text(parent: LinearLayout, s: String, size: Float = 15f, color: Int = Palette.text, bold: Boolean = false): TextView {
		val tv = TextView(ctx).apply {
			text = s
			textSize = size
			setTextColor(color)
			if (bold) typeface = Typeface.DEFAULT_BOLD
			setLineSpacing(0f, 1.15f)
		}
		parent.addView(tv, LinearLayout.LayoutParams(wrap, wrap).apply { bottomMargin = dp(8) })
		return tv
	}

	/** Мелкая подпись над значением: «АДРЕС», «ТОКЕН». */
	fun caption(parent: LinearLayout, s: String): TextView {
		val tv = text(parent, s.uppercase(), 11f, Palette.dim, true)
		tv.letterSpacing = 0.08f
		return tv
	}

	/** Цветная точка и две строки: заголовок состояния и пояснение. */
	fun statusRow(parent: LinearLayout, dotColor: Int, title: String, sub: String? = null) {
		val row = LinearLayout(ctx).apply {
			orientation = LinearLayout.HORIZONTAL
			gravity = Gravity.CENTER_VERTICAL
		}
		val dot = View(ctx).apply {
			background = GradientDrawable().apply {
				shape = GradientDrawable.OVAL
				setColor(dotColor)
			}
		}
		row.addView(dot, LinearLayout.LayoutParams(dp(12), dp(12)).apply { rightMargin = dp(14) })
		val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
		text(col, title, 18f, Palette.text, true).also {
			(it.layoutParams as LinearLayout.LayoutParams).bottomMargin = if (sub == null) 0 else dp(2)
		}
		if (sub != null) text(col, sub, 13f, Palette.dim).also { (it.layoutParams as LinearLayout.LayoutParams).bottomMargin = 0 }
		row.addView(col, LinearLayout.LayoutParams(0, wrap, 1f))
		parent.addView(row, LinearLayout.LayoutParams(match, wrap))
	}

	fun field(parent: LinearLayout, hint: String, initial: String = "", type: Int = InputType.TYPE_CLASS_TEXT): EditText {
		val et = EditText(ctx).apply {
			this.hint = hint
			setText(initial)
			inputType = type
			isSingleLine = true
			imeOptions = EditorInfo.IME_ACTION_DONE
			textSize = 16f
			setTextColor(Palette.text)
			setHintTextColor(Palette.dim)
			background = rounded(Palette.bg, 12, Palette.stroke)
			setPadding(dp(14), dp(13), dp(14), dp(13))
		}
		parent.addView(et, LinearLayout.LayoutParams(match, wrap).apply { bottomMargin = dp(10) })
		return et
	}

	fun primary(parent: LinearLayout, label: String, onClick: () -> Unit): Button =
		button(parent, label, Palette.accent, Palette.onAccent, onClick)

	fun secondary(parent: LinearLayout, label: String, onClick: () -> Unit): Button =
		button(parent, label, Palette.stroke, Palette.text, onClick)

	private fun button(parent: LinearLayout, label: String, fill: Int, textColor: Int, onClick: () -> Unit): Button {
		val b = Button(ctx).apply {
			text = label
			isAllCaps = false
			textSize = 15f
			typeface = Typeface.DEFAULT_BOLD
			setTextColor(textColor)
			stateListAnimator = null
			minHeight = dp(48)
			minimumHeight = dp(48)
			setPadding(dp(16), dp(10), dp(16), dp(10))
			background = RippleDrawable(
				ColorStateList.valueOf(0x33FFFFFF),
				rounded(fill, 12),
				rounded(Color.WHITE, 12)
			)
			setOnClickListener { onClick() }
		}
		parent.addView(b, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(4) })
		return b
	}
}
