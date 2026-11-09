-- Withholding tax (ภงด.1) config on payroll policy: personal allowance,
-- expense deduction (rate + cap), and extra allowances. Consumed by the
-- payroll engine's progressive-bracket tax calculation when taxEnabled = true.

ALTER TABLE `hr_payroll_policies`
  ADD COLUMN `taxPersonalAllowance` DECIMAL(12, 2) NOT NULL DEFAULT 60000.00,
  ADD COLUMN `taxExpenseRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.5000,
  ADD COLUMN `taxExpenseCap` DECIMAL(12, 2) NOT NULL DEFAULT 100000.00,
  ADD COLUMN `taxExtraAllowance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;
