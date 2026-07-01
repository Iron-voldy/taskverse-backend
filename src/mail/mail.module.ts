import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { MailService } from './mail.service'
import { MailController } from './mail.controller'
import { Task, TaskSchema } from '../common/schemas/task.schema'
import { User, UserSchema } from '../common/schemas/user.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
