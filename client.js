window.__ModuleLoader__.load({
	id: 'dsh-model-reminder',
	factory(require) {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React

		const NS = 'dsh-model-reminder'
		const STATE_URL = '/api/model-reminder/state'
		const ACK_URL = '/api/model-reminder/ack'
		const POSITION_URL = '/api/model-reminder/position'
		const POLL_MS = 30_000

		/**
		 * All visible copy lives in the Client locale service. The dictionaries are
		 * registered here as well as exported as JSON: the JSON covers plugin-list
		 * metadata, the in-memory copy covers the running page.
		 */
		const DICTIONARIES = {
			zh: {
				'pill.pending': '模型待确认',
				'pill.done': '模型已确认',
				'pill.title': '模型提醒：点击查看当前模型；拖动或方向键可移动位置',
				'pill.titleError': '模型提醒：暂时读不到当前模型，点击查看原因',
				'panel.title': '本会话今天第一次对话前，先确认模型',
				'panel.sub': '发送本会话今天第一条消息前，看一眼当前模型是不是你想要的。',
				'panel.titleDone': '本会话今日模型已确认',
				'panel.subDone': '本会话今天不再提醒；点挂件可随时查看。',
				'panel.close': '关闭',
				'panel.providerUnknown': '未知提供方',
				'panel.effort': '推理强度：{effort}',
				'panel.modelUnknown': '未读取到模型选择',
				'panel.modelUnknownHint': '打开一个会话后，模型选择器会写入当前模型。',
				'panel.confirm': '确认，开始对话',
				'panel.confirming': '确认中…',
				'panel.later': '稍后提醒',
				'panel.foot': '每个会话每天提醒一次；确认后本会话今天不再弹出。',
				'panel.footDone': '{date} 已确认；本会话明天首次打开时会再次提醒。',
				'panel.reset': '重新提醒',
				'panel.resetPosition': '复位位置',
				'panel.error': '读取失败：{message}（请确认插件已启用）',
			},
			en: {
				'pill.pending': 'Model unconfirmed',
				'pill.done': 'Model confirmed',
				'pill.title': 'Model check: click to review; drag or arrow keys to move',
				'pill.titleError': 'Model check: the current model could not be read; click for details',
				'panel.title': 'Confirm the model before this conversation’s first message',
				'panel.sub': 'Before sending this conversation’s first message today, check that the current model is the one you want.',
				'panel.titleDone': 'Model confirmed for this conversation today',
				'panel.subDone': 'No more reminders for this conversation today. Click the widget to review the model.',
				'panel.close': 'Close',
				'panel.providerUnknown': 'Unknown provider',
				'panel.effort': 'Reasoning effort: {effort}',
				'panel.modelUnknown': 'No model selection found',
				'panel.modelUnknownHint': 'Open a conversation and the composer’s model picker will record the current model.',
				'panel.confirm': 'Confirm and start',
				'panel.confirming': 'Confirming…',
				'panel.later': 'Remind me later',
				'panel.foot': 'One reminder per conversation per day; confirming dismisses this conversation until tomorrow.',
				'panel.footDone': 'Confirmed for {date}; this conversation is reminded again tomorrow.',
				'panel.reset': 'Remind me again',
				'panel.resetPosition': 'Reset position',
				'panel.error': 'Could not read the state: {message} (is the plugin enabled?)',
			},
			ja: {
				'pill.pending': 'モデル未確認',
				'pill.done': 'モデル確認済み',
				'pill.title': 'モデル日次チェック：クリックで表示、ドラッグまたは矢印キーで移動',
				'pill.titleError': 'モデル日次チェック：現在のモデルを取得できません',
				'panel.title': 'この会話の今日最初の送信前にモデルを確認',
				'panel.sub': 'この会話の今日最初のメッセージを送る前に、現在のモデルが意図どおりか確認してください。',
				'panel.titleDone': 'この会話の本日のモデルは確認済みです',
				'panel.subDone': 'この会話は本日再通知しません。ウィジェットをクリックすると確認できます。',
				'panel.close': '閉じる',
				'panel.providerUnknown': '不明なプロバイダー',
				'panel.effort': '推論の強さ：{effort}',
				'panel.modelUnknown': 'モデル選択を取得できません',
				'panel.modelUnknownHint': '会話を開くと、コンポーザーのモデル選択が現在のモデルを記録します。',
				'panel.confirm': '確認して開始',
				'panel.confirming': '確認中…',
				'panel.later': '後で通知',
				'panel.foot': '会話ごとに 1 日 1 回の通知です。確認すると本日は表示されません。',
				'panel.footDone': '{date} に確認済み。この会話は明日また通知します。',
				'panel.reset': 'もう一度通知',
				'panel.resetPosition': '位置を戻す',
				'panel.error': '状態を読み取れません：{message}（プラグインが有効か確認してください）',
			},
		}

		const CSS = `
.dmr-root{position:fixed;z-index:9000;display:flex;gap:8px;pointer-events:none;font-family:inherit;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary)}
.dmr-root>*{pointer-events:auto}
.dmr-pill{display:flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:18px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);box-shadow:0 4px 14px rgba(15,23,42,.14);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;font:inherit;font-size:12px;line-height:1;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:transform .15s ease,color .15s ease,border-color .15s ease}
.dmr-root[data-dragging="true"] .dmr-pill{cursor:grabbing;box-shadow:0 10px 26px rgba(15,23,42,.28)}
.dmr-root[data-dragging="true"] .dmr-pill:active{transform:none}
.dmr-pill:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dmr-pill:active{transform:scale(.97)}
.dmr-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dmr-root[data-pending="true"] .dmr-pill{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary)}
.dmr-pill svg{width:16px;height:16px;flex:none}
.dmr-pill-label{white-space:nowrap}
.dmr-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);animation:dmr-pulse 2.4s ease-in-out infinite}
.dmr-dot-ok{background:var(--dsw-alias-state-success-primary);animation:none}
@keyframes dmr-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.78)}}
@keyframes dmr-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.dmr-panel{width:min(320px,calc(100vw - 36px));box-sizing:border-box;padding:14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(15,23,42,.22);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:dmr-in .16s ease-out}
.dmr-head{display:flex;align-items:flex-start;gap:8px}
.dmr-head-icon{display:flex;margin-top:1px;color:var(--dsw-alias-state-warn-primary)}
.dmr-head-icon-ok{color:var(--dsw-alias-state-success-primary)}
.dmr-head-icon svg{width:18px;height:18px}
.dmr-head-text{flex:1;min-width:0}
.dmr-title{font-size:13px;font-weight:600}
.dmr-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dmr-x{margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;cursor:pointer;padding:0 2px;border-radius:6px}
.dmr-x:hover{color:var(--dsw-alias-label-primary)}
.dmr-model{margin:12px 0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.dmr-model-provider{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dmr-model-name{font-size:15px;font-weight:600;margin-top:2px;word-break:break-word}
.dmr-model-effort{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dmr-model-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.dmr-actions{display:flex;gap:8px}
.dmr-primary{flex:1;height:32px;border-radius:9px;border:0;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.dmr-primary:disabled{opacity:.6;cursor:default}
.dmr-secondary{height:32px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dmr-secondary:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dmr-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:10px}
.dmr-foot-actions{display:flex;align-items:center;gap:10px;flex:none}
.dmr-reset{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;padding:0;flex:none}
.dmr-reset:hover{color:var(--dsw-alias-label-primary)}
.dmr-reset:disabled{opacity:.6;cursor:default}
.dmr-error{font-size:11px;color:var(--dsw-alias-state-error-primary);margin-top:8px;word-break:break-word}
@media (prefers-reduced-motion:reduce){.dmr-dot{animation:none}.dmr-panel{animation:none}}
`

		/** One style element per page; a second copy of the plugin reuses it. */
		function installStyles() {
			const tagId = 'dsh-model-reminder/widget.css'
			if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {}
			const tag = document.createElement('style')
			tag.dataset.plugin = 'dsh-model-reminder'
			tag.dataset.pluginCss = tagId
			tag.textContent = CSS
			document.head.appendChild(tag)
			return () => {
				tag.remove()
			}
		}

		/** Shield with a chat bubble — the widget's mark, drawn inline so no asset is fetched. */
		function ShieldMark() {
			return h(
				'svg',
				{ viewBox: '0 0 20 20', 'aria-hidden': true, focusable: false },
				h('path', {
					d: 'M10 1.6 3.2 4.3v5.1c0 4.2 2.8 7.6 6.8 9 4-1.4 6.8-4.8 6.8-9V4.3L10 1.6Z',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.5',
					strokeLinejoin: 'round',
				}),
				h('path', {
					d: 'M6.9 8.6h6.2M6.9 11.4h4.2',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.5',
					strokeLinecap: 'round',
				}),
			)
		}

		function CheckMark() {
			return h(
				'svg',
				{ viewBox: '0 0 20 20', 'aria-hidden': true, focusable: false },
				h('circle', { cx: 10, cy: 10, r: 7.4, fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' }),
				h('path', {
					d: 'm6.6 10.3 2.3 2.3 4.5-4.8',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.7',
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
			)
		}

		/** Same-origin read of the Host state document for one Session. */
		async function readState(sessionId) {
			const response = await fetch(`${STATE_URL}?session=${encodeURIComponent(sessionId)}`, {
				credentials: 'same-origin',
				cache: 'no-store',
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		/** Persist one Session's acknowledgement on the Host. */
		async function writeAck(sessionId, date) {
			const response = await fetch(ACK_URL, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, date }),
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		/** Re-arm one Session's reminder through the Host's reset flag. */
		async function resetAck(sessionId) {
			const response = await fetch(ACK_URL, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, reset: true }),
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		/** Read the saved screen position; null means "never moved". */
		async function readPosition() {
			const response = await fetch(POSITION_URL, { credentials: 'same-origin', cache: 'no-store' })
			if (!response.ok) throw new Error('HTTP ' + response.status)
			const data = await response.json()
			return data?.position ?? null
		}

		/** Persist one screen position. */
		async function savePosition(position) {
			const response = await fetch(POSITION_URL, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(position),
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		/** Forget the saved position so the configured corner applies again. */
		async function clearSavedPosition() {
			const response = await fetch(POSITION_URL, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ reset: true }),
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		/**
		 * The Session the window is showing.
		 *
		 * The corner widget lives in the frame-wide `shell.overlay`, which is
		 * root-scoped and therefore receives no Session id. Session-scoped seats do
		 * receive it, so zero-size reporters publish the id and the overlay reads it
		 * here. More than one seat reports because the layout changes: the Session
		 * header (and its utilities) is hidden for a blank Session, while the
		 * composer tool rows stay mounted — so a new conversation still publishes
		 * its id before the first message. The reporters render nothing.
		 *
		 * @module dsh-model-reminder/client/session-seat
		 */
		let activeSessionId = null
		const sessionListeners = new Set()
		/** Each mounted seat's last published id, so one unmount cannot blank another. */
		const sessionSeats = new Map()
		let sessionSeq = 0

		/**
		 * Apply the newest non-null seat id. Called from effects only, so two mounts
		 * cannot disagree about the committed value.
		 * @param {string | null} next - the Session id, or null when none is shown.
		 */
		function applyActiveSession(next) {
			if (activeSessionId === next) return
			activeSessionId = next
			for (const listener of sessionListeners) {
				try {
					listener(next)
				} catch {
					// One broken reader must not starve the others.
				}
			}
		}

		/**
		 * Publish what one seat sees. Seats come and go with the layout, so the
		 * newest surviving seat wins instead of whichever cleanup ran last.
		 * @param {string} seat - stable seat name.
		 * @param {unknown} value - the Session id, or null when this seat shows none.
		 */
		function publishSeat(seat, value) {
			const next = typeof value === 'string' && value.length > 0 ? value : null
			if (next === null) sessionSeats.delete(seat)
			else sessionSeats.set(seat, { id: next, seq: ++sessionSeq })
			let picked = null
			let newest = -1
			for (const entry of sessionSeats.values()) {
				if (entry.seq > newest) {
					newest = entry.seq
					picked = entry.id
				}
			}
			applyActiveSession(picked)
		}

		/** Read the published Session id and re-render when it changes. */
		function useActiveSession() {
			const [id, setId] = useState(activeSessionId)
			useEffect(() => {
				const listener = (value) => setId(value)
				sessionListeners.add(listener)
				setId(activeSessionId)
				return () => {
					sessionListeners.delete(listener)
				}
			}, [])
			return id
		}

		/**
		 * Build an invisible reporter for one session-scoped seat. It takes the id
		 * from its composed slot props (`sessionId`, or a `session` object) and
		 * renders nothing, so the host layout is untouched.
		 * @param {string} seat - stable seat name used by the seat registry.
		 * @returns {(props: object) => null}
		 */
		function createSessionReporter(seat) {
			return function SessionReporter(props) {
				const sessionId =
					typeof props.sessionId === 'string'
						? props.sessionId
						: typeof props.session?.id === 'string'
							? props.session.id
							: null
				useEffect(() => {
					publishSeat(seat, sessionId)
					return () => {
						// Drop only this seat. Another seat still showing the same Session
						// keeps the widget alive (the header is hidden for a blank Session).
						publishSeat(seat, null)
					}
				}, [sessionId])
				return null
			}
		}

		const HeaderReporter = createSessionReporter('header')
		const ComposerReporter = createSessionReporter('composer')

		/**
		 * The corner widget.
		 *
		 * Timing: the panel opens by itself on the first state read of a new local
		 * day, which is the first moment the user can send a message in this page;
		 * it also opens when the page stays open across midnight. There is no
		 * third-party pre-send hook in the Harness, so the reminder sits above the
		 * composer as a pending badge until acknowledged instead of intercepting
		 * the send.
		 */
		function ModelGuard(props) {
			const t = typeof props.t === 'function' ? props.t : (key) => key
			const sessionId = useActiveSession()
			const [state, setState] = useState(null)
			const [open, setOpen] = useState(false)
			const [busy, setBusy] = useState(false)
			const [error, setError] = useState(null)
			const openedFor = useRef(null)
			/** A user-moved screen position, in viewport pixels. */
			const [position, setPosition] = useState(null)
			/** The live position while a drag is in flight; null when idle. */
			const [dragPosition, setDragPosition] = useState(null)
			const [dragging, setDragging] = useState(false)
			/** Measured pill size, so clamping uses the real box instead of a guess. */
			const [meters, setMeters] = useState({ width: 160, height: 36 })
			const [viewport, setViewport] = useState(() => ({
				width: typeof window === 'undefined' ? 1280 : window.innerWidth,
				height: typeof window === 'undefined' ? 800 : window.innerHeight,
			}))
			const pillRef = useRef(null)
			const dragState = useRef(null)
			const dragTarget = useRef(null)
			const justDragged = useRef(false)
			const keySave = useRef(0)

			const refresh = useCallback(async () => {
				if (sessionId === null) {
					setState(null)
					setError(null)
					return null
				}
				try {
					const next = await readState(sessionId)
					setState(next)
					setError(null)
					return next
				} catch (err) {
					setError(err && err.message ? err.message : String(err))
					return null
				}
			}, [sessionId])

			// Switching to another Session starts from a clean slate: its own panel
			// state, its own acknowledgement, its own auto-open. Declared before the
			// polling effect so that effect's first run can reopen for the new Session.
			useEffect(() => {
				setOpen(false)
				openedFor.current = null
			}, [sessionId])

			useEffect(() => {
				let alive = true
				const tick = async () => {
					const next = await refresh()
					if (!alive || next === null) return
					const pending = next.enabled !== false && next.ack !== next.today
					if (pending && openedFor.current !== next.today) {
						openedFor.current = next.today
						setOpen(true)
					}
				}
				tick()
				const timer = setInterval(tick, POLL_MS)
				const onFocus = () => {
					void tick()
				}
				window.addEventListener('focus', onFocus)
				return () => {
					alive = false
					clearInterval(timer)
					window.removeEventListener('focus', onFocus)
				}
			}, [refresh])

			// Measure the pill after every render so clamping and the panel side use
			// the real box (the label length changes with pending/done).
			useLayoutEffect(() => {
				const element = pillRef.current
				if (element === null) return
				const width = element.offsetWidth
				const height = element.offsetHeight
				setMeters((current) => (current.width === width && current.height === height ? current : { width, height }))
			})

			useEffect(() => {
				const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
				window.addEventListener('resize', onResize)
				return () => window.removeEventListener('resize', onResize)
			}, [])

			// A saved position wins over the configured corner from then on.
			useEffect(() => {
				let alive = true
				readPosition()
					.then((saved) => {
						if (alive && saved !== null) setPosition(saved)
					})
					.catch(() => {})
				return () => {
					alive = false
				}
			}, [])

			const acknowledge = useCallback(async () => {
				if (state === null || busy || sessionId === null) return
				setBusy(true)
				try {
					await writeAck(sessionId, state.today)
					const next = await refresh()
					if (next !== null) setOpen(false)
				} catch (err) {
					setError(err && err.message ? err.message : String(err))
				} finally {
					setBusy(false)
				}
			}, [busy, refresh, sessionId, state])

			const toggle = useCallback(() => {
				setOpen((current) => {
					if (!current) void refresh()
					return !current
				})
			}, [refresh])

			/**
			 * Re-arm this Session's reminder through the Host's reset flag.
			 */
			const resetReminder = useCallback(async () => {
				if (busy || sessionId === null) return
				setBusy(true)
				try {
					await resetAck(sessionId)
					const next = await refresh()
					if (next !== null) setOpen(true)
				} catch (err) {
					setError(err && err.message ? err.message : String(err))
				} finally {
					setBusy(false)
				}
			}, [busy, refresh, sessionId])

			// No Session shown (for example the empty start screen): there is nothing to
			// confirm, so the widget stays out of the way.
			if (sessionId === null) return null
			if (state === null && error === null) return null
			if (state !== null && state.enabled === false) return null

			const corner = state?.corner === 'bottom-left' || state?.corner === 'bottom-right' ? state.corner : 'top-right'

			/** Keep the pill fully inside the viewport with an 8px breathing margin. */
			const clampPosition = (x, y) => {
				const margin = 8
				const maxX = Math.max(margin, viewport.width - meters.width - margin)
				const maxY = Math.max(margin, viewport.height - meters.height - margin)
				return { x: Math.min(Math.max(x, margin), maxX), y: Math.min(Math.max(y, margin), maxY) }
			}

			const defaultPosition =
				corner === 'bottom-left'
					? { x: 16, y: viewport.height - meters.height - 18 }
					: corner === 'bottom-right'
						? { x: viewport.width - meters.width - 18, y: viewport.height - meters.height - 118 }
						: { x: viewport.width - meters.width - 16, y: 52 }
			const seed = dragPosition ?? position ?? defaultPosition
			const placed = clampPosition(seed.x, seed.y)
			// Anchor by the edge the widget sits near, so the wider panel always opens
			// toward the middle of the window instead of off-screen.
			const anchorRight = placed.x + meters.width / 2 > viewport.width / 2
			const flipUp = placed.y + meters.height / 2 > viewport.height / 2
			const rootStyle = {
				top: placed.y + 'px',
				left: anchorRight ? 'auto' : placed.x + 'px',
				right: anchorRight ? Math.max(0, viewport.width - placed.x - meters.width) + 'px' : 'auto',
				flexDirection: flipUp ? 'column' : 'column-reverse',
				alignItems: anchorRight ? 'flex-end' : 'flex-start',
			}

			const onPointerDown = (event) => {
				if (event.button !== undefined && event.button !== 0) return
				dragState.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					originX: placed.x,
					originY: placed.y,
					moved: false,
				}
				dragTarget.current = placed
				try {
					event.currentTarget.setPointerCapture(event.pointerId)
				} catch {
					// Pointer capture is best-effort; window-level move still works.
				}
			}

			const onPointerMove = (event) => {
				const drag = dragState.current
				if (drag === null || drag.pointerId !== event.pointerId) return
				const dx = event.clientX - drag.startX
				const dy = event.clientY - drag.startY
				if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
				if (!drag.moved) {
					drag.moved = true
					// A drag is a move, not a click: close the panel so the pill is the
					// only thing following the pointer.
					setOpen(false)
					setDragging(true)
				}
				event.preventDefault()
				const next = clampPosition(drag.originX + dx, drag.originY + dy)
				dragTarget.current = next
				setDragPosition(next)
			}

			const endDrag = (event) => {
				const drag = dragState.current
				if (drag === null || drag.pointerId !== event.pointerId) return
				dragState.current = null
				setDragging(false)
				if (!drag.moved) return
				justDragged.current = true
				window.setTimeout(() => {
					justDragged.current = false
				}, 350)
				const next = dragTarget.current
				if (next === null) return
				setPosition(next)
				setDragPosition(null)
				void savePosition(next).catch(() => {})
			}

			const onPillClick = () => {
				// The click that ends a drag must not toggle the panel.
				if (justDragged.current) {
					justDragged.current = false
					return
				}
				toggle()
			}

			/** Arrow keys move the focused pill by 10px (1px with Shift). */
			const onPillKeyDown = (event) => {
				const step = event.shiftKey ? 1 : 10
				const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
				const delta = deltas[event.key]
				if (delta === undefined) return
				event.preventDefault()
				const next = clampPosition(placed.x + delta[0], placed.y + delta[1])
				setPosition(next)
				setDragPosition(null)
				window.clearTimeout(keySave.current)
				keySave.current = window.setTimeout(() => {
					void savePosition(next).catch(() => {})
				}, 500)
			}

			/** Drop the custom position so the configured corner applies again. */
			const resetPosition = () => {
				setPosition(null)
				setDragPosition(null)
				void clearSavedPosition().catch((err) => {
					setError(err && err.message ? err.message : String(err))
				})
			}

			const pending = state === null ? true : state.ack !== state.today
			const selection = state?.selection ?? null
			const providerName = selection === null ? '' : selection.providerName || selection.provider || t('panel.providerUnknown')
			const modelName = selection === null ? '' : selection.modelName || selection.model || t('panel.modelUnknown')
			const effort = selection === null ? null : selection.reasoningEffort
			const pillTitle = error !== null ? t('pill.titleError') : t('pill.title')

			const header = h(
				'div',
				{ className: 'dmr-head' },
				h('span', { className: pending ? 'dmr-head-icon' : 'dmr-head-icon dmr-head-icon-ok' }, pending ? h(ShieldMark) : h(CheckMark)),
				h(
					'div',
					{ className: 'dmr-head-text' },
					h('div', { className: 'dmr-title' }, pending ? t('panel.title') : t('panel.titleDone')),
					h('div', { className: 'dmr-sub' }, pending ? t('panel.sub') : t('panel.subDone')),
				),
				h('button', { className: 'dmr-x', type: 'button', 'aria-label': t('panel.close'), onClick: () => setOpen(false) }, '×'),
			)

			const modelBlock = h(
				'div',
				{ className: 'dmr-model' },
				h('div', { className: 'dmr-model-provider' }, providerName || t('panel.providerUnknown')),
				h('div', { className: 'dmr-model-name' }, modelName || t('panel.modelUnknown')),
				effort === null ? null : h('div', { className: 'dmr-model-effort' }, t('panel.effort', { effort })),
				selection === null ? h('div', { className: 'dmr-model-hint' }, t('panel.modelUnknownHint')) : null,
			)

			const actions = pending
				? h(
						'div',
						{ className: 'dmr-actions' },
						h('button', { className: 'dmr-primary', type: 'button', disabled: busy, onClick: acknowledge }, busy ? t('panel.confirming') : t('panel.confirm')),
						h('button', { className: 'dmr-secondary', type: 'button', onClick: () => setOpen(false) }, t('panel.later')),
					)
				: null

			const footer = h(
				'div',
				{ className: 'dmr-foot' },
				h('span', null, pending ? t('panel.foot') : t('panel.footDone', { date: state?.ack ?? '' })),
				h(
					'span',
					{ className: 'dmr-foot-actions' },
					position === null
						? null
						: h('button', { className: 'dmr-reset', type: 'button', onClick: resetPosition }, t('panel.resetPosition')),
					pending ? null : h('button', { className: 'dmr-reset', type: 'button', disabled: busy, onClick: resetReminder }, t('panel.reset')),
				),
			)
			const errorLine = error === null ? null : h('div', { className: 'dmr-error' }, t('panel.error', { message: error }))

			return h(
				'div',
				{
					className: 'dmr-root',
					'data-pending': pending ? 'true' : 'false',
					'data-dragging': dragging ? 'true' : 'false',
					style: rootStyle,
				},
				open
					? h(
							'div',
							{ className: 'dmr-panel', role: 'dialog', 'aria-label': t('panel.title') },
							header,
							modelBlock,
							actions,
							footer,
							errorLine,
						)
					: null,
				h(
					'button',
					{
						ref: pillRef,
						className: 'dmr-pill',
						type: 'button',
						title: pillTitle,
						'aria-label': pillTitle,
						onClick: onPillClick,
						onPointerDown,
						onPointerMove,
						onPointerUp: endDrag,
						onPointerCancel: endDrag,
						onKeyDown: onPillKeyDown,
						onDragStart: (event) => event.preventDefault(),
					},
					h(ShieldMark),
					h('span', { className: 'dmr-pill-label' }, pending ? t('pill.pending') : t('pill.done')),
					h('span', { className: pending ? 'dmr-dot' : 'dmr-dot dmr-dot-ok' }),
				),
			)
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				ctx.effect(installStyles, 'dsh-model-reminder: styles')
				ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-model-reminder: locale')
				const t = ctx.locale.bind(NS)
				// A stable component type per registration: the owner mounts it once and
				// the widget keeps its own polling/panel state across slot re-renders.
				const Seated = () => h(ModelGuard, { t })
				ctx.slots.inject('shell.overlay', () =>
					ctx.slots.register({ name: 'shell.overlay', id: 'model-reminder', order: 40 }, Seated),
				)
				// The frame-wide overlay is root-scoped and receives no Session id. These
				// session-scoped seats render nothing and publish the id, so the
				// acknowledgement and the model are always for the Session on screen.
				// Two seats are needed: the header utilities are hidden while a Session is
				// still blank (a brand-new conversation), and the composer tool row is
				// not. Seats publish into a small registry, so one unmount cannot hide the
				// widget while another seat still shows a Session.
				ctx.slots.inject('conversation.session.header.utilities', () =>
					ctx.slots.register(
						{ name: 'conversation.session.header.utilities', id: 'model-reminder-session', order: 1000 },
						HeaderReporter,
					),
				)
				ctx.slots.inject('conversation.input.left', () =>
					ctx.slots.register({ name: 'conversation.input.left', id: 'model-reminder-composer', order: 1000 }, ComposerReporter),
				)
			},
		}
	},
})
