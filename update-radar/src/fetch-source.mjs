import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_SOURCE_BYTES,
  isAllowedSourceUrl,
} from './config.mjs'

function safeErrorMessage(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'request_timeout'
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message)) return error.message.toLowerCase().replace(' ', '_')
  return 'source_unavailable'
}

export async function fetchOfficialSource(initialUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const requestHeaders = options.headers ?? {}
  let currentUrl = initialUrl

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (!isAllowedSourceUrl(currentUrl)) throw new Error('source_url_not_allowed')

    let response
    try {
      response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: 'text/markdown, application/json;q=0.9, text/plain;q=0.8',
          'user-agent': 'Agent-Pets-Update-Radar/0.1',
          ...requestHeaders,
        },
      })
    } catch (error) {
      throw new Error(safeErrorMessage(error))
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirectCount === maxRedirects) throw new Error('redirect_rejected')
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
      throw new Error('source_too_large')
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('source_too_large')

    return {
      body: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      contentType: response.headers.get('content-type') ?? '',
      finalUrl: currentUrl,
    }
  }

  throw new Error('redirect_rejected')
}
