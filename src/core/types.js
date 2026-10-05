/**
 * Спільні JSDoc-типи. Файл не містить коду — лише описи для `npm run typecheck`
 * та підказок у редакторі.
 */

/**
 * @typedef {object} Server
 * @property {string} id
 * @property {string} name
 * @property {string} pingUrl     GET, порожня відповідь
 * @property {string} downloadUrl GET ?bytes=N
 * @property {string} uploadUrl   POST
 * @property {string} [metaUrl]   GET JSON з IP/провайдером/містом
 */

/**
 * @typedef {object} ThroughputSettings
 * @property {number} durationMs
 * @property {number} streams
 * @property {number} initialBytes
 * @property {number} maxBytes
 * @property {number} targetRequestMs
 * @property {number} [maxRequestMs]
 * @property {boolean} abortAtDeadline
 * @property {number} [graceMs]
 */

/**
 * @typedef {object} LatencySummary
 * @property {number} min
 * @property {number} max
 * @property {number} avg
 * @property {number} median
 * @property {number} jitter
 * @property {number} loss       %
 * @property {number[]} [samples]
 */

/**
 * @typedef {object} ThroughputResult
 * @property {number} mbps
 * @property {number} bytes
 * @property {number} durationMs
 * @property {number[]} speeds
 * @property {{ t: number, mbps: number }[]} series
 * @property {LatencySummary} loadedLatency
 */

/**
 * @typedef {object} TestResult
 * @property {number} [id]
 * @property {number} timestamp
 * @property {number} durationMs
 * @property {{ id: string, name: string, latency?: number }} server
 * @property {LatencySummary} ping
 * @property {ThroughputResult} download
 * @property {ThroughputResult} upload
 * @property {{ delta: number, grade: string }} bufferbloat
 * @property {{ score: number, grade: string, penalties: Record<string, number> }} stability
 * @property {Record<string, boolean>} useCases
 */

/**
 * @typedef {'ping' | 'download' | 'upload'} Phase
 * @typedef {(url: string, body: Blob, onBytes: (n: number) => void, signal: AbortSignal) => Promise<void>} UploadFn
 */

export {};
