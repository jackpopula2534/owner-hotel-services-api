import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDemoBookingDto, CreateContactMessageDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async createDemoBooking(data: CreateDemoBookingDto) {
    const booking = await this.prisma.contactDemo.create({
      data: {
        ...data,
        demoDate: new Date(data.demoDate),
      },
    });

    // TODO: Send confirmation email
    // TODO: Integrate with Google Calendar

    return booking;
  }

  async createMessage(data: CreateContactMessageDto) {
    return this.prisma.contactMessage.create({
      data,
    });
  }

  async findAllDemoBookings() {
    return this.prisma.contactDemo.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllMessages() {
    return this.prisma.contactMessage.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
