/**
 * dsh-model-reminder — Host half.
 *
 * Two things live here:
 *
 *   1. `/api/model-reminder/state?session=<id>` — the browser widget's only data
 *      source. It reports the *Session's* current model selection (the one that
 *      session's composer will use for the next message), the display names
 *      resolved from the LLM catalog, today's local date, and whether that
 *      session was already acknowledged today.
 *   2. `/api/model-reminder/ack` — persists one acknowledgement per Session per
 *      calendar day in `$DSH_HOME/dsh-model-reminder/ack.json`, so another window
 *      or a restart does not ask the same session again on the same day, while a
 *      different session still gets its own reminder.
 *
 * Both routes ride `ctx.connection.fetch`, the shared browser channel: Harness
 * authentication, Host/Origin admission and request middleware apply, and the
 * widget only needs same-origin `fetch`.
 *
 * @module dsh-model-reminder
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Exact route paths the browser half talks to. */
const STATE_PATH = '/api/model-reminder/state'
const ACK_PATH = '/api/model-reminder/ack'
const POSITION_PATH = '/api/model-reminder/position'

/** Mutable user data belongs in DSH home, never in the installed package. */
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const ACK_FILE = path.join(DSH_HOME, 'dsh-model-reminder', 'ack.json')
/** The widget's own screen position, independent of any Session. */
const POSITION_FILE = path.join(DSH_HOME, 'dsh-model-reminder', 'position.json')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const NAME_CACHE_TTL_MS = 30_000
/** Acknowledgements older than this are dropped on the next write. */
const ACK_RETENTION_DAYS = 7
/** Hard cap so a long-lived installation cannot grow the file without bound. */
const ACK_MAX_ENTRIES = 200
/** The browser re-arms a session by writing this past date. */
const RESET_DATE = '2000-01-01'

/** `connection` is a core Host service; the routes need it before anything else. */
export const inject = ['connection']

/**
 * Format a Date as the local calendar date, which is what "每天第一次" means.
 * @param {Date} date - the date to format.
 * @returns {string} `YYYY-MM-DD`.
 */
