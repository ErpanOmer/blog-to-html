export const DEFAULT_BACKEND_PORT: number
export const DEFAULT_FRONTEND_PORT: number

export function getBackendPort(env?: NodeJS.ProcessEnv): number
export function getFrontendPort(env?: NodeJS.ProcessEnv): number
