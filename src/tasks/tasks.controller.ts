import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common'
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsEnum, IsDateString, IsArray, IsNumber, Min, Max, IsNotEmpty, MaxLength, ValidateNested, Matches } from 'class-validator'
import { Type } from 'class-transformer'
import { Types } from 'mongoose'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { TasksService } from './tasks.service'

class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string

  @IsOptional() @IsString() @MaxLength(2000) description?: string
  @IsOptional() @IsEnum(['low', 'medium', 'high', 'urgent']) priority?: string
  @IsOptional() @IsDateString() dueDate?: string
  @IsOptional() @IsNumber() @Min(1) @Max(1440) estimatedMinutes?: number
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[]
  @IsOptional() @IsString() listId?: string
}

class UpdateTaskDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) title?: string
  @IsOptional() @IsString() @MaxLength(2000) description?: string
  @IsOptional() @IsEnum(['todo', 'in_progress', 'done', 'archived']) status?: string
  @IsOptional() @IsEnum(['low', 'medium', 'high', 'urgent']) priority?: string
  @IsOptional() @IsDateString() dueDate?: string
  @IsOptional() @IsNumber() @Min(1) @Max(1440) estimatedMinutes?: number
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[]
}

class SuggestListItemDto {
  @IsString()
  @Matches(/^[a-f\d]{24}$/i, { message: '_id must be a valid ObjectId' })
  _id: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string
}

class SuggestTaskDto {
  @IsString()
  @IsNotEmpty()
  title: string

  @IsOptional() @IsString() description?: string
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SuggestListItemDto) lists?: SuggestListItemDto[]
}

type AuthReq = { user: { _id: { toString(): string } } }

function validateObjectId(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ID format')
}

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tasks for current user' })
  findAll(@Request() req: AuthReq, @Query() query: { status?: string; priority?: string; listId?: string }) {
    return this.tasksService.findAll(req.user._id.toString(), query)
  }

  @Get(':id')
  findOne(@Request() req: AuthReq, @Param('id') id: string) {
    validateObjectId(id)
    return this.tasksService.findOne(id, req.user._id.toString())
  }

  @Post()
  create(@Request() req: AuthReq, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(req.user._id.toString(), dto as never)
  }

  @Patch(':id')
  update(@Request() req: AuthReq, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    validateObjectId(id)
    return this.tasksService.update(id, req.user._id.toString(), dto as never)
  }

  @Patch(':id/complete')
  complete(@Request() req: AuthReq, @Param('id') id: string) {
    validateObjectId(id)
    return this.tasksService.complete(id, req.user._id.toString())
  }

  @Delete(':id')
  delete(@Request() req: AuthReq, @Param('id') id: string) {
    validateObjectId(id)
    return this.tasksService.delete(id, req.user._id.toString())
  }

  @Post('suggest')
  @ApiOperation({ summary: 'AI-powered task field suggestions' })
  async suggest(@Request() req: AuthReq, @Body() dto: SuggestTaskDto) {
    return this.tasksService.suggest(req.user._id.toString(), dto.title, dto.description, dto.lists ?? [])
  }
}
