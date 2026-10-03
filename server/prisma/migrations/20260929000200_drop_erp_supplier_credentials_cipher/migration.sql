-- 删除 ErpSupplier 死列 credentials_cipher：全库零读写（货盘凭据实际走 Linduo 凭据域），
-- 留存密文列只会扩大泄露面。EliminatedProduct.id 补 @default(cuid()) 为客户端侧默认值，无 DDL。
ALTER TABLE "erp_suppliers" DROP COLUMN "credentials_cipher";
