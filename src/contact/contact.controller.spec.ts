import { Test, TestingModule } from '@nestjs/testing';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { CreateDemoBookingDto, CreateContactMessageDto } from './dto/contact.dto';

describe('ContactController', () => {
  let controller: ContactController;
  let service: ContactService;

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

  const mockContactService = {
    createDemoBooking: jest.fn(),
    createMessage: jest.fn(),
    findAllDemoBookings: jest.fn(),
    findAllMessages: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [
        {
          provide: ContactService,
          useValue: mockContactService,
        },
      ],
    }).compile();

    controller = module.get<ContactController>(ContactController);
    service = module.get<ContactService>(ContactService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createDemoBooking', () => {
    it('should create a demo booking', async () => {
      const dto: CreateDemoBookingDto = {
        name: 'John Doe',
        email: 'john@example.com',
        phoneNumber: '0812345678',
        demoDate: '2024-03-01',
        demoType: 'online',
        notes: 'Interested in your product',
      };

      mockContactService.createDemoBooking.mockResolvedValue(mockDemoBooking);

      const result = await controller.createDemoBooking(dto);

      expect(service.createDemoBooking).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockDemoBooking);
    });
  });

  describe('createMessage', () => {
    it('should create a contact message', async () => {
      const dto: CreateContactMessageDto = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        subject: 'Question about pricing',
        message: 'How much does it cost?',
      };

      mockContactService.createMessage.mockResolvedValue(mockContactMessage);

      const result = await controller.createMessage(dto);

      expect(service.createMessage).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockContactMessage);
    });
  });

  describe('findAllDemoBookings', () => {
    it('should return all demo bookings for admin', async () => {
      const mockBookings = [mockDemoBooking];
      mockContactService.findAllDemoBookings.mockResolvedValue(mockBookings);

      const result = await controller.findAllDemoBookings();

      expect(service.findAllDemoBookings).toHaveBeenCalled();
      expect(result).toEqual(mockBookings);
    });
  });

  describe('findAllMessages', () => {
    it('should return all contact messages for admin', async () => {
      const mockMessages = [mockContactMessage];
      mockContactService.findAllMessages.mockResolvedValue(mockMessages);

      const result = await controller.findAllMessages();

      expect(service.findAllMessages).toHaveBeenCalled();
      expect(result).toEqual(mockMessages);
    });
  });
});
