import { Controller, Post, Body, Request, UseGuards, HttpException, HttpStatus } from '@nestjs/common'
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsString, IsArray, IsOptional, IsNumber, ValidateNested, IsNotEmpty, MaxLength, IsEnum, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { MailService } from './mail.service'

class TaskItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string

  @IsEnum(['low', 'medium', 'high', 'urgent'])
  priority: string

  @IsOptional()
  @IsString()
  dueDate?: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  estimatedMinutes?: number

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]
}

class SendPlanEmailDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskItemDto)
  tasks: TaskItemDto[]
}

type AuthReq = { user: { _id: { toString(): string } } }

@ApiTags('mail')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('send-plan')
  @Throttle({ short: { limit: 2, ttl: 60000 }, medium: { limit: 10, ttl: 3600000 } })
  @ApiOperation({ summary: 'Send task plan confirmation email to current user' })
  async sendPlan(@Request() req: AuthReq, @Body() dto: SendPlanEmailDto) {
    try {
      await this.mailService.sendPlanEmail(req.user._id.toString(), dto.tasks)
      return { sent: true }
    } catch {
      throw new HttpException('Failed to send email', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
