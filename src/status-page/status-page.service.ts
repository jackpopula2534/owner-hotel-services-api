import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ComponentStatus =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance';

export type IncidentSeverity = 'minor' | 'major' | 'critical';
export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved';

export interface PublicStatusResponse {
  overallStatus: ComponentStatus;
  components: Array<{
    code: string;
    name: string;
    status: ComponentStatus;
  }>;
  activeIncidents: Array<{
    id: string;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    startedAt: string;
    updates: Array<{ status: IncidentStatus; message: string; at: string }>;
  }>;
  recentIncidents: Array<{
    id: string;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    startedAt: string;
    resolvedAt: string | null;
  }>;
}

@Injectable()
export class StatusPageService {
  private readonly logger = new Logger(StatusPageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public read — no auth required. Returns the data needed by
   * status.staysync.com. Cached aggressively at the controller layer.
   */
  async getPublicStatus(): Promise<PublicStatusResponse> {
    const components = await (this.prisma as any).service_components.findMany({
      where: { is_visible: 1 },
      orderBy: { display_order: 'asc' },
    });

    const activeIncidents = await (this.prisma as any).incidents.findMany({
      where: { status: { not: 'resolved' as any } },
      include: {
        updates: { orderBy: { created_at: 'desc' } },
      },
      orderBy: { started_at: 'desc' },
    });

    const recentIncidents = await (this.prisma as any).incidents.findMany({
      where: { status: 'resolved' as any },
      orderBy: { started_at: 'desc' },
      take: 10,
    });

    return {
      overallStatus: this.computeOverallStatus(components.map((c: any) => c.status)),
      components: components.map((c: any) => ({
        code: c.code,
        name: c.name,
        status: c.status,
      })),
      activeIncidents: activeIncidents.map((i: any) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        startedAt: i.started_at.toISOString(),
        updates: (i.updates || []).map((u: any) => ({
          status: u.status,
          message: u.message,
          at: u.created_at.toISOString(),
        })),
      })),
      recentIncidents: recentIncidents.map((i: any) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        startedAt: i.started_at.toISOString(),
        resolvedAt: i.resolved_at ? i.resolved_at.toISOString() : null,
      })),
    };
  }

  // ─────────── Admin operations ───────────

  async upsertComponent(input: {
    code: string;
    name: string;
    description?: string;
    displayOrder?: number;
    status?: ComponentStatus;
  }) {
    return (this.prisma as any).service_components.upsert({
      where: { code: input.code },
      create: {
        code: input.code,
        name: input.name,
        description: input.description,
        display_order: input.displayOrder ?? 0,
        status: input.status ?? 'operational',
      },
      update: {
        name: input.name,
        description: input.description,
        display_order: input.displayOrder ?? 0,
        ...(input.status && { status: input.status }),
      },
    });
  }

  async updateComponentStatus(code: string, status: ComponentStatus) {
    const c = await (this.prisma as any).service_components.findUnique({
      where: { code },
    });
    if (!c) throw new NotFoundException('Component not found');
    await (this.prisma as any).service_components.update({
      where: { code },
      data: { status, updated_at: new Date() },
    });
  }

  async createIncident(input: {
    title: string;
    severity?: IncidentSeverity;
    affectedComponents?: string[];
    initialUpdate: string;
    createdBy?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const incident = await (tx as any).incidents.create({
        data: {
          title: input.title,
          severity: input.severity || 'minor',
          status: 'investigating',
          affected_components: input.affectedComponents || [],
          created_by: input.createdBy,
        },
      });
      await (tx as any).incident_updates.create({
        data: {
          incident_id: incident.id,
          status: 'investigating',
          message: input.initialUpdate,
          created_by: input.createdBy,
        },
      });
      return incident;
    });
  }

  async addIncidentUpdate(input: {
    incidentId: string;
    status: IncidentStatus;
    message: string;
    createdBy?: string;
  }) {
    const incident = await (this.prisma as any).incidents.findUnique({
      where: { id: input.incidentId },
    });
    if (!incident) throw new NotFoundException('Incident not found');

    return this.prisma.$transaction(async (tx) => {
      await (tx as any).incident_updates.create({
        data: {
          incident_id: input.incidentId,
          status: input.status,
          message: input.message,
          created_by: input.createdBy,
        },
      });
      await (tx as any).incidents.update({
        where: { id: input.incidentId },
        data: {
          status: input.status,
          resolved_at: input.status === 'resolved' ? new Date() : null,
          updated_at: new Date(),
        },
      });
    });
  }

  async recordUptimeCheck(input: {
    componentId: string;
    status: 'up' | 'down';
    latencyMs?: number;
    errorMessage?: string;
  }) {
    await (this.prisma as any).uptime_checks.create({
      data: {
        component_id: input.componentId,
        status: input.status as any,
        latency_ms: input.latencyMs,
        error_message: input.errorMessage,
      },
    });
  }

  /**
   * Compute overall status: highest-severity component wins.
   */
  private computeOverallStatus(statuses: ComponentStatus[]): ComponentStatus {
    const order: ComponentStatus[] = [
      'major_outage',
      'partial_outage',
      'degraded',
      'maintenance',
      'operational',
    ];
    for (const s of order) {
      if (statuses.includes(s)) return s;
    }
    return 'operational';
  }
}
