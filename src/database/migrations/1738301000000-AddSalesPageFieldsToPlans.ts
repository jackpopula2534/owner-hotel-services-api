import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSalesPageFieldsToPlans1738301000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns for Sales Page functionality
    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'description',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'display_order',
        type: 'int',
        default: 0,
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'is_popular',
        type: 'boolean',
        default: false,
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'badge',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'highlight_color',
        type: 'varchar',
        length: '50',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'features',
        type: 'text',
        isNullable: true,
        comment: 'JSON stringified array of feature strings',
      }),
    );

    await queryRunner.addColumn(
      'plans',
      new TableColumn({
        name: 'button_text',
        type: 'varchar',
        length: '100',
        isNullable: true,
        default: "'เริ่มใช้งาน'",
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns in reverse order
    await queryRunner.dropColumn('plans', 'button_text');
    await queryRunner.dropColumn('plans', 'features');
    await queryRunner.dropColumn('plans', 'highlight_color');
    await queryRunner.dropColumn('plans', 'badge');
    await queryRunner.dropColumn('plans', 'is_popular');
    await queryRunner.dropColumn('plans', 'display_order');
    await queryRunner.dropColumn('plans', 'description');
  }
}
