-- CreateTable
CREATE TABLE "ScheduledJobMcpServer" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "iconUrl" TEXT,
    "smitheryConnectionId" TEXT,
    "smitheryNamespace" TEXT,
    "mcpUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJobMcpServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledJobMcpServer_jobId_idx" ON "ScheduledJobMcpServer"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJobMcpServer_jobId_qualifiedName_key" ON "ScheduledJobMcpServer"("jobId", "qualifiedName");

-- AddForeignKey
ALTER TABLE "ScheduledJobMcpServer" ADD CONSTRAINT "ScheduledJobMcpServer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
