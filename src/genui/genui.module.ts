import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { GenUIController } from './genui.controller'
import { GenUIService } from './genui.service'
import { Canvas, CanvasSchema } from '../common/schemas/canvas.schema'
import { TasksModule } from '../tasks/tasks.module'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Canvas.name, schema: CanvasSchema }]),
    TasksModule,
  ],
  controllers: [GenUIController],
  providers: [GenUIService],
})
export class GenUIModule {}
