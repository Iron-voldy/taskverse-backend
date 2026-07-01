import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type TaskDocument = HydratedDocument<Task>

export class Subtask {
  @Prop({ required: true })
  title: string

  @Prop({ default: false })
  done: boolean
}

@Schema({ timestamps: true })
export class Task {
  @Prop({ required: true, trim: true })
  title: string

  @Prop({ trim: true })
  description?: string

  @Prop({ enum: ['todo', 'in_progress', 'done', 'archived'], default: 'todo' })
  status: string

  @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority: string

  @Prop()
  dueDate?: Date

  @Prop({ min: 1, max: 1440 })
  estimatedMinutes?: number

  @Prop({ type: [String], default: [] })
  tags: string[]

  @Prop({ type: [{ title: String, done: Boolean }], default: [] })
  subtasks: Subtask[]

  @Prop({ type: Types.ObjectId, ref: 'TaskList' })
  listId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop()
  completedAt?: Date
}

export const TaskSchema = SchemaFactory.createForClass(Task)
TaskSchema.index({ userId: 1, status: 1 })
TaskSchema.index({ userId: 1, dueDate: 1 })
