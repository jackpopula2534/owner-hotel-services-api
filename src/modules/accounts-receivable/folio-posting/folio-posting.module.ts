import { Module } from '@nestjs/common';
import { FolioPostingService } from './folio-posting.service';

/**
 * Provider-only module so the restaurant and inventory modules can post
 * room charges without importing the accounting add-on graph.
 */
@Module({
  providers: [FolioPostingService],
  exports: [FolioPostingService],
})
export class FolioPostingModule {}
