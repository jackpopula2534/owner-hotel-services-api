import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from './entities/admin.entity';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

@Injectable()
export class AdminsService {
  constructor(
    @InjectRepository(Admin)
    private adminsRepository: Repository<Admin>,
  ) {}

  create(createAdminDto: CreateAdminDto): Promise<Admin> {
    const admin = this.adminsRepository.create(createAdminDto);
    return this.adminsRepository.save(admin);
  }

  findAll(): Promise<Admin[]> {
    return this.adminsRepository.find();
  }

  findOne(id: string): Promise<Admin> {
    return this.adminsRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<Admin> {
    return this.adminsRepository.findOne({ where: { email } });
  }

  update(id: string, updateAdminDto: UpdateAdminDto): Promise<Admin> {
    return this.adminsRepository.save({
      id,
      ...updateAdminDto,
    });
  }

  remove(id: string): Promise<void> {
    return this.adminsRepository.delete(id).then(() => undefined);
  }
}


