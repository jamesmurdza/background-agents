-- Paddle MCP: per-user Paddle OAuth refresh token.
ALTER TABLE "User" ADD COLUMN "paddleRefreshTokenEncrypted" TEXT;
