import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type UserDocument = HydratedDocument<User>

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string

  @Prop({ trim: true })
  name: string

  @Prop()
  passwordHash?: string

  @Prop()
  googleId?: string

  @Prop()
  image?: string

  @Prop({ default: 0 })
  xp: number

  @Prop({ default: 1 })
  level: number

  @Prop({ default: 0 })
  streak: number

  @Prop()
  lastActiveDate?: Date

  @Prop({ default: false })
  emailVerified: boolean

  @Prop({
    type: {
      dailyDigest: { type: Boolean, default: true },
      streakReminder: { type: Boolean, default: true },
      planCreated: { type: Boolean, default: true },
    },
    default: () => ({ dailyDigest: true, streakReminder: true, planCreated: true }),
  })
  notificationPrefs: {
    dailyDigest: boolean
    streakReminder: boolean
    planCreated: boolean
  }
}

export const UserSchema = SchemaFactory.createForClass(User)
