const bytesToHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** PBKDF2-SHA256 con la Web Crypto API. Se usa para el PIN (sal = id del perfil) y para las contraseñas del modo local. */
export async function pbkdf2(secret: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100_000 },
    key,
    256,
  )
  return bytesToHex(bits)
}
