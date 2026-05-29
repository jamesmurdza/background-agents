import CryptoJS from "crypto-js"

const IS_PRODUCTION = process.env.NODE_ENV === "production"
const IS_BUILD_TIME = process.env.NEXT_PHASE === "phase-production-build"

// In production we require an explicit ENCRYPTION_KEY. In dev/build we fall
// back to a known constant so the AES code paths always run (no silent
// plaintext storage) without forcing every dev to generate a key.
const DEV_DEFAULT_KEY = "dev-only-encryption-key-not-for-production"

const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ??
  (IS_PRODUCTION && !IS_BUILD_TIME ? undefined : DEV_DEFAULT_KEY)

if (!ENCRYPTION_KEY && IS_PRODUCTION && !IS_BUILD_TIME) {
  // Fail loudly at module load. Storing user API keys in plaintext is not
  // an acceptable production fallback. We skip this check at build time
  // since the key isn't needed to compile the application.
  throw new Error(
    "ENCRYPTION_KEY environment variable is required in production"
  )
}

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY!).toString()
}

export function decrypt(ciphertext: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY!)
    const decrypted = bytes.toString(CryptoJS.enc.Utf8)
    // If decryption fails (wrong key or value isn't actually encrypted),
    // return the original — same shape as the prior plaintext fallback.
    return decrypted || ciphertext
  } catch {
    return ciphertext
  }
}
