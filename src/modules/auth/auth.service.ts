import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });

    // Generate tokens (include tenantId for multi-tenant PMS)
    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tenantId ?? undefined,
    );

    return {
      ...tokens,
      user: {
        ...user,
        tenantId: user.tenantId ?? undefined,
      },
    };
  }

  async loginAdmin(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.status !== 'active') {
      throw new UnauthorizedException('Admin account is suspended or inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(
      admin.id,
      admin.email,
      admin.role,
      undefined,
      'admin'
    );

    return {
      ...tokens,
      user: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        isPlatformAdmin: true,
      },
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User account is suspended or inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tenantId ?? undefined,
      'user'
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId ?? undefined,
        isPlatformAdmin: false,
      },
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    // Find refresh token in database
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { 
        user: true,
        admin: true,
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if token is expired
    if (new Date() > tokenRecord.expiresAt) {
      // Delete expired token
      await this.prisma.refreshToken.delete({
        where: { id: tokenRecord.id },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Check if token is revoked
    if (tokenRecord.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const account = tokenRecord.admin || tokenRecord.user;
    if (!account) {
      throw new UnauthorizedException('Account not found');
    }

    const userType = tokenRecord.adminId ? 'admin' : 'user';
    const tenantId = (tokenRecord.user as any)?.tenantId ?? undefined;

    // Generate new tokens
    const tokens = await this.generateTokens(
      account.id,
      account.email,
      account.role,
      tenantId,
      userType
    );

    // Revoke old refresh token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    return tokens;
  }

  async logout(userIdOrAdminId: string, refreshToken?: string) {
    if (refreshToken) {
      // Revoke specific refresh token
      await this.prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          OR: [
            { userId: userIdOrAdminId },
            { adminId: userIdOrAdminId }
          ]
        },
        data: {
          revokedAt: new Date(),
        },
      });
    } else {
      // Revoke all refresh tokens for user/admin
      await this.prisma.refreshToken.updateMany({
        where: {
          OR: [
            { userId: userIdOrAdminId },
            { adminId: userIdOrAdminId }
          ],
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }
  }

  private async generateTokens(
    id: string,
    email: string,
    role: string,
    tenantId?: string,
    userType: 'admin' | 'user' = 'user'
  ) {
    const payload = { 
      sub: id, 
      email, 
      role, 
      tenantId: tenantId ?? null,
      isPlatformAdmin: userType === 'admin'
    };

    // Generate access token (short-lived)
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '15m',
    });

    // Generate refresh token (long-lived)
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Store refresh token in database
    try {
      await this.prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: userType === 'user' ? id : null,
          adminId: userType === 'admin' ? id : null,
          expiresAt,
        },
      });
    } catch (error) {
      console.error('Error creating refresh token:', error);
      
      // Check for missing column error (Prisma error P2025 or similar message)
      if (error.message?.includes('column') && error.message?.includes('does not exist')) {
        throw new Error(
          'Database schema mismatch: The "adminId" column is missing in "refresh_tokens" table. ' +
          'Please run "npm run db:refresh" to synchronize the database.'
        );
      }
      
      throw new BadRequestException('Could not create session. Please try again later.');
    }

    return {
      accessToken,
      refreshToken,
    };
  }
}

