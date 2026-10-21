-- Notebook v1: onboarding answers, settings, bucket names + where money lives,
-- money source on budgets, the "move the money" checklist, expense categories.

-- CreateEnum
CREATE TYPE "Goal" AS ENUM ('STOP_RUNNING_OUT', 'SAVE_FOR_SOMETHING', 'BUILD_CUSHION');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "goal" "Goal",
ADD COLUMN     "handwritingOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "moneySource" TEXT,
ADD COLUMN     "nextMoneyAt" TIMESTAMP(3),
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "remindersOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shareAmounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unavoidablePct" INTEGER;

-- People who already use the app skip onboarding.
UPDATE "User" SET "onboardedAt" = CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "Allocation" ADD COLUMN     "livesIn" TEXT,
ADD COLUMN     "movedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "category" TEXT;

-- CreateTable
CREATE TABLE "BucketPlace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL,
    "baseLabel" TEXT,
    "label" TEXT,
    "livesIn" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucketPlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BucketPlace_userId_colorKey_key" ON "BucketPlace"("userId", "colorKey");

-- AddForeignKey
ALTER TABLE "BucketPlace" ADD CONSTRAINT "BucketPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
