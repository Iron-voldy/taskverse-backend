import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type TaskListDocument = HydratedDocument<TaskList>

@Schema({ timestamps: true })
export class TaskList {
  @Prop({ required: true, trim: true })
  name: string

  @Prop({ default: '#8b5cf6' })
  color: string

  @Prop({ default: '📋' })
  icon: string

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId
}

export const TaskListSchema = SchemaFactory.createForClass(TaskList)
