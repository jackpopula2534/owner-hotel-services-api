import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../../../email/email.service';
import {
  CreateJourneyDto,
  JOURNEY_TRIGGERS,
  JourneyStepDto,
  UpdateJourneyDto,
} from './dto/journey.dto';

interface EnrollmentContext {
  bookingId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Multi-step Journey Flow engine.
 *
 * - `CrmJourney` stores the flow definition (steps as JSON).
 * - `CrmJourneyEnrollment` tracks each guest's progress through a flow.
 * - `processDueEnrollments()` is called periodically (every minute via cron)
 *   and advances any enrollment whose `nextRunAt` is in the past.
 *
 * Steps:
 *   - wait: { delayHours } — sets nextRunAt = now + delayHours
 *   - send: { channel, templateKey, subject, bodyOverride } — sends via channel
 *   - tag : { segment } — assigns segment to CrmContact
 */
@Injectable()
export class JourneyService {
  private readonly logger = new Logger(JourneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Journey CRUD
  // ──────────────────────────────────────────────────────────
  async findAll(tenantId?: string) {
    if (!tenantId) return [];
    try {
      return await this.prisma.crmJourney.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      });
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') return [];
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const journey = await this.prisma.crmJourney.findFirst({ where: { id, tenantId } });
    if (!journey) throw new NotFoundException(`Journey ${id} not found`);
    return journey;
  }

  async create(dto: CreateJourneyDto, tenantId?: string, userId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    this.validateSteps(dto.steps);

    return this.prisma.crmJourney.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        triggerEvent: dto.triggerEvent,
        isActive: dto.isActive ?? false,
        stepsConfig: JSON.stringify(dto.steps),
        createdById: userId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateJourneyDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.steps !== undefined) {
      this.validateSteps(dto.steps);
      data.stepsConfig = JSON.stringify(dto.steps);
    }

    return this.prisma.crmJourney.update({ where: { id }, data });
  }

