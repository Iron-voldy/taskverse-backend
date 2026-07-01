import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type CanvasDocument = HydratedDocument<Canvas>

@Schema({ timestamps: true })
export class Canvas {
  @Prop({ required: true })
  intent: string

  @Prop({ type: Object, required: true })
  layoutSpec: Record<string, unknown>

  @Prop({ type: [Types.ObjectId], ref: 'Task', default: [] })
  taskIds: Types.ObjectId[]

  @Prop({ default: 'ui', enum: ['ui', 'task-plan'] })
  source: string

  @Prop({ default: false })
  pinned: boolean

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId
}

export const CanvasSchema = SchemaFactory.createForClass(Canvas)