function formatDay(date) {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

/**
 * The local calendar date today.
 * @param {Date} [now] - injectable clock for tests.
 * @returns {string} `YYYY-MM-DD`.
 */
function todayLocal(now = new Date()) {
	return formatDay(now)
}

/**
 * Read the whole acknowledgement file. Anything malformed is treated as "no
 * acknowledgements"; a legacy `{ date }` file from 0.1.0 carries no Session id
 * and is deliberately ignored, because a global acknowledgement must not
 * silence a Session-specific reminder.
 * @returns {{ sessions: Record<string, { date: string, at?: number }> }}
 */
function readAcks() {
	try {
		const parsed = JSON.parse(fs.readFileSync(ACK_FILE, 'utf8'))
		const sessions = parsed?.sessions
		if (sessions === null || typeof sessions !== 'object' || Array.isArray(sessions)) return { sessions: {} }
		/** @type {Record<string, { date: string, at?: number }>} */
		const clean = {}
		for (const [sessionId, entry] of Object.entries(sessions)) {
			if (!SESSION_PATTERN.test(sessionId)) continue
			if (entry === null || typeof entry !== 'object') continue
			if (typeof entry.date !== 'string' || !DATE_PATTERN.test(entry.date)) continue
			clean[sessionId] = {
				date: entry.date,
				...(typeof entry.at === 'number' ? { at: entry.at } : {}),
			}
		}
		return { sessions: clean }
	} catch {
		return { sessions: {} }
	}
}

/**
 * Keep only recent entries, then cap the total. Returns a new object.
 * @param {Record<string, { date: string, at?: number }>} sessions - all entries.
 * @param {string} today - `YYYY-MM-DD`.
 * @returns {Record<string, { date: string, at?: number }>}
 */
function pruneSessions(sessions, today) {
	const todayDate = new Date(`${today}T00:00:00`)
	const cutoffDate = new Date(todayDate)
	cutoffDate.setDate(cutoffDate.getDate() - ACK_RETENTION_DAYS)
	const cutoff = formatDay(cutoffDate)
	const kept = Object.entries(sessions)
		.filter(([, entry]) => entry.date >= cutoff)
		.sort((left, right) => (right[1].at ?? 0) - (left[1].at ?? 0))
		.slice(0, ACK_MAX_ENTRIES)
	return Object.fromEntries(kept)
}

/**
 * Persist one Session's acknowledged date atomically, so a crash cannot leave a
 * torn file.
 * @param {string} sessionId - the owning Session.
 * @param {string} date - `YYYY-MM-DD`.
 */
function writeAck(sessionId, date) {
	const today = todayLocal()
	const { sessions } = readAcks()
	sessions[sessionId] = { date, at: Date.now() }
	const document = { sessions: pruneSessions(sessions, today) }
	fs.mkdirSync(path.dirname(ACK_FILE), { recursive: true })
	const temporary = `${ACK_FILE}.tmp`
	fs.writeFileSync(temporary, JSON.stringify(document, null, 2), 'utf8')
	fs.renameSync(temporary, ACK_FILE)
}

/**
 * Normalize a Host selection into the exact shape the widget renders.
 * @param {unknown} selection - a `ModelSelection`-like value.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | null}
 */
function normalizeSelection(selection) {
	if (selection === null || typeof selection !== 'object') return null
	const value = /** @type {{ provider?: unknown, model?: unknown, reasoningEffort?: unknown }} */ (selection)
	if (typeof value.provider !== 'string' || typeof value.model !== 'string') return null
	return {
		provider: value.provider,
		model: value.model,
		...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
	}
}

/**
 * The deployment default, used when a Session has no projection yet (a brand-new
 * blank Session) or when no Session id was supplied.
 * @param {import('cordis').Context} ctx - plugin context.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | null}
 */
function defaultSelection(ctx) {
	try {
		return normalizeSelection(ctx.get('agentDefaultModel')?.currentSelection?.())
	} catch {
		return null
	}
}

/**
 * Resolve the selection one Session's next prompt will use: its durable
 * `modelSelection` projection (`next`, else `lastUsed`), falling back to the
 * deployment default for Sessions that never chose.
 * @param {import('cordis').Context} ctx - plugin context.
 * @param {string | null} sessionId - the Session shown by the browser.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | null}
 */
function resolveSelection(ctx, sessionId) {
	if (sessionId !== null) {
		try {
			const sessions = ctx.get('sessions')
			const projections = ctx.get('sessionProjections')
			const session = sessions?.get?.(sessionId)
			if (session !== undefined && projections !== undefined) {
				const snapshot = projections.snapshot(session, ['modelSelection'])
				const selection = snapshot?.values?.modelSelection
				const picked = normalizeSelection(selection?.next ?? selection?.lastUsed)
				if (picked !== null) return picked
			}
		} catch {
			// A projection read must never fail the request; fall through.
		}
	}
	return defaultSelection(ctx)
}

/** Resolved display names per provider/model pair; the catalog is slow and stable. */
const nameCache = new Map()

/**
 * Resolve localized provider/model names from the LLM catalog, falling back to
 * the raw IDs so the widget never renders an empty model name.
 * @param {import('cordis').Context} ctx - plugin context.
 * @param {{ provider: string, model: string }} selection - exact IDs.
 * @returns {Promise<{ providerName: string, modelName: string, badge: unknown }>}
 */
async function describeSelection(ctx, selection) {
	const key = `${selection.provider}\u0000${selection.model}`
	const cached = nameCache.get(key)
	if (cached !== undefined && Date.now() - cached.at < NAME_CACHE_TTL_MS) return cached

	const info = {
		at: Date.now(),
		providerName: selection.provider,
		modelName: selection.model,
		badge: null,
	}
	try {
		const llm = ctx.get('llm')
		if (llm) {
			try {
				const providers = await llm.listProviders()
				const provider = Array.isArray(providers) ? providers.find((entry) => entry?.id === selection.provider) : undefined
				if (typeof provider?.name === 'string' && provider.name.length > 0) info.providerName = provider.name
			} catch {
				// Keep the raw provider id.
			}
			try {
				const models = await llm.listModels(selection.provider)
				const model = Array.isArray(models) ? models.find((entry) => entry?.id === selection.model) : undefined
				if (model) {
					if (typeof model.name === 'string' && model.name.length > 0) info.modelName = model.name
					if (model.badge !== undefined && model.badge !== null) info.badge = model.badge
				}
			} catch {
				// Keep the raw model id.
			}
		}
	} catch {
		// The LLM service is optional for this widget.
	}
	nameCache.set(key, info)
	return info
}

/**
 * Read a Session id from the request query string.
 * @param {Request} request - the shared-channel Request.
 * @returns {string | null}
 */
function sessionOf(request) {
	try {
		const value = new URL(request.url).searchParams.get('session')
		return typeof value === 'string' && SESSION_PATTERN.test(value) ? value : null
	} catch {
		return null
	}
}

/**
 * Build the state document the widget polls.
 * @param {import('cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} config - the row's `config`.
 * @param {string | null} sessionId - the Session the browser is showing.
 * @returns {Promise<object>}
 */
async function stateDocument(ctx, config, sessionId) {
	const enabled = config?.enabled !== false
	const corner = config?.corner === 'bottom-left' || config?.corner === 'bottom-right' ? config.corner : 'top-right'
	const today = todayLocal()
	const ack = sessionId === null ? null : readAcks().sessions[sessionId]?.date ?? null
	const selection = resolveSelection(ctx, sessionId)
	const info = selection === null ? null : await describeSelection(ctx, selection)
	return {
		ok: true,
		enabled,
		corner,
		session: sessionId,
		today,
		ack,
		pending: enabled && sessionId !== null && ack !== today,
		selection:
			selection === null
				? null
				: {
						provider: selection.provider,
						model: selection.model,
						reasoningEffort: selection.reasoningEffort ?? null,
						providerName: info?.providerName ?? selection.provider,
						modelName: info?.modelName ?? selection.model,
						badge: info?.badge ?? null,
					},
		at: Date.now(),
	}
}

/**
 * Persist the browser's acknowledgement for one Session. The Session id and the
 * date are re-validated here because the route is reachable from any page.
 * @param {Request} request - the shared-channel Request.
 * @returns {Promise<object>}
 */
async function acknowledge(request) {
	let payload = null
	try {
		payload = await request.json()
	} catch {
		// An empty body has nothing to acknowledge.
	}
	const sessionId = typeof payload?.sessionId === 'string' && SESSION_PATTERN.test(payload.sessionId) ? payload.sessionId : null
	if (sessionId === null) {
		return { ok: false, error: 'model-reminder: a valid sessionId is required' }
	}
	const requested = payload?.reset === true ? RESET_DATE : payload?.date
	const date = typeof requested === 'string' && DATE_PATTERN.test(requested) ? requested : todayLocal()
	writeAck(sessionId, date)
	return { ok: true, sessionId, ack: date }
}

/**
 * Read the widget's saved screen position.
 * @returns {{ x: number, y: number } | null}
 */
function readPosition() {
	try {
		const parsed = JSON.parse(fs.readFileSync(POSITION_FILE, 'utf8'))
		if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return { x: parsed.x, y: parsed.y }
	} catch {
		// No saved position is the normal first-run case.
	}
	return null
}

/**
 * Persist the widget's screen position atomically.
 * @param {{ x: number, y: number }} position - viewport pixels.
 */
function writePosition(position) {
	fs.mkdirSync(path.dirname(POSITION_FILE), { recursive: true })
	const temporary = `${POSITION_FILE}.tmp`
	fs.writeFileSync(temporary, JSON.stringify(position, null, 2), 'utf8')
	fs.renameSync(temporary, POSITION_FILE)
}

/** Drop the saved position so the widget returns to its configured corner. */
function clearPosition() {
	try {
		fs.rmSync(POSITION_FILE, { force: true })
	} catch {
		// A missing file is already the desired state.
	}
}

/**
 * GET returns the saved position; POST saves one or resets it.
 * @param {Request} request - the shared-channel Request.
 * @returns {Promise<object>}
 */
async function positionDocument(request) {
	if (request.method !== 'POST') return { ok: true, position: readPosition() }
	let payload = null
	try {
		payload = await request.json()
	} catch {
		// An empty body is invalid for a write.
	}
	if (payload?.reset === true) {
		clearPosition()
		return { ok: true, position: null }
	}
	const x = Number(payload?.x)
	const y = Number(payload?.y)
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return { ok: false, error: 'model-reminder: x and y must be finite numbers' }
	}
	const position = {
		x: Math.min(Math.max(x, -100_000), 100_000),
		y: Math.min(Math.max(y, -100_000), 100_000),
	}
	writePosition(position)
	return { ok: true, position }
}

/**
 * Register the widget's data routes.
 * @param {import('cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} rawConfig - the Loader row's `config`.
 */
export function apply(ctx, rawConfig) {
	const config = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
	ctx.effect(
		() =>
			ctx.connection.fetch.register({
				path: STATE_PATH,
				methods: ['GET'],
				requestBody: 'buffered',
				fetch: async (request) => Response.json(await stateDocument(ctx, config, sessionOf(request))),
			}),
		'dsh-model-reminder: state route',
	)
	ctx.effect(
		() =>
			ctx.connection.fetch.register({
				path: ACK_PATH,
				methods: ['POST'],
				requestBody: 'buffered',
				fetch: async (request) => Response.json(await acknowledge(request)),
			}),
		'dsh-model-reminder: acknowledgement route',
	)
	ctx.effect(
		() =>
			ctx.connection.fetch.register({
				path: POSITION_PATH,
				methods: ['GET', 'POST'],
				requestBody: 'buffered',
				fetch: async (request) => Response.json(await positionDocument(request)),
			}),
		'dsh-model-reminder: position route',
	)
}
