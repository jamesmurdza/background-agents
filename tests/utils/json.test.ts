import { describe, it, expect } from "vitest"
import { safeJsonParse } from "../../src/utils/json.js"

describe("safeJsonParse", () => {
  it("should parse valid JSON", () => {
    const result = safeJsonParse('{"type": "test", "value": 123}')
    expect(result).toEqual({ type: "test", value: 123 })
  })

  it("should return null for invalid JSON", () => {
    const result = safeJsonParse("not json")
    expect(result).toBeNull()
  })

  it("should return null for empty string", () => {
    const result = safeJsonParse("")
    expect(result).toBeNull()
  })

  it("should parse JSON arrays", () => {
    const result = safeJsonParse('[1, 2, 3]')
    expect(result).toEqual([1, 2, 3])
  })

  it("should parse null value", () => {
    const result = safeJsonParse("null")
    expect(result).toBeNull()
  })

  it("should parse primitive values", () => {
    expect(safeJsonParse("123")).toBe(123)
    expect(safeJsonParse('"hello"')).toBe("hello")
    expect(safeJsonParse("true")).toBe(true)
    expect(safeJsonParse("false")).toBe(false)
  })

  it("should handle nested objects", () => {
    const input = '{"outer": {"inner": {"value": 42}}}'
    const result = safeJsonParse(input)
    expect(result).toEqual({ outer: { inner: { value: 42 } } })
  })

  it("should handle malformed JSON gracefully", () => {
    expect(safeJsonParse("{incomplete")).toBeNull()
    expect(safeJsonParse('{"key": }')).toBeNull()
    expect(safeJsonParse("{'single': 'quotes'}")).toBeNull()
  })
})
