import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsOptional, IsString, IsBoolean, IsUrl } from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { User, UserDocument } from '../common/schemas/user.schema'

class UpdateProfileDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) image?: string
}

class UpdateNotificationsDto {
  @IsOptional() @IsBoolean() dailyDigest?: boolean
  @IsOptional() @IsBoolean() streakReminder?: boolean
  @IsOptional() @IsBoolean() planCreated?: boolean
}

type AuthReq = { user: UserDocument }

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@Request() req: AuthReq) {
    const obj = req.user.toObject() as unknown as Record<string, unknown>
    delete obj.passwordHash
    return obj
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(@Request() req: AuthReq, @Body() dto: UpdateProfileDto) {
    if (dto.name) req.user.name = dto.name
    if (dto.image) req.user.image = dto.image
    await req.user.save()
    const obj = req.user.toObject() as unknown as Record<string, unknown>
    delete obj.passwordHash
    return obj
  }

  @Patch('me/notifications')
  @ApiOperation({ summary: 'Update email notification preferences' })
  async updateNotifications(@Request() req: AuthReq, @Body() dto: UpdateNotificationsDto) {
    const prefs = req.user.notificationPrefs ?? { dailyDigest: true, streakReminder: true, planCreated: true }
    if (dto.dailyDigest !== undefined) prefs.dailyDigest = dto.dailyDigest
    if (dto.streakReminder !== undefined) prefs.streakReminder = dto.streakReminder
    if (dto.planCreated !== undefined) prefs.planCreated = dto.planCreated
    await this.userModel.updateOne({ _id: req.user._id }, { $set: { notificationPrefs: prefs } })
    return { notificationPrefs: prefs }
  }
}