  async remove(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);
    return this.prisma.crmJourney.delete({ where: { id } });
  }

  // ──────────────────────────────────────────────────────────
  // Enrollment
  // ──────────────────────────────────────────────────────────

  /**
   * Enroll a guest in every active journey matching the given trigger.
   * Called from event listener. Idempotent on (journey, guest, booking).
   */
  async enrollByTrigger(
    triggerEvent: (typeof JOURNEY_TRIGGERS)[number],
    tenantId: string,
    guestId: string,
    context: EnrollmentContext = {},
  ): Promise<number> {
    if (!tenantId || !guestId) return 0;
    try {
      const journeys = await this.prisma.crmJourney.findMany({
        where: { tenantId, isActive: true, triggerEvent },
      });
      let enrolled = 0;
      for (const journey of journeys) {
        const existing = await this.prisma.crmJourneyEnrollment.findFirst({
          where: { journeyId: journey.id, guestId, bookingId: context.bookingId ?? null },
        });
        if (existing) continue;

        await this.prisma.crmJourneyEnrollment.create({
          data: {
            journeyId: journey.id,
            tenantId,
            guestId,
            bookingId: context.bookingId ?? null,
            currentStepIdx: 0,
            status: 'active',
            nextRunAt: new Date(),
            metadata: context.metadata ? JSON.stringify(context.metadata) : null,
          },
        });
        enrolled++;
      }
      return enrolled;
    } catch (error) {
      this.logger.error(`enrollByTrigger failed: ${(error as Error).message}`);
      return 0;
    }
  }

  async getEnrollments(journeyId: string, tenantId: string) {
    await this.findOne(journeyId, tenantId);
    return this.prisma.crmJourneyEnrollment.findMany({
      where: { journeyId, tenantId },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
  }

  async cancelEnrollment(id: string, tenantId: string) {
    const e = await this.prisma.crmJourneyEnrollment.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundException(`Enrollment ${id} not found`);
    return this.prisma.crmJourneyEnrollment.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  // ──────────────────────────────────────────────────────────
  // Processor — called by cron every minute
  // ──────────────────────────────────────────────────────────

  /**
   * Process all active enrollments whose `nextRunAt` is due.
   * Each call advances each enrollment by exactly one step.
   * Returns the count of enrollments advanced.
   */
  async processDueEnrollments(now: Date = new Date()): Promise<number> {
    let processed = 0;
    try {
      const due = await this.prisma.crmJourneyEnrollment.findMany({
        where: {
          status: 'active',
          nextRunAt: { lte: now },
        },
        take: 200,
      });

      for (const enrollment of due) {
        try {
          await this.advanceOne(enrollment.id);
          processed++;
        } catch (error) {
          this.logger.error(
            `Failed to advance enrollment ${enrollment.id}: ${(error as Error).message}`,
          );
          await this.prisma.crmJourneyEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'failed' },
          });
        }
      }
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2021' && code !== 'P2022') {
        this.logger.error(`processDueEnrollments failed: ${(error as Error).message}`);
      }
    }
    return processed;
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  /** Execute the current step then move pointer / set nextRunAt. */
  private async advanceOne(enrollmentId: string): Promise<void> {
    const enrollment = await this.prisma.crmJourneyEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment || enrollment.status !== 'active') return;

    const journey = await this.prisma.crmJourney.findUnique({
      where: { id: enrollment.journeyId },
    });
    if (!journey) return;

    const steps = JourneyService.parseSteps(journey.stepsConfig);
    const idx = enrollment.currentStepIdx;

    if (idx >= steps.length) {
      await this.prisma.crmJourneyEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'completed', completedAt: new Date(), nextRunAt: null },
      });
      return;
    }

    const step = steps[idx];
    await this.executeStep(step, enrollment.tenantId, enrollment.guestId);

    const nextIdx = idx + 1;
    const isLast = nextIdx >= steps.length;
    const nextStep = isLast ? null : steps[nextIdx];
    const nextRunAt =
      nextStep && nextStep.type === 'wait' && nextStep.delayHours
        ? new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000)
        : new Date();

    await this.prisma.crmJourneyEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStepIdx: nextIdx,
        nextRunAt: isLast ? null : nextRunAt,
        status: isLast ? 'completed' : 'active',
        completedAt: isLast ? new Date() : null,
      },
    });
  }

  private async executeStep(
    step: JourneyStepDto,
    tenantId: string,
    guestId: string,
  ): Promise<void> {
    if (step.type === 'wait') return; // wait is handled by nextRunAt computation
    if (step.type === 'tag' && step.segment) {
      const contact = await this.prisma.crmContact.findFirst({
        where: { tenantId, guestId },
      });
      if (contact) {
        await this.prisma.crmContact.update({
          where: { id: contact.id },
          data: { segment: step.segment },
        });
      }
      return;
    }
    if (step.type === 'send') {
      if (step.channel !== 'email') {
        this.logger.warn(`Channel "${step.channel}" not yet implemented in journey send step`);
        return;
      }
      const guest = await this.prisma.guest.findFirst({
        where: { tenantId, id: guestId },
        select: { email: true, consentGiven: true },
      });
      if (!guest?.email || !guest.consentGiven) return;

      await this.email.sendEmail({
        to: guest.email,
        subject: step.subject ?? 'Update from your hotel',
        template: (step.templateKey ?? 'campaign-generic') as never,
        context: { body: step.bodyOverride ?? '' },
        language: 'en',
        tenantId,
      } as never);
    }
  }

  private validateSteps(steps: JourneyStepDto[]): void {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new BadRequestException('Journey must have at least one step');
    }
    if (steps.length > 50) {
      throw new BadRequestException('Journey cannot have more than 50 steps');
    }
    for (const [i, step] of steps.entries()) {
      if (step.type === 'send' && !step.channel) {
        throw new BadRequestException(`Step ${i}: send step requires channel`);
      }
      if (step.type === 'wait' && (!step.delayHours || step.delayHours <= 0)) {
        throw new BadRequestException(`Step ${i}: wait step requires delayHours > 0`);
      }
    }
  }

  static parseSteps(raw: string): JourneyStepDto[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as JourneyStepDto[]) : [];
    } catch {
      return [];
    }
  }
}
