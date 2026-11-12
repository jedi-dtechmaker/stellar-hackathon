-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT,
    "email" TEXT,
    "walletPublicKey" TEXT,
    "custodialPubKey" TEXT,
    "custodialEncSecKey" TEXT,
    "bankDetailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drop" (
    "id" TEXT NOT NULL,
    "claimCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL DEFAULT 'USDC',
    "assetIssuer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "withdrawnAmount" TEXT NOT NULL DEFAULT '0',
    "stellarBalanceId" TEXT,
    "senderId" TEXT,
    "receiverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionLog" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemKey" (
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,

    CONSTRAINT "SystemKey_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingIntent" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "claimCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "unsignedXdr" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "sourcePublicKey" TEXT NOT NULL,
    "signedXdr" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRequest" (
    "dropId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimRequest_pkey" PRIMARY KEY ("dropId")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeUserId" TEXT,
    "anchorId" TEXT,
    "amount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATING',
    "interactiveUrl" TEXT,
    "encryptedToken" TEXT,
    "dropIds" TEXT[],
    "allocations" JSONB NOT NULL,
    "paymentHash" TEXT,
    "lastError" TEXT,
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "notificationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUpdate" (
    "updateId" BIGINT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletPublicKey_key" ON "User"("walletPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_custodialPubKey_key" ON "User"("custodialPubKey");

-- CreateIndex
CREATE UNIQUE INDEX "Drop_claimCode_key" ON "Drop"("claimCode");

-- CreateIndex
CREATE UNIQUE INDEX "Drop_stellarBalanceId_key" ON "Drop"("stellarBalanceId");

-- CreateIndex
CREATE INDEX "Drop_senderId_createdAt_idx" ON "Drop"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Drop_receiverId_status_idx" ON "Drop"("receiverId", "status");

-- CreateIndex
CREATE INDEX "TransactionLog_dropId_idx" ON "TransactionLog"("dropId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionLog_dropId_type_txHash_key" ON "TransactionLog"("dropId", "type", "txHash");

-- CreateIndex
CREATE UNIQUE INDEX "FundingIntent_claimCode_key" ON "FundingIntent"("claimCode");

-- CreateIndex
CREATE UNIQUE INDEX "FundingIntent_txHash_key" ON "FundingIntent"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerJob_txHash_key" ON "LedgerJob"("txHash");

-- CreateIndex
CREATE INDEX "LedgerJob_state_updatedAt_idx" ON "LedgerJob"("state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerJob_kind_reference_key" ON "LedgerJob"("kind", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_activeUserId_key" ON "Withdrawal"("activeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_anchorId_key" ON "Withdrawal"("anchorId");

-- CreateIndex
CREATE INDEX "Withdrawal_activeUserId_nextPollAt_idx" ON "Withdrawal"("activeUserId", "nextPollAt");

-- CreateIndex
CREATE INDEX "TelegramUpdate_telegramId_createdAt_idx" ON "TelegramUpdate"("telegramId", "createdAt");

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drop" ADD CONSTRAINT "Drop_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
