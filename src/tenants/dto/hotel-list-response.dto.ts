import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Hotel List Response DTO
 * ข้อมูลสำหรับแสดงรายการโรงแรมในหน้า "จัดการโรงแรม"
 */

// ===== Status Badge =====
export type HotelListStatusBadge = {
  status: 'trial' | 'active' | 'suspended' | 'expired';
  label: string;
  labelTh: string;
  color: 'blue' | 'green' | 'red' | 'gray';
  bgColor: string;
  textColor: string;
};

// ===== Single Hotel Card Item =====
export class HotelListItemDto {
  // Basic Info
  id: string;
  name: string;
  location: string; // จังหวัด

  // Status
  status: HotelListStatusBadge;

  // Stats
  roomCount: number;
  roomCountFormatted: string; // "50 ห้อง"

  // Customer/Company
  customerName: string;

  // Billing
  billingCycle: string; // "รายเดือน" หรือ "รายปี"
  billingCycleCode: 'monthly' | 'yearly';

  // Plan
  plan: {
    code: string;
    name: string;
    nameTh: string;
  } | null;

  // Trial Info (if applicable)
  trial: {
    isInTrial: boolean;
    daysRemaining: number;
    daysRemainingText: string;
  };

  // Quick Info
  createdAt: string;
  createdAtFormatted: string;

  // Actions available
  actions: {
    canViewDetail: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canSuspend: boolean;
  };
}

// ===== Filter Options =====
export class HotelFilterOptionsDto {
  statuses: {
    value: string;
    label: string;
    labelTh: string;
    count: number;
  }[];

  provinces: {
    value: string;
    label: string;
    count: number;
  }[];

  plans: {
    value: string;
    label: string;
    labelTh: string;
    count: number;
  }[];
}

// ===== Pagination =====
export class PaginationDto {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// ===== Summary Stats =====
export class HotelSummaryStatsDto {
  totalHotels: number;
  activeHotels: number;
  trialHotels: number;
  suspendedHotels: number;
  expiredHotels: number;

  // Formatted
  totalHotelsFormatted: string;
  activeHotelsFormatted: string;
  trialHotelsFormatted: string;
}

// ===== Main List Response =====
export class HotelListResponseDto {
  // Hotels List
  hotels: HotelListItemDto[];

  // Summary
  summary: HotelSummaryStatsDto;

  // Pagination
  pagination: PaginationDto;

  // Filter Options (for dropdown)
  filterOptions: HotelFilterOptionsDto;

  // Metadata
  metadata: {
    fetchedAt: string;
    searchQuery?: string;
    appliedFilters: {
      status?: string;
      province?: string;
      plan?: string;
    };
  };
}

// ===== Query Params for List =====
export class HotelListQueryDto {
  /**
   * Search query (ค้นหาชื่อโรงแรม)
   */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Filter by status
   */
  @IsOptional()
  @IsEnum(['all', 'trial', 'active', 'suspended', 'expired'])
  status?: 'all' | 'trial' | 'active' | 'suspended' | 'expired';

  /**
   * Filter by province
   */
  @IsOptional()
  @IsString()
  province?: string;

  /**
   * Filter by plan code
   */
  @IsOptional()
  @IsString()
  planCode?: string;

  /**
   * Page number
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Items per page
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  /**
   * Sort by field
   */
  @IsOptional()
  @IsString()
  sortBy?: 'name' | 'createdAt' | 'roomCount' | 'status';

  /**
   * Sort order
   */
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
