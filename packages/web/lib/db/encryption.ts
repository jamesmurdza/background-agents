import CryptoJS from "crypto-js"

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
const IS_PRODUCTION = process.env.NODE_ENV === "production"
const IS_BUILD_TIME = process.env.NEXT_PHASE === "phase-production-build"

if (!ENCRYPTION_KEY && IS_PRODUCTION && !IS_BUILD_TIME) {
  // Fail loudly at module load. Storing user API keys in plaintext is not
  // an acceptable production fallback. We skip this check at build time
  // since the key isn't needed to compile the application.
  throw new Error(
    "ENCRYPTION_KEY environment variable is required in production"
  )
}

export function encrypt(text: string): string {
  if (!ENCRYPTION_KEY) {
    // Development only — see module-load check above.
    return text
  }
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString()
}

export function decrypt(ciphertext: string): string {
  if (!ENCRYPTION_KEY) {
    return ciphertext
  }
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY)
    const decrypted = bytes.toString(CryptoJS.enc.Utf8)
    // If decryption fails (wrong key or not encrypted), return original
    return decrypted || ciphertext
  } catch {
    return ciphertext
  }
}

// Encrypt all credential fields in an object
export function encryptCredentials(credentials: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (value) {
      encrypted[key] = encrypt(value)
    }
  }
  return encrypted
}

// Decrypt all credential fields in an object
export function decryptCredentials(credentials: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (value) {
      decrypted[key] = decrypt(value)
    }
  }
  return decrypted
}
