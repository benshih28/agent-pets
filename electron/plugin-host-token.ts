export function isCurrentPluginRuntimeToken(activeToken: unknown, requestToken: unknown): boolean {
  return typeof activeToken === 'string' && activeToken.length > 0 && requestToken === activeToken
}

export type CurrentPluginRpcResult = { current: true; value: unknown } | { current: false }

export async function runPluginRpcForCurrentToken(
  getCurrentToken: () => unknown,
  requestToken: string,
  run: () => Promise<unknown> | unknown,
): Promise<CurrentPluginRpcResult> {
  if (!isCurrentPluginRuntimeToken(getCurrentToken(), requestToken)) return { current: false }
  await Promise.resolve()
  if (!isCurrentPluginRuntimeToken(getCurrentToken(), requestToken)) return { current: false }
  const value = await run()
  return isCurrentPluginRuntimeToken(getCurrentToken(), requestToken)
    ? { current: true, value }
    : { current: false }
}
