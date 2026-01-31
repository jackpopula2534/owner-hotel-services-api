import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { SubscriptionFeatureLogs, FeatureLogAction } from '../subscription-features/entities/subscription-feature-log.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Feature } from '../features/entities/feature.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import {
  UpdateSubscriptionFeatureDto,
  RemoveSubscriptionFeatureDto,
  AddSubscriptionFeatureDto,
  SubscriptionFeaturesListDto,
  SubscriptionFeatureItemDto,
  UpdateFeatureResponseDto,
  RemoveFeatureResponseDto,
  AddFeatureResponseDto,
  FeatureLogsListDto,
  FeatureLogItemDto,
} from './dto/admin-subscription-features.dto';

@Injectable()
export class AdminSubscriptionFeaturesService {
  private readonly logger = new Logger(AdminSubscriptionFeaturesService.name);

  constructor(
    @InjectRepository(SubscriptionFeature)
    private subscriptionFeaturesRepository: Repository<SubscriptionFeature>,
    @InjectRepository(SubscriptionFeatureLogs)
    private featureLogsRepository: Repository<SubscriptionFeatureLogs>,
    @InjectRepository(Subscription)
    private subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(Feature)
    private featuresRepository: Repository<Feature>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    private dataSource: DataSource,
  ) {}

  /**
   * GET /api/v1/admin/subscription-features/:subscriptionId
   * Get all add-ons for a subscription
   */
  async getSubscriptionFeatures(subscriptionId: string): Promise<SubscriptionFeaturesListDto> {
    // Find subscription by code or UUID
    const subscription = await this.findSubscription(subscriptionId);

    // Get all features for this subscription
    const features = await this.subscriptionFeaturesRepository.find({
      where: { subscriptionId: subscription.id, isActive: true },
      relations: ['feature'],
      order: { createdAt: 'ASC' },
    });

    const addons: SubscriptionFeatureItemDto[] = features.map((sf) => ({
      id: sf.id,
      featureId: sf.featureId,
      featureName: sf.feature?.name || 'Unknown',
      featureDescription: sf.feature?.description || '',
      featureType: sf.feature?.type || 'module',
      quantity: sf.quantity || 1,
      price: Number(sf.price),
      totalPrice: Number(sf.price) * (sf.quantity || 1),
      isActive: sf.isActive,
      createdAt: sf.createdAt?.toISOString().split('T')[0] || 'N/A',
    }));

    const totalAddonPrice = addons.reduce((sum, a) => sum + a.totalPrice, 0);
    const planPrice = Number(subscription.plan?.priceMonthly || 0);

    return {
      subscriptionUuid: subscription.id,
      subscriptionCode: subscription.subscriptionCode || `SUB-${subscription.id.slice(0, 3).toUpperCase()}`,
      hotelName: subscription.tenant?.name || 'N/A',
      planName: subscription.plan?.name || 'No Plan',
      planPrice,
      addons,
      totalAddonPrice,
      totalMonthlyPrice: planPrice + totalAddonPrice,
    };
  }

  /**
   * PATCH /api/v1/admin/subscription-features/:id
   * Update an add-on (quantity/price)
   */
  async updateFeature(
    id: string,
    dto: UpdateSubscriptionFeatureDto,
    adminId?: string,
  ): Promise<UpdateFeatureResponseDto> {
    const feature = await this.subscriptionFeaturesRepository.findOne({
      where: { id },
      relations: ['feature', 'subscription'],
    });

    if (!feature) {
      throw new NotFoundException(`Subscription feature with ID "${id}" not found`);
    }

    const oldPrice = Number(feature.price);
    const oldQuantity = feature.quantity || 1;
    const newPrice = dto.price !== undefined ? dto.price : oldPrice;
    const newQuantity = dto.quantity !== undefined ? dto.quantity : oldQuantity;

    // Calculate proration if price changed
    let proratedAmount = 0;
    if (dto.price !== undefined && dto.price !== oldPrice) {
      proratedAmount = this.calculateProration(
        feature.subscription,
        newPrice - oldPrice,
        dto.effectiveDate,
      );
    }

    // Update the feature
    feature.price = newPrice;
    feature.quantity = newQuantity;
    await this.subscriptionFeaturesRepository.save(feature);

    // Log the change
    await this.createLog({
      subscriptionFeatureId: feature.id,
      subscriptionId: feature.subscriptionId,
      featureId: feature.featureId,
      featureName: feature.feature?.name || 'Unknown',
      action: FeatureLogAction.UPDATED,
      oldPrice,
      newPrice,
      oldQuantity,
      newQuantity,
      proratedAmount,
      reason: dto.reason,
      effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
      createdBy: adminId,
    });

    this.logger.log(
      `Updated feature ${feature.feature?.name} for subscription ${feature.subscriptionId}: price ${oldPrice} -> ${newPrice}, quantity ${oldQuantity} -> ${newQuantity}`,
    );

    return {
      success: true,
      message: 'Add-on updated successfully',
      data: {
        id: feature.id,
        featureName: feature.feature?.name || 'Unknown',
        oldPrice,
        newPrice,
        oldQuantity,
        newQuantity,
        proratedAmount,
        effectiveDate: dto.effectiveDate || new Date().toISOString().split('T')[0],
      },
    };
  }

