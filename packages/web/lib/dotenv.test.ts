/**
 * Tests for bulk-importing env vars from pasted text / uploaded .env files.
 */
import { describe, it, expect } from "vitest"

import { parseDotEnv, mergeEnvEntries } from "./dotenv"

describe("parseDotEnv", () => {
  it("parses a typical .env file", () => {
    const text = [
      "# Database",
      "DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require",
      "",
      "export API_KEY = sk-123 # inline comment",
      "SINGLE='literal $value # not a comment'",
      'DOUBLE="line1\\nline2 \\"quoted\\""',
      "EMPTY=",
      "BASE64=abc123==",
      'MULTI="-----BEGIN KEY-----',
      "abc",
      '-----END KEY-----"',
      "not a valid line",
      "WIN=crlf\r",
    ].join("\n")

    expect(parseDotEnv(text)).toEqual([
      { key: "DATABASE_URL", value: "postgres://user:pass@host:5432/db?sslmode=require" },
      { key: "API_KEY", value: "sk-123" },
      { key: "SINGLE", value: "literal $value # not a comment" },
      { key: "DOUBLE", value: 'line1\nline2 "quoted"' },
      { key: "EMPTY", value: "" },
      { key: "BASE64", value: "abc123==" },
      { key: "MULTI", value: "-----BEGIN KEY-----\nabc\n-----END KEY-----" },
      { key: "WIN", value: "crlf" },
    ])
  })

  it("ignores text with no assignments", () => {
    expect(parseDotEnv("just some value")).toEqual([])
  })
})

describe("mergeEnvEntries", () => {
  it("updates existing keys, appends new ones and drops blank rows", () => {
    let n = 0
    const existing = [
      { id: "a", key: "FOO", value: "1" },
      { id: "b", key: "", value: "" },
      { id: "c", key: "BAR", value: "2" },
    ]
    const result = mergeEnvEntries(
      existing,
      [
        { key: "BAR", value: "3" },
        { key: "NEW", value: "x" },
        { key: "NEW", value: "y" },
        { key: "FOO", value: "1" },
      ],
      (e) => ({ id: `new${n++}`, ...e }),
    )
    expect(result.vars).toEqual([
      { id: "a", key: "FOO", value: "1" },
      { id: "c", key: "BAR", value: "3" },
      { id: "new0", key: "NEW", value: "y" },
    ])
    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)
  })
})
