import { Module } from '@nestjs/common';
import { AssetsModule } from './assets/assets.module';
import { DepreciationModule } from './depreciation/depreciation.module';

@Module({
  imports: [AssetsModule, DepreciationModule],
  exports: [AssetsModule, DepreciationModule],
})
export class FixedAssetsModule {}
