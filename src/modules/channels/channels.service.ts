import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, limit = 10, type, isActive, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.channel.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          bookings: {
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.channel.count({ where }),
    ]);

    return {
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  async findOne(id: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id },
      include: {
        bookings: {
          include: {
            guest: true,
            room: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }

    return channel;
  }

  async create(createChannelDto: CreateChannelDto) {
    // Check if channel code already exists
    const existingChannel = await this.prisma.channel.findUnique({
      where: { code: createChannelDto.code },
    });

    if (existingChannel) {
      throw new BadRequestException(
        `Channel with code ${createChannelDto.code} already exists`,
      );
    }

    return this.prisma.channel.create({
      data: createChannelDto,
    });
  }

  async update(id: string, updateChannelDto: UpdateChannelDto) {
    await this.findOne(id); // Check if exists

    // If updating code, check for duplicates
    if (updateChannelDto.code) {
      const existingChannel = await this.prisma.channel.findUnique({
        where: { code: updateChannelDto.code },
      });

      if (existingChannel && existingChannel.id !== id) {
        throw new BadRequestException(
          `Channel with code ${updateChannelDto.code} already exists`,
        );
      }
    }

    return this.prisma.channel.update({
      where: { id },
      data: updateChannelDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    // Check if channel has bookings
    const bookingsCount = await this.prisma.booking.count({
      where: { channelId: id },
    });

    if (bookingsCount > 0) {
      throw new BadRequestException(
        `Cannot delete channel with ${bookingsCount} associated bookings`,
      );
    }

    return this.prisma.channel.delete({
      where: { id },
    });
  }

  async sync(id: string) {
    const channel = await this.findOne(id);

    if (!channel.syncEnabled) {
      throw new BadRequestException('Channel sync is not enabled');
    }

    // TODO: Implement actual sync logic with external API
    // This is a placeholder for future implementation
    const updatedChannel = await this.prisma.channel.update({
      where: { id },
      data: { lastSyncAt: new Date() },
    });

    return {
      message: 'Channel sync initiated',
      channel: updatedChannel,
      syncedAt: updatedChannel.lastSyncAt,
    };
  }

  async toggleActive(id: string) {
    const channel = await this.findOne(id);

    return this.prisma.channel.update({
      where: { id },
      data: { isActive: !channel.isActive },
    });
  }
}

