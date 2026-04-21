import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface GuestResult {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: 'guest';
}

interface BookingResult {
  id: string;
  guestName: string;
  roomNumber: string;
  status: string;
  checkIn: Date;
  type: 'booking';
}

interface RoomResult {
  id: string;
  number: string;
  roomType: string;
  status: string;
  floor: number;
  type: 'room';
}

interface GlobalSearchResponse {
  guests: GuestResult[];
  bookings: BookingResult[];
  rooms: RoomResult[];
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private prisma: PrismaService) {}

  async globalSearch(tenantId?: string, query?: string, limit = 10): Promise<GlobalSearchResponse> {
    if (!tenantId || !query || query.trim().length < 2) {
      return { guests: [], bookings: [], rooms: [] };
    }

    const searchTerm = query.trim();

    try {
      const [guests, bookings, rooms] = await Promise.all([
        this.prisma.guest
          .findMany({
            where: {
              tenantId,
              OR: [
                { firstName: { contains: searchTerm } },
                { lastName: { contains: searchTerm } },
                { email: { contains: searchTerm } },
                { phone: { contains: searchTerm } },
              ],
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
          })
          .catch(() => []),

        this.prisma.booking
          .findMany({
            where: {
              tenantId,
              OR: [
                { id: { contains: searchTerm } },
                { guestFirstName: { contains: searchTerm } },
                { guestLastName: { contains: searchTerm } },
                { guestEmail: { contains: searchTerm } },
              ],
            },
            include: { room: true, guest: true },
            take: limit,
            orderBy: { createdAt: 'desc' },
          })
          .catch(() => []),

        this.prisma.room
          .findMany({
            where: {
              tenantId,
              OR: [
                { number: { contains: searchTerm } },
                { type: { contains: searchTerm } },
                { description: { contains: searchTerm } },
              ],
            },
            take: limit,
            orderBy: { number: 'asc' },
          })
          .catch(() => []),
      ]);

      return {
        guests: guests.map((g) => ({
          id: g.id,
          name: `${g.firstName} ${g.lastName}`,
          email: g.email || '',
          phone: g.phone || '',
          type: 'guest' as const,
        })),
        bookings: bookings.map((b) => ({
          id: b.id,
          guestName: b.guest
            ? `${b.guest.firstName} ${b.guest.lastName}`
            : `${b.guestFirstName || ''} ${b.guestLastName || ''}`.trim(),
          roomNumber: b.room?.number || 'Unassigned',
          status: b.status,
          checkIn: b.checkIn,
          type: 'booking' as const,
        })),
        rooms: rooms.map((r) => ({
          id: r.id,
          number: r.number,
          roomType: r.type || 'standard',
          status: r.status,
          floor: r.floor || 1,
          type: 'room' as const,
        })),
      };
    } catch (error: unknown) {
      this.logger.error(
        `Error in global search: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { guests: [], bookings: [], rooms: [] };
    }
  }
}
