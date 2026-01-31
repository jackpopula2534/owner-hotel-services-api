import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddYearlyPricingToPlans1738302000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add yearly pricing columns
    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'price_yearly',
        type: 'decimal',
        precision: 10,
        scale: 2,
        isNullable: true,
        comment: 'Yearly price (optional, can be auto-calculated)',
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'yearly_discount_percent',
        type: 'int',
        default: 0,
        comment: 'Discount percentage for yearly subscription (0-100)',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('plans', 'yearly_discount_percent');
    await queryRunner.dropColumn('plans', 'price_yearly');
  }
}
