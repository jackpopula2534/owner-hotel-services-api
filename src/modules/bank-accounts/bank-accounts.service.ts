import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Injectable()
export class BankAccountsService {
  private readonly logger = new Logger(BankAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Public ──────────────────────────────────────────────────────────────────

  async findAllPublic() {
    return this.prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        bankName: true,
        bankCode: true,
        accountName: true,
        accountNumber: true,
        branch: true,
        logoUrl: true,
        isDefault: true,
      },
    });
  }

  // ─── Admin CRUD ───────────────────────────────────────────────────────────────

  async findAll() {
    return this.prisma.bankAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`BankAccount ${id} not found`);
    return account;
  }

  async create(dto: CreateBankAccountDto) {
    // ถ้าตั้ง isDefault = true ให้ unset คนอื่นก่อน
    if (dto.isDefault) {
      await this.prisma.bankAccount.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const account = await this.prisma.bankAccount.create({ data: dto });
    this.logger.log(`Created bank account: ${account.id} (${account.bankName})`);
    return account;
  }

  async update(id: string, dto: UpdateBankAccountDto) {
    await this.findOne(id); // ensure exists

    if (dto.isDefault) {
      await this.prisma.bankAccount.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.bankAccount.update({
      where: { id },
      data: dto,
    });
    this.logger.log(`Updated bank account: ${id}`);
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id); // ensure exists
    await this.prisma.bankAccount.delete({ where: { id } });
    this.logger.log(`Deleted bank account: ${id}`);
    return { success: true };
  }

  async reorder(ids: string[]) {
    if (!ids.length) throw new BadRequestException('ids must not be empty');
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.bankAccount.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { success: true };
  }
}