  /**
   * POST /api/v1/admin/subscription-features/:id/remove
   * Remove an add-on with optional credit
   */
  async removeFeature(
    id: string,
    dto: RemoveSubscriptionFeatureDto,
    adminId?: string,
  ): Promise<RemoveFeatureResponseDto> {
    const feature = await this.subscriptionFeaturesRepository.findOne({
      where: { id },
      relations: ['feature', 'subscription'],
    });

    if (!feature) {
      throw new NotFoundException(`Subscription feature with ID "${id}" not found`);
    }

    const featureName = feature.feature?.name || 'Unknown';
    const price = Number(feature.price);

    // Calculate credit for unused portion
    let creditAmount = 0;
    const createCredit = dto.createCredit !== false; // Default to true

    if (createCredit) {
      creditAmount = this.calculateProration(
        feature.subscription,
        price,
        dto.effectiveDate,
      );
    }

    // Mark as inactive (soft delete)
    feature.isActive = false;
    await this.subscriptionFeaturesRepository.save(feature);

    // Log the removal
    await this.createLog({
      subscriptionFeatureId: feature.id,
      subscriptionId: feature.subscriptionId,
      featureId: feature.featureId,
      featureName,
      action: FeatureLogAction.REMOVED,
      oldPrice: price,
      newPrice: null,
      oldQuantity: feature.quantity,
      newQuantity: null,
      creditAmount: createCredit ? creditAmount : 0,
      reason: dto.reason,
      effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
      createdBy: adminId,
    });

    this.logger.log(
      `Removed feature ${featureName} from subscription ${feature.subscriptionId}. Credit: ${creditAmount}`,
    );

    // TODO: In Phase 4, create actual credit record in tenant_credits table
    // if (createCredit && creditAmount > 0) {
    //   await this.createCreditRecord(feature.subscription.tenantId, creditAmount, 'Feature removal proration');
    // }

    return {
      success: true,
      message: 'Add-on removed successfully',
      data: {
        removedFeature: featureName,
        creditAmount,
        creditCreated: createCredit && creditAmount > 0,
        effectiveDate: dto.effectiveDate || new Date().toISOString().split('T')[0],
      },
    };
  }

