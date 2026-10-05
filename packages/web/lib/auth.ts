import { NextAuthOptions } from "next-auth"
import GitHubProvider from "next-auth/providers/github"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { grantSignupCredit } from "@/lib/db/credits"
import { prisma } from "@/lib/db/prisma"
import { logActivityAsync } from "@/lib/db/activity-log"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: [
    {
      ...GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        authorization: {
          params: {
            scope: "repo read:user user:email",
          },
        },
        allowDangerousEmailAccountLinking: true,
      }),
      // GitHub now sends `iss=https://github.com/login/oauth` in the OAuth
      // callback. openid-client validates this against the issuer config, but
      // next-auth's GitHub provider doesn't set one. Adding it here satisfies
      // the check.
      issuer: "https://github.com/login/oauth",
    },
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow redirects to the electron callback URL
      if (url.startsWith("/api/auth/electron-callback")) {
        return `${baseUrl}${url}`
      }
      // Allow relative URLs
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`
      }
      // Allow URLs on the same origin
      try {
        if (new URL(url).origin === baseUrl) {
          return url
        }
      } catch {
        // url is not a valid absolute URL, fall through to default
      }
      return baseUrl
    },
    async jwt({ token, user, account }) {
      // On initial sign in, persist user id
      if (user) {
        token.sub = user.id
      }
      if (account) {
        // The adapter only links once. On re-authorization replace the whole
        // token pair (including expiry), not just the access token: GitHub
        // rotates refresh tokens and the old pair may already be invalid.
        if (token.sub && account.access_token) {
          const githubAccount = account as typeof account & { refresh_token_expires_in?: number }
          try {
            await prisma.account.updateMany({
              where: {
                userId: token.sub,
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
              data: {
                access_token: account.access_token,
                refresh_token: account.refresh_token ?? null,
                expires_at: account.expires_at ?? null,
                refresh_token_expires_in: githubAccount.refresh_token_expires_in ?? null,
              },
            })
          } catch {
            // Prisma errors can contain the update input, including secrets.
            throw new Error("Failed to store GitHub authorization")
          }
        }
      }
      return token
    },
    async session({ session, token }) {
      // Send user id to client
      if (session.user && token.sub) {
        session.user.id = token.sub

        // Fetch isAdmin status from database
        const user = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { isAdmin: true },
        })
        session.user.isAdmin = user?.isAdmin ?? false
      }
      return session
    },
  },
  events: {
    async signIn({ user }) {
      // Log user login activity
      if (user?.id) {
        logActivityAsync(user.id, "login")
      }
    },
    async signOut({ token }) {
      // Log user logout activity
      if (token?.sub) {
        logActivityAsync(token.sub, "logout")
      }
    },
    async createUser({ user }) {
      // When a new user is created via OAuth, update with GitHub ID
      // The adapter creates the user, but we need to ensure githubId is set
      const account = await prisma.account.findFirst({
        where: { userId: user.id, provider: "github" },
        select: { providerAccountId: true },
      })
      if (account) {
        await prisma.user.update({
          where: { id: user.id },
          data: { githubId: account.providerAccountId },
        })
      }

      // The starting balance, and the only free credits there are — nothing
      // refills it (see lib/db/usage-limit). Deliberately in `createUser` and
      // not `signIn`: this fires once, when the adapter first writes the row,
      // whereas signIn fires on every login and would re-grant on each one.
      // grantSignupCredit is idempotent and never throws, so a repeat here
      // cannot double-credit and a failure cannot block the signup.
      await grantSignupCredit(user.id)
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
}

// Type extensions are in types/next-auth.d.ts
