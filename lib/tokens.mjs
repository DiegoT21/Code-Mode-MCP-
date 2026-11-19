// Estimación de tokens. No hay un contador oficial sin conexión (el exacto es el endpoint count_tokens de
// la API, que pide una clave): se usa la regla práctica de ~3.5 caracteres por token, que para texto en
// inglés y JSON queda cerca de lo real. Todo lo que muestra el panel con «≈» sale de aquí.

export const CARACTERES_POR_TOKEN = 3.5

export function tokens(texto) {
  if (texto == null) return 0
  const s = typeof texto === 'string' ? texto : JSON.stringify(texto)
  return Math.ceil(s.length / CARACTERES_POR_TOKEN)
}