  /**
   * POST /api/v1/admin/subscription-features
   * Add a new add-on to a subscription (with transaction rollback on error)
   */
  async addFeature(
    dto: AddSubscriptionFeatureDto,
    adminId?: string,
  ): Promise<AddFeatureResponseDto> {
    // Find subscription
    const subscription = await this.findSubscription(dto.subscriptionId);

    // Find feature
    const feature = await this.featuresRepository.findOne({
      where: { id: dto.featureId },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${dto.featureId}" not found`);
    }

    // Check if already exists and is active
    const existing = await this.subscriptionFeaturesRepository.findOne({
      where: {
        subscriptionId: subscription.id,
        featureId: dto.featureId,
        isActive: true,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `Feature "${feature.name}" is already added to this subscription`,
      );
    }

    // Calculate price (use custom price or feature default)
    const price = dto.price !== undefined ? dto.price : Number(feature.priceMonthly);
    const quantity = dto.quantity || 1;

    // Calculate prorated amount for partial month
    let proratedAmount = 0;
    if (dto.effectiveDate) {
      proratedAmount = this.calculateProration(subscription, price, dto.effectiveDate);
    }

    // Use transaction to ensure rollback on error
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create the subscription feature
      const subscriptionFeature = queryRunner.manager.create(SubscriptionFeature, {
        subscriptionId: subscription.id,
        featureId: dto.featureId,
        quantity,
        price,
        isActive: true,
      });

      await queryRunner.manager.save(subscriptionFeature);

      // Create invoice if requested
      let invoiceNo: string | undefined;
      const createInvoice = dto.createInvoice !== false; // Default to true

      if (createInvoice && proratedAmount > 0) {
        const invoice = await this.createAddonInvoiceWithTransaction(
          queryRunner,
          subscription,
          feature,
          proratedAmount,
          'Add-on proration',
        );
        invoiceNo = invoice.invoiceNo;
      }

      // Log the addition
      const log = queryRunner.manager.create(SubscriptionFeatureLogs, {
        subscriptionFeatureId: subscriptionFeature.id,
        subscriptionId: subscription.id,
        featureId: dto.featureId,
        featureName: feature.name,
        action: FeatureLogAction.ADDED,
        oldPrice: null,
        newPrice: price,
        oldQuantity: null,
        newQuantity: quantity,
        proratedAmount,
        reason: `Added via Admin Panel`,
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
        createdBy: adminId,
      });

      await queryRunner.manager.save(log);

      // Commit transaction
      await queryRunner.commitTransaction();

      this.logger.log(
        `Added feature ${feature.name} to subscription ${subscription.subscriptionCode || subscription.id}`,
      );

      return {
        success: true,
        message: 'Add-on added successfully',
        data: {
          id: subscriptionFeature.id,
          featureName: feature.name,
          price,
          quantity,
          invoiceCreated: !!invoiceNo,
          invoiceNo,
          proratedAmount,
        },
      };
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to add feature: ${error.message}`, error.stack);
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }

  /**
   * GET /api/v1/admin/subscription-features/:subscriptionId/logs
   * Get change logs for a subscription's add-ons
   */
  async getFeatureLogs(subscriptionId: string): Promise<FeatureLogsListDto> {
    const subscription = await this.findSubscription(subscriptionId);

    const logs = await this.featureLogsRepository.find({
      where: { subscriptionId: subscription.id },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    const logItems: FeatureLogItemDto[] = logs.map((log) => ({
      id: log.id,
      featureName: log.featureName,
      action: log.action,
      oldPrice: log.oldPrice ? Number(log.oldPrice) : undefined,
      newPrice: log.newPrice ? Number(log.newPrice) : undefined,
      oldQuantity: log.oldQuantity || undefined,
      newQuantity: log.newQuantity || undefined,
      proratedAmount: log.proratedAmount ? Number(log.proratedAmount) : undefined,
      reason: log.reason || undefined,
      createdAt: log.createdAt.toISOString(),
      createdBy: log.createdBy || undefined,
    }));

    return {
      subscriptionId: subscription.subscriptionCode || subscriptionId,
      logs: logItems,
      total: logItems.length,
    };
  }

  /**
   * Helper: Find subscription by code or UUID
   */
  private async findSubscription(id: string): Promise<Subscription> {
    let subscription: Subscription | null = null;

    if (id.startsWith('SUB-')) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { subscriptionCode: id },
        relations: ['tenant', 'plan'],
      });
    }

    if (!subscription) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { id },
        relations: ['tenant', 'plan'],
      });
    }

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    return subscription;
  }

  /**
   * Helper: Calculate prorated amount based on remaining days in billing cycle
   */
  private calculateProration(
    subscription: Subscription,
    amount: number,
    effectiveDate?: string,
  ): number {
    if (!subscription.startDate || !subscription.endDate) {
      return amount;
    }

    const startDate = new Date(subscription.startDate);
    const endDate = new Date(subscription.endDate);
    const effective = effectiveDate ? new Date(effectiveDate) : new Date();

    // Total days in billing cycle
    const totalDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Remaining days from effective date to end date
    const remainingDays = Math.max(
      0,
      Math.ceil((endDate.getTime() - effective.getTime()) / (1000 * 60 * 60 * 24)),
    );

    if (totalDays <= 0) {
      return amount;
    }

    // Prorated amount = (amount / totalDays) * remainingDays
    const prorated = Math.round((amount / totalDays) * remainingDays);
    return prorated;
  }

  /**
   * Helper: Create feature log entry
   */
  private async createLog(data: Partial<SubscriptionFeatureLogs>): Promise<void> {
    const log = this.featureLogsRepository.create(data);
    await this.featureLogsRepository.save(log);
  }

  /**
   * Helper: Create invoice for add-on
   */
  private async createAddonInvoice(
    subscription: Subscription,
    feature: Feature,
    amount: number,
    description: string,
  ): Promise<Invoice> {
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoice = this.invoicesRepository.create({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      invoiceNo,
      amount,
      status: InvoiceStatus.PENDING,
      dueDate,
    });

    await this.invoicesRepository.save(invoice);

    this.logger.log(`Created invoice ${invoiceNo} for add-on: ${feature.name}, amount: ${amount}`);

    return invoice;
  }

  /**
   * Helper: Create invoice for add-on with transaction
   */
  private async createAddonInvoiceWithTransaction(
    queryRunner: any,
    subscription: Subscription,
    feature: Feature,
    amount: number,
    description: string,
  ): Promise<Invoice> {
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoice = queryRunner.manager.create(Invoice, {
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      invoiceNo,
      amount,
      status: InvoiceStatus.PENDING,
      dueDate,
    });

    await queryRunner.manager.save(invoice);

    this.logger.log(`Created invoice ${invoiceNo} for add-on: ${feature.name}, amount: ${amount}`);

    return invoice;
  }
}
