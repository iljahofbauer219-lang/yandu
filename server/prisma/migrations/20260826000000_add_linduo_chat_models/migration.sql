-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferred_linduo_model_id" TEXT;

-- CreateTable
CREATE TABLE "linduo_chat_models" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "context_label" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "effort" TEXT NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linduo_chat_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_linduo_grants" (
    "user_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "granted_by" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_linduo_grants_pkey" PRIMARY KEY ("user_id","model_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "linduo_chat_models_model_id_key" ON "linduo_chat_models"("model_id");

-- CreateIndex
CREATE INDEX "linduo_chat_models_vendor_idx" ON "linduo_chat_models"("vendor");

-- AddForeignKey
ALTER TABLE "user_linduo_grants" ADD CONSTRAINT "user_linduo_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_linduo_grants" ADD CONSTRAINT "user_linduo_grants_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "linduo_chat_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
