/**
 * Unit tests for loading the env vars a chat's runs get.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const findUnique = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique } } }))

import { NEW_REPOSITORY } from "@/lib/types"
import { chatEnvScope, encodeEnvVars, repoEnvScope } from "./env-var-secrets"
import { loadUserEnvVars } from "./user-env-vars"

const hosts = ["api.example.com"]

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({
    repoEnvironmentVariables: {
      "o/r": encodeEnvVars({
        values: { REPO_ONLY: "r", SHARED: "repo-value", REPO_SECRET: "rs", OVERRIDDEN_SECRET: "repo-secret" },
        secretHosts: { REPO_SECRET: hosts, OVERRIDDEN_SECRET: hosts },
      }),
    },
  })
})

describe("loadUserEnvVars", () => {
  it("merges repo then chat vars, chat winning, secrets included", async () => {
    const chat = {
      id: "c1",
      repo: "o/r",
      environmentVariables: encodeEnvVars({
        values: { SHARED: "chat-value", OVERRIDDEN_SECRET: "plain-now", CHAT_SECRET: "cs" },
        secretHosts: { CHAT_SECRET: hosts },
      }),
    }
    const { values, secrets } = await loadUserEnvVars("user-1", chat)
    expect(values).toEqual({
      REPO_ONLY: "r",
      SHARED: "chat-value",
      REPO_SECRET: "rs",
      OVERRIDDEN_SECRET: "plain-now",
      CHAT_SECRET: "cs",
    })
    // A chat var overriding a repo secret is a secret only if marked so itself.
    expect(secrets).toEqual([
      { key: "REPO_SECRET", value: "rs", hosts, scope: repoEnvScope("o/r") },
      { key: "CHAT_SECRET", value: "cs", hosts, scope: chatEnvScope("c1") },
    ])
  })

  it("skips repo vars for a new repository", async () => {
    const { values } = await loadUserEnvVars("user-1", { id: "c1", repo: NEW_REPOSITORY, environmentVariables: null })
    expect(values).toEqual({})
    expect(findUnique).not.toHaveBeenCalled()
  })
})
