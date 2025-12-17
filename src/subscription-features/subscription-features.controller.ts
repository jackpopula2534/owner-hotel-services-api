import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
} from '@nestjs/common';
import { SubscriptionFeaturesService } from './subscription-features.service';
import { CreateSubscriptionFeatureDto } from './dto/create-subscription-feature.dto';

@Controller('subscription-features')
export class SubscriptionFeaturesController {
  constructor(private readonly subscriptionFeaturesService: SubscriptionFeaturesService) {}

  @Post()
  create(@Body() createSubscriptionFeatureDto: CreateSubscriptionFeatureDto) {
    return this.subscriptionFeaturesService.create(createSubscriptionFeatureDto);
  }

  @Get()
  findAll() {
    return this.subscriptionFeaturesService.findAll();
  }

  @Get('subscription/:subscriptionId')
  findBySubscriptionId(@Param('subscriptionId') subscriptionId: string) {
    return this.subscriptionFeaturesService.findBySubscriptionId(subscriptionId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.subscriptionFeaturesService.remove(id);
  }
}


