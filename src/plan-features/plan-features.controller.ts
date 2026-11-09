import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { PlanFeaturesService } from './plan-features.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePlanFeatureDto } from './dto/create-plan-feature.dto';

@Controller('plan-features')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class PlanFeaturesController {
  constructor(private readonly planFeaturesService: PlanFeaturesService) {}

  @Post()
  create(@Body() createPlanFeatureDto: CreatePlanFeatureDto) {
    return this.planFeaturesService.create(createPlanFeatureDto);
  }

  @Get()
  findAll() {
    return this.planFeaturesService.findAll();
  }

  @Get('plan/:planId')
  findByPlanId(@Param('planId') planId: string) {
    return this.planFeaturesService.findByPlanId(planId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.planFeaturesService.remove(id);
  }
}
