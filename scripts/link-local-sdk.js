const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const localSdkPath = "/Users/jamie/codeagentsdk"
const targetDir = path.join(root, "node_modules", "@jamesmurdza")
const linkPath = path.join(targetDir, "coding-agents-sdk")

if (!fs.existsSync(localSdkPath)) {
  console.error("[link-local-sdk] Not found:", localSdkPath)
  process.exit(1)
}

if (fs.existsSync(linkPath)) {
  const stat = fs.lstatSync(linkPath)
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(linkPath)
  } else {
    fs.rmSync(linkPath, { recursive: true, force: true })
  }
}
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true })
}

fs.symlinkSync(localSdkPath, linkPath)
console.log("[link-local-sdk] Linked to", localSdkPath)
