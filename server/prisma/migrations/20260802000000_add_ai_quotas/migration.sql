-- CreateTable
CREATE TABLE "ai_quotas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "image_limit" INTEGER,
    "video_limit" INTEGER,
    "text_limit" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_quotas_org_id_user_id_key" ON "ai_quotas"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "ai_quotas" ADD CONSTRAINT "ai_quotas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_quotas" ADD CONSTRAINT "ai_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
