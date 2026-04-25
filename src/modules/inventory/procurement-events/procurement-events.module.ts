import { Module } from '@nestjs/common';
import { ProcurementEventsGateway } from './procurement-events.gateway';

/**
 * Sprint 5 — registers the procurement WebSocket gateway. Stateless,
 * pure broadcaster for `gr.completed` and `po.received` events.
 */
@Module({
  providers: [ProcurementEventsGateway],
  exports: [ProcurementEventsGateway],
})
export class ProcurementEventsModule {}
