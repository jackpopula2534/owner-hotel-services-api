import { Module } from '@nestjs/common';
import { FolioPostingService } from './folio-posting.service';
import { FolioLifecycleListener } from './folio-lifecycle.listener';

/**
 * Provider-only module so the restaurant and inventory modules can post
 * room charges without importing the accounting add-on graph.
 * FolioLifecycleListener เปิด folio บัญชีให้อัตโนมัติเมื่อเช็คอิน
 */
@Module({
  providers: [FolioPostingService, FolioLifecycleListener],
  exports: [FolioPostingService],
})
export class FolioPostingModule {}
