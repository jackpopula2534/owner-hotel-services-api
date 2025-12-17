import {
  Controller,
  Get,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { AdminApprovalService } from './admin-approval.service';
import { ApprovePaymentDto } from './dto/approve-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';

@Controller('admin-approval')
export class AdminApprovalController {
  constructor(private readonly adminApprovalService: AdminApprovalService) {}

  /**
   * 6️⃣ Admin Approval Flow
   * POST /admin-approval/payments/:paymentId/approve
   */
  @Post('payments/:paymentId/approve')
  async approvePayment(
    @Param('paymentId') paymentId: string,
    @Body() approvePaymentDto: ApprovePaymentDto,
  ) {
    return this.adminApprovalService.approvePayment(
      paymentId,
      approvePaymentDto.adminId,
    );
  }

  /**
   * POST /admin-approval/payments/:paymentId/reject
   */
  @Post('payments/:paymentId/reject')
  async rejectPayment(
    @Param('paymentId') paymentId: string,
    @Body() rejectPaymentDto: RejectPaymentDto,
  ) {
    return this.adminApprovalService.rejectPayment(
      paymentId,
      rejectPaymentDto.adminId,
      rejectPaymentDto.reason,
    );
  }

  /**
   * GET /admin-approval/pending-payments
   */
  @Get('pending-payments')
  async getPendingPayments() {
    return this.adminApprovalService.getPendingPayments();
  }
}


