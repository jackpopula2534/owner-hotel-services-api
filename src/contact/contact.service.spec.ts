import { Test, TestingModule } from '@nestjs/testing';
import { ContactService } from './contact.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ContactService', () => {
  let service: ContactService;
  let prisma: PrismaService;

  const mockDemoBooking = {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    phoneNumber: '0812345678',
    demoDate: new Date('2024-03-01'),
    demoType: 'online',
    notes: 'Interested in your product',
    createdAt: new Date(),
  };

  const mockContactMessage = {
    id: '1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    subject: 'Question about pricing',
    message: 'How much does it cost?',
    createdAt: new Date(),
  };

  const mockPrismaService = {
    contactDemo: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    contactMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDemoBooking', () => {
    it('should create a demo booking', async () => {
      mockPrismaService.contactDemo.create.mockResolvedValue(mockDemoBooking);

      const result = await service.createDemoBooking({
        name: 'John Doe',
        email: 'john@example.com',
        phoneNumber: '0812345678',
        demoDate: '2024-03-01',
        demoType: 'online',
        notes: 'Interested in your product',
      });

      expect(result).toEqual(mockDemoBooking);
      expect(prisma.contactDemo.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'John Doe',
          email: 'john@example.com',
          demoDate: expect.any(Date),
        }),
      });
    });
  });

  describe('createMessage', () => {
    it('should create a contact message', async () => {
      mockPrismaService.contactMessage.create.mockResolvedValue(mockContactMessage);

      const result = await service.createMessage({
        name: 'Jane Doe',
        email: 'jane@example.com',
        subject: 'Question about pricing',
        message: 'How much does it cost?',
      });

      expect(result).toEqual(mockContactMessage);
      expect(prisma.contactMessage.create).toHaveBeenCalled();
    });
  });

  describe('findAllDemoBookings', () => {
    it('should return all demo bookings', async () => {
      const mockBookings = [mockDemoBooking];
      mockPrismaService.contactDemo.findMany.mockResolvedValue(mockBookings);

      const result = await service.findAllDemoBookings();

      expect(result).toEqual(mockBookings);
      expect(prisma.contactDemo.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findAllMessages', () => {
    it('should return all contact messages', async () => {
      const mockMessages = [mockContactMessage];
      mockPrismaService.contactMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.findAllMessages();

      expect(result).toEqual(mockMessages);
      expect(prisma.contactMessage.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
