import { NextAuthOptions } from "next-auth"
import GitHubProvider from "next-auth/providers/github"
import { PrismaAdapter } from "@auth/prisma-adapter"
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
      if (new URL(url).origin === baseUrl) {
        return url
      }
      return baseUrl
    },
    async jwt({ token, user, account }) {
      // On initial sign in, persist user id
      if (user) {
        token.sub = user.id
      }
      if (account) {
        // Sync the fresh token to the Account table. The PrismaAdapter only
        // writes Account rows on the very first link (create, not upsert), so
        // on re-authorization the DB row keeps the old, revoked token. All
        // routes that need the GitHub token read it from the Account table.
        if (token.sub && account.access_token) {
          prisma.account
            .updateMany({
              where: {
                userId: token.sub,
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
              data: { access_token: account.access_token },
            })
            .catch((err) => {
              console.error("[auth] Failed to sync access_token to Account table:", err)
            })
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
