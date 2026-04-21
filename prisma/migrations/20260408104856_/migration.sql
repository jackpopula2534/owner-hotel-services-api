/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,propertyId,employeeCode]` on the table `employees` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,email]` on the table `employees` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `employees_email_key` ON `employees`;

-- DropIndex
DROP INDEX `employees_employeeCode_key` ON `employees`;

-- CreateIndex
CREATE INDEX `employees_employeeCode_idx` ON `employees`(`employeeCode`);

-- CreateIndex
CREATE UNIQUE INDEX `employees_tenantId_propertyId_employeeCode_key` ON `employees`(`tenantId`, `propertyId`, `employeeCode`);

-- CreateIndex
CREATE UNIQUE INDEX `employees_tenantId_email_key` ON `employees`(`tenantId`, `email`);
