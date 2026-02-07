import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ContactService } from './contact.service';
import { CreateDemoBookingDto, CreateContactMessageDto } from './dto/contact.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post('demo')
  async createDemoBooking(@Body() createDemoBookingDto: CreateDemoBookingDto) {
    return this.contactService.createDemoBooking(createDemoBookingDto);
  }

  @Post('message')
  async createMessage(@Body() createContactMessageDto: CreateContactMessageDto) {
    return this.contactService.createMessage(createContactMessageDto);
  }

  // Admin endpoints to view bookings and messages
  @Get('demos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'platform_admin')
  async findAllDemoBookings() {
    return this.contactService.findAllDemoBookings();
  }

  @Get('messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'platform_admin')
  async findAllMessages() {
    return this.contactService.findAllMessages();
  }
}
