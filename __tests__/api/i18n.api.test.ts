import { Test, TestingModule } from '@nestjs/testing';
import { I18nController } from '../../src/i18n/i18n.controller';
import { I18nService } from '../../src/i18n/i18n.service';

describe('i18n Translation API', () => {
  let controller: I18nController;
  let i18nService: I18nService;

  const mockI18nService = {
    getLanguages: jest.fn(),
    getNamespaces: jest.fn(),
    getAllTranslations: jest.fn(),
    getNamespace: jest.fn(),
    translate: jest.fn(),
    translateBulk: jest.fn(),
    searchTranslations: jest.fn(),
    hasTranslation: jest.fn(),
    reloadTranslations: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [I18nController],
      providers: [
        {
          provide: I18nService,
          useValue: mockI18nService,
        },
      ],
    }).compile();

    controller = module.get<I18nController>(I18nController);
    i18nService = module.get<I18nService>(I18nService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/v1/i18n/languages', () => {
    it('should return available languages', () => {
      const mockLanguages = [
        { code: 'th', name: 'ไทย', nativeName: 'ภาษาไทย', isDefault: true },
        { code: 'en', name: 'English', nativeName: 'English', isDefault: false },
        { code: 'zh', name: 'Chinese', nativeName: '中文', isDefault: false },
      ];

      mockI18nService.getLanguages.mockReturnValue(mockLanguages);

      const result = controller.getLanguages();

      expect(i18nService.getLanguages).toHaveBeenCalled();
      expect(result).toHaveLength(3);
      expect(result[0].isDefault).toBe(true);
    });
  });

  describe('GET /api/v1/i18n/namespaces', () => {
    it('should return available namespaces', () => {
      const mockNamespaces = ['common', 'booking', 'payment', 'auth', 'errors'];

      mockI18nService.getNamespaces.mockReturnValue(mockNamespaces);

      const result = controller.getNamespaces('th' as any);

      expect(i18nService.getNamespaces).toHaveBeenCalledWith('th');
      expect(result).toContain('common');
      expect(result).toContain('booking');
    });

    it('should default to Thai language', () => {
      mockI18nService.getNamespaces.mockReturnValue(['common']);

      controller.getNamespaces(undefined as any);

      expect(i18nService.getNamespaces).toHaveBeenCalledWith('th');
    });
  });

  describe('GET /api/v1/i18n/translations/:language', () => {
    it('should return all translations for Thai', () => {
      const mockTranslations = {
        common: {
          welcome: 'ยินดีต้อนรับ',
          save: 'บันทึก',
          cancel: 'ยกเลิก',
        },
        booking: {
          title: 'การจอง',
          checkIn: 'เช็คอิน',
        },
      };

      mockI18nService.getAllTranslations.mockReturnValue(mockTranslations);

      const result = controller.getAllTranslations('th' as any);

      expect(i18nService.getAllTranslations).toHaveBeenCalledWith('th');
      expect(result.common.welcome).toBe('ยินดีต้อนรับ');
    });

    it('should return all translations for English', () => {
      const mockTranslations = {
        common: {
          welcome: 'Welcome',
          save: 'Save',
          cancel: 'Cancel',
        },
      };

      mockI18nService.getAllTranslations.mockReturnValue(mockTranslations);

      const result = controller.getAllTranslations('en' as any);

      expect(i18nService.getAllTranslations).toHaveBeenCalledWith('en');
      expect(result.common.welcome).toBe('Welcome');
    });

    it('should return empty object for invalid language', () => {
      mockI18nService.getAllTranslations.mockReturnValue(null);

      const result = controller.getAllTranslations('invalid' as any);

      expect(result).toEqual({});
    });
  });

  describe('GET /api/v1/i18n/translations/:language/:namespace', () => {
    it('should return namespace translations', () => {
      const mockTranslations = {
        title: 'การจอง',
        checkIn: 'เช็คอิน',
        checkOut: 'เช็คเอาท์',
        guestName: 'ชื่อผู้เข้าพัก',
        roomNumber: 'หมายเลขห้อง',
      };

      mockI18nService.getNamespace.mockReturnValue(mockTranslations);

      const result = controller.getNamespaceTranslations('th' as any, 'booking');

      expect(i18nService.getNamespace).toHaveBeenCalledWith('booking', 'th');
      expect(result.title).toBe('การจอง');
    });

    it('should return empty object for non-existent namespace', () => {
      mockI18nService.getNamespace.mockReturnValue(null);

      const result = controller.getNamespaceTranslations('th' as any, 'nonexistent');

      expect(result).toEqual({});
    });
  });

  describe('POST /api/v1/i18n/translate', () => {
    it('should translate a single key', () => {
      const dto = {
        key: 'common.welcome',
        language: 'th' as any,
      };

      mockI18nService.translate.mockReturnValue('ยินดีต้อนรับ');

      const result = controller.translate(dto);

      expect(i18nService.translate).toHaveBeenCalledWith('common.welcome', 'th', undefined);
      expect(result.key).toBe('common.welcome');
      expect(result.value).toBe('ยินดีต้อนรับ');
      expect(result.language).toBe('th');
    });

    it('should translate with variables', () => {
      const dto = {
        key: 'booking.greeting',
        language: 'th' as any,
        variables: { guestName: 'คุณสมชาย' },
      };

      mockI18nService.translate.mockReturnValue('สวัสดีครับ คุณสมชาย');

      const result = controller.translate(dto);

      expect(i18nService.translate).toHaveBeenCalledWith(
        'booking.greeting',
        'th',
        { guestName: 'คุณสมชาย' },
      );
      expect(result.value).toBe('สวัสดีครับ คุณสมชาย');
    });

    it('should handle missing translation key', () => {
      const dto = {
        key: 'nonexistent.key',
        language: 'th' as any,
      };

      mockI18nService.translate.mockReturnValue('nonexistent.key');

      const result = controller.translate(dto);

      expect(result.value).toBe('nonexistent.key');
    });
  });

  describe('POST /api/v1/i18n/translate/bulk', () => {
    it('should translate multiple keys', () => {
      const dto = {
        keys: ['common.save', 'common.cancel', 'common.delete'],
        language: 'th' as any,
      };

      const mockTranslations = {
        'common.save': 'บันทึก',
        'common.cancel': 'ยกเลิก',
        'common.delete': 'ลบ',
      };

      mockI18nService.translateBulk.mockReturnValue(mockTranslations);

      const result = controller.translateBulk(dto);

      expect(i18nService.translateBulk).toHaveBeenCalledWith(dto.keys, 'th');
      expect(result['common.save']).toBe('บันทึก');
      expect(Object.keys(result)).toHaveLength(3);
    });
  });

  describe('GET /api/v1/i18n/t/:key', () => {
    it('should get translation by key via GET request', () => {
      mockI18nService.translate.mockReturnValue('ยินดีต้อนรับ');

      const result = controller.getTranslation('common.welcome', 'th' as any);

      expect(i18nService.translate).toHaveBeenCalledWith('common.welcome', 'th');
      expect(result.value).toBe('ยินดีต้อนรับ');
    });

    it('should default to Thai language', () => {
      mockI18nService.translate.mockReturnValue('บันทึก');

      controller.getTranslation('common.save', undefined as any);

      expect(i18nService.translate).toHaveBeenCalledWith('common.save', 'th');
    });
  });

  describe('GET /api/v1/i18n/search', () => {
    it('should search translations', () => {
      const mockResults = [
        { key: 'common.welcome', value: 'ยินดีต้อนรับ', language: 'th' },
        { key: 'booking.welcome_message', value: 'ยินดีต้อนรับสู่โรงแรม', language: 'th' },
      ];

      mockI18nService.searchTranslations.mockReturnValue(mockResults);

      const result = controller.searchTranslations('ยินดี', 'th' as any);

      expect(i18nService.searchTranslations).toHaveBeenCalledWith('ยินดี', 'th');
      expect(result).toHaveLength(2);
    });

    it('should return empty array for no matches', () => {
      mockI18nService.searchTranslations.mockReturnValue([]);

      const result = controller.searchTranslations('xyz123', 'th' as any);

      expect(result).toHaveLength(0);
    });
  });

  describe('GET /api/v1/i18n/exists/:key', () => {
    it('should return true for existing key', () => {
      mockI18nService.hasTranslation.mockReturnValue(true);

      const result = controller.checkTranslationExists('common.welcome', 'th' as any);

      expect(i18nService.hasTranslation).toHaveBeenCalledWith('common.welcome', 'th');
      expect(result.exists).toBe(true);
    });

    it('should return false for non-existing key', () => {
      mockI18nService.hasTranslation.mockReturnValue(false);

      const result = controller.checkTranslationExists('nonexistent', 'th' as any);

      expect(result.exists).toBe(false);
    });
  });

  describe('POST /api/v1/i18n/reload', () => {
    it('should reload translations', () => {
      mockI18nService.reloadTranslations.mockReturnValue(undefined);

      const result = controller.reloadTranslations();

      expect(i18nService.reloadTranslations).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Translations reloaded successfully');
    });
  });
});
