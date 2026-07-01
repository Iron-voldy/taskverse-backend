import { Controller, Post, Get, Patch, Body, Param, Res, UseGuards, Request, HttpException, HttpStatus, BadRequestException } from '@nestjs/common'
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger'
import type { Response } from 'express'
import { Throttle } from '@nestjs/throttler'
import { IsString, IsArray, IsOptional, IsObject, IsNotEmpty, MaxLength, IsIn } from 'class-validator'
import { Types } from 'mongoose'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { GenUIService } from './genui.service'

class ComposeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  intent: string
}

class ClarifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  intent: string
}

class SuggestTasksDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  intent: string

  @IsOptional()
  @IsObject()
  clarifications?: Record<string, string>
}

class SaveCanvasDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  intent: string

  @IsArray()
  @IsString({ each: true })
  taskIds: string[]

  @IsOptional()
  @IsIn(['ui', 'task-plan'])
  source?: 'ui' | 'task-plan'

  @IsObject()
  layoutSpec: Record<string, unknown>
}

type AuthReq = { user: { _id: { toString(): string } } }

function validateObjectId(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ID format')
}

@ApiTags('genui')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('genui')
export class GenUIController {
  constructor(private readonly genuiService: GenUIService) {}

  @Post('compose')
  @Throttle({ short: { limit: 3, ttl: 60000 }, medium: { limit: 20, ttl: 3600000 } })
  @ApiOperation({ summary: 'Compose a generative UI layout from intent (SSE stream)' })
  async compose(@Request() req: AuthReq, @Body() dto: ComposeDto, @Res() res: Response) {
    await this.genuiService.compose(dto.intent, req.user._id.toString(), res)
  }

  @Post('clarify')
  @Throttle({ short: { limit: 5, ttl: 60000 }, medium: { limit: 30, ttl: 3600000 } })
  @ApiOperation({ summary: 'Get AI clarifying questions for an intent' })
  async clarify(@Body() dto: ClarifyDto) {
    try {
      return await this.genuiService.clarifyIntent(dto.intent)
    } catch {
      throw new HttpException('Clarification service unavailable', HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  @Post('suggest-tasks')
  @Throttle({ short: { limit: 5, ttl: 60000 }, medium: { limit: 30, ttl: 3600000 } })
  @ApiOperation({ summary: 'AI-generated task list for a given intent' })
  async suggestTasks(@Request() req: AuthReq, @Body() dto: SuggestTasksDto) {
    try {
      return await this.genuiService.suggestTasks(dto.intent, req.user._id.toString(), dto.clarifications)
    } catch {
      throw new HttpException('Suggestion service unavailable', HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  @Get('canvases')
  @ApiOperation({ summary: 'Get all saved canvases for current user' })
  getCanvases(@Request() req: AuthReq) {
    return this.genuiService.getCanvases(req.user._id.toString())
  }

  @Post('canvases')
  @ApiOperation({ summary: 'Save a generated canvas' })
  saveCanvas(@Request() req: AuthReq, @Body() dto: SaveCanvasDto) {
    for (const id of dto.taskIds) validateObjectId(id)
    return this.genuiService.saveCanvas(req.user._id.toString(), dto.intent, dto.layoutSpec, dto.taskIds, dto.source ?? 'ui')
  }

  @Patch('canvases/:id/pin')
  @ApiOperation({ summary: 'Toggle pin on a canvas' })
  togglePin(@Request() req: AuthReq, @Param('id') id: string) {
    validateObjectId(id)
    return this.genuiService.togglePin(id, req.user._id.toString())
  }
}
