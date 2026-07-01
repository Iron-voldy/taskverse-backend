import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ListsController } from './lists.controller'
import { TaskList, TaskListSchema } from './task-list.schema'

@Module({
  imports: [MongooseModule.forFeature([{ name: TaskList.name, schema: TaskListSchema }])],
  controllers: [ListsController],
})
export class ListsModule {}
