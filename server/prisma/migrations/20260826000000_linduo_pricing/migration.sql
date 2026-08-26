-- CreateTable
CREATE TABLE "linduo_model_pricing" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "input_price" DOUBLE PRECISION,
    "output_price" DOUBLE PRECISION,
    "cache_price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billing_type" TEXT NOT NULL DEFAULT 'TOKEN',
    "price_per_unit" DOUBLE PRECISION,
    "unit_label" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linduo_model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "linduo_model_pricing_model_id_key" ON "linduo_model_pricing"("model_id");

-- CreateIndex
CREATE INDEX "linduo_model_pricing_vendor_idx" ON "linduo_model_pricing"("vendor");

-- CreateTable
CREATE TABLE "linduo_login_sessions" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_enc" TEXT NOT NULL,
    "cookies" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linduo_login_sessions_pkey" PRIMARY KEY ("id")
);
