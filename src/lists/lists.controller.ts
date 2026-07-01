import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, BadRequestException, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { TaskList, TaskListDocument } from './task-list.schema'

class CreateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string

  @IsOptional() @IsString() color?: string
  @IsOptional() @IsString() icon?: string
}

type AuthReq = { user: { _id: Types.ObjectId } }

function validateObjectId(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ID format')
}

@ApiTags('lists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lists')
export class ListsController {
  constructor(@InjectModel(TaskList.name) private readonly listModel: Model<TaskListDocument>) {}

  @Get()
  findAll(@Request() req: AuthReq) {
    return this.listModel.find({ userId: req.user._id }).lean()
  }

  @Post()
  create(@Request() req: AuthReq, @Body() dto: CreateListDto) {
    return this.listModel.create({ ...dto, userId: req.user._id })
  }

  @Patch(':id')
  async update(@Request() req: AuthReq, @Param('id') id: string, @Body() dto: CreateListDto) {
    validateObjectId(id)
    const updated = await this.listModel.findOneAndUpdate({ _id: id, userId: req.user._id }, dto, { new: true }).lean()
    if (!updated) throw new NotFoundException('List not found')
    return updated
  }

  @Delete(':id')
  async remove(@Request() req: AuthReq, @Param('id') id: string) {
    validateObjectId(id)
    await this.listModel.deleteOne({ _id: id, userId: req.user._id })
    return { deleted: true }
  }
}
