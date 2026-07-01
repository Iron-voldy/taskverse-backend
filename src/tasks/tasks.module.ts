import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'
import { Task, TaskSchema } from '../common/schemas/task.schema'
import { User, UserSchema } from '../common/schemas/user.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
