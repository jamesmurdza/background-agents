import { NextAuthOptions } from "next-auth"
import GitHubProvider from "next-auth/providers/github"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db/prisma"

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
      }),
      // GitHub now sends `iss=https://github.com/login/oauth` in the OAuth
      // callback. openid-client validates this against the issuer config, but
      // next-auth's GitHub provider doesn't set one. Adding it here satisfies
      // the check.
      issuer: "https://github.com/login/oauth",
    },
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // On initial sign in, persist user id and access token
      if (user) {
        token.sub = user.id
      }
      if (account) {
        token.accessToken = account.access_token
      }
      return token
    },
    async session({ session, token }) {
      // Send user id and access token to client
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      session.accessToken = token.accessToken as string
      return session
    },
  },
  events: {
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
