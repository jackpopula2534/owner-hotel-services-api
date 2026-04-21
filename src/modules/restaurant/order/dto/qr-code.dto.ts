import { ApiProperty } from '@nestjs/swagger';

export class QrCodeDto {
  @ApiProperty({
    description: 'Base64-encoded PNG QR code image',
    type: 'string',
    format: 'byte',
  })
  qrCode: string;

  @ApiProperty({
    description: 'QR code URL that the code encodes',
    example: 'http://localhost:9010/restaurant/order/table123?restaurantId=restaurant456',
  })
  url: string;
}
