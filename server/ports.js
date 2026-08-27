/**
 * Shared local-server port configuration.
 *
 * Environment variables are deliberately read only when a process starts, so
 * changing either value requires restarting both the Vite and Express servers.
 */
export const DEFAULT_BACKEND_PORT = 38471
export const DEFAULT_FRONTEND_PORT = 38472

function parsePort(value, variableName) {
  if (value === undefined || value === '') return undefined

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${variableName} 必须是 1024 到 65535 之间的整数`)
  }
  return port
}

export function getBackendPort(env = process.env) {
  return parsePort(env.BACKEND_PORT ?? env.PORT, 'BACKEND_PORT（或 PORT）') ?? DEFAULT_BACKEND_PORT
}

export function getFrontendPort(env = process.env) {
  return parsePort(env.FRONTEND_PORT, 'FRONTEND_PORT') ?? DEFAULT_FRONTEND_PORT
}
