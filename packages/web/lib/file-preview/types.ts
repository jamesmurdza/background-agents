/**
 * Shared types for file preview components
 */

export type FileType = 'image' | 'pdf' | 'text' | 'code' | 'other'

/**
 * Map file extensions to highlight.js language names.
 * Unknown extensions fall back to auto-detection.
 */
export const EXT_TO_LANG: Record<string, string> = {
  // JavaScript/TypeScript
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",

  // Data formats
  json: "json", jsonc: "json", jsonl: "json", ndjson: "json",

  // Markup/Templates
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml", svelte: "xml",

  // Styles
  css: "css", scss: "scss", sass: "scss", less: "less",

  // Backend languages
  py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", kt: "kotlin", swift: "swift", scala: "scala",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", php: "php",

  // Shell
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", ps1: "powershell",

  // Config
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", conf: "ini", env: "ini",

  // Documentation
  md: "markdown", markdown: "markdown", mdx: "markdown",

  // Database/Query
  sql: "sql", graphql: "graphql", gql: "graphql", prisma: "prisma",

  // Build/DevOps
  dockerfile: "dockerfile",

  // Other
  r: "r", lua: "lua", pl: "perl", dart: "dart",
  diff: "diff", patch: "diff",
  proto: "protobuf",
}

/**
 * Code file extensions (for determining FileType)
 */
export const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'swift', 'kt', 'scala',
  'sh', 'bash', 'zsh', 'ps1', 'sql',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'json', 'jsonc', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env',
  'md', 'mdx', 'vue', 'svelte',
  'graphql', 'gql', 'prisma', 'proto',
  'dockerfile', 'makefile', 'cmake', 'gradle', 'properties', 'plist', 'lock',
]

/**
 * Image file extensions mapped to their MIME content types.
 * Single source of truth for both client-side type detection and
 * server-side content-type headers.
 */
export const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
}

/**
 * Image file extensions (for determining FileType)
 */
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_TYPES)

/**
 * Plain text file extensions (for determining FileType)
 */
export const TEXT_EXTENSIONS = [
  'txt', 'log', 'csv', 'tsv', 'rtf',
  'gitignore', 'dockerignore', 'editorconfig', 'eslintrc', 'prettierrc', 'babelrc', 'npmrc', 'nvmrc',
]

/**
 * Format file size in human-readable format (B, KB, MB)
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
